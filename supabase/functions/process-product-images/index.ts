import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // AI calls go through resolve-ai-route (no LOVABLE_API_KEY dependency)
    const sb = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Não autenticado");
    }
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) throw new Error("Não autenticado");

    const { productIds, workspaceId, mode = "optimize", modelOverride } = await req.json();
    // mode: "optimize" = pad+enhance, "lifestyle" = generate contextual image
    // modelOverride: optional AI model to use (e.g. "google/gemini-3-pro-image-preview")
    // Model is passed through to resolve-ai-route which handles provider routing
    const imageModel = modelOverride || undefined; // let resolve-ai-route pick the best default

    if (!productIds?.length || !workspaceId) {
      throw new Error("productIds e workspaceId são obrigatórios");
    }

    // Check credits
    const { data: credits } = await sb
      .from("image_credits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (credits) {
      // Reset if month passed
      if (new Date(credits.reset_at) < new Date()) {
        await sb.from("image_credits").update({
          used_this_month: 0,
          reset_at: new Date(
            new Date().getFullYear(),
            new Date().getMonth() + 1,
            1
          ).toISOString(),
        }).eq("id", credits.id);
      } else if (credits.used_this_month >= credits.monthly_limit) {
        throw new Error(
          `Limite de ${credits.monthly_limit} imagens/mês atingido (${credits.used_this_month} usados)`
        );
      }
    } else {
      // Create credits row
      await sb.from("image_credits").insert({
        workspace_id: workspaceId,
        used_this_month: 0,
      });
    }

    // Helper: generate SEO alt text for an image URL
    async function generateAltText(imageUrl: string, productName: string): Promise<string | null> {
      try {
        // Try to get prompt from prompt_templates
        const { data: altPromptRow } = await sb
          .from("prompt_templates")
          .select("prompt_text")
          .eq("workspace_id", workspaceId)
          .eq("task_type", "image_alt_text")
          .eq("is_active", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        const altSystemPrompt = altPromptRow?.prompt_text ||
          `Gera um texto alternativo (alt text) otimizado para SEO em Português de Portugal para esta imagem de produto.
O alt text deve:
- Ter no máximo 125 caracteres
- Descrever o produto de forma clara e concisa
- Incluir palavras-chave relevantes para e-commerce
- Ser útil para acessibilidade
Responde APENAS com o texto alt, sem aspas nem formatação extra.`;

        const promptSource = altPromptRow ? "db_version" : "hardcoded_fallback";
        console.log(`🏷️ [alt-text] Prompt source: ${promptSource} for product: ${productName}`);

        const aiResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            taskType: "image_alt_text",
            workspaceId,
            systemPrompt: altSystemPrompt,
            messages: [{
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageUrl } },
                { type: "text", text: `Produto: ${productName}. Gera o alt text para esta imagem.` },
              ],
            }],
            options: { max_tokens: 200 },
          }),
        });

        if (!aiResp.ok) return null;
        const aiWrapper = await aiResp.json();
        const altText = (aiWrapper.result?.choices?.[0]?.message?.content || "").trim().slice(0, 125);
        return altText || null;
      } catch (e) {
        console.warn(`[alt-text] Failed for ${productName}:`, e);
        return null;
      }
    }

    const results: any[] = [];

    for (const productId of productIds) {
      try {
        // Get product
        const { data: product } = await sb
          .from("products")
          .select("id, sku, original_title, image_urls, product_type, parent_product_id")
          .eq("id", productId)
          .single();

        if (!product?.image_urls?.length) {
          results.push({ productId, status: "skipped", reason: "Sem imagens" });
          continue;
        }

        const processedUrls: string[] = [];
        const imageErrors: Array<{ index: number; url: string; error: string }> = [];
        const lifestyleUrls: string[] = [];

        const { data: latestImageRow } = await sb
          .from("images")
          .select("sort_order")
          .eq("product_id", productId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();

        let nextSortOrder =
          typeof latestImageRow?.sort_order === "number"
            ? latestImageRow.sort_order + 1
            : (product.image_urls?.length ?? 0);

        for (let i = 0; i < product.image_urls.length; i++) {
          const originalUrl = product.image_urls[i];
          if (!originalUrl) continue;

          // Validate URL is absolute before processing
          let parsedUrl: URL | null = null;
          try {
            parsedUrl = new URL(originalUrl);
          } catch {
            console.warn(`[process-product-images] Skipping invalid URL for product ${productId}: ${originalUrl}`);
            processedUrls.push(originalUrl);
            imageErrors.push({ index: i, url: originalUrl, error: "Invalid URL" });
            continue;
          }
          if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            console.warn(`[process-product-images] Skipping non-http URL for product ${productId}: ${originalUrl}`);
            processedUrls.push(originalUrl);
            imageErrors.push({ index: i, url: originalUrl, error: "Non-http URL" });
            continue;
          }

          try {
            if (mode === "lifestyle") {
              // Lifestyle mode: generate only from first image
              if (i > 0) continue;

              {
                const productName = product.original_title || product.sku || "produto";
                const prompt = `Coloca este produto num ambiente comercial realista e profissional. O produto deve ser o foco principal, centrado e em destaque. O ambiente deve corresponder à categoria do produto — por exemplo, equipamento de cozinha numa cozinha profissional moderna, mobiliário num espaço elegante. Iluminação profissional, estilo de fotografia comercial de alta qualidade. Produto: ${productName}`;

                const aiResp = await fetch(
                  `${supabaseUrl}/functions/v1/resolve-ai-route`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${serviceKey}`,
                    },
                    body: JSON.stringify({
                      taskType: "image_lifestyle_generation",
                      workspaceId,
                      ...(imageModel ? { modelOverride: imageModel } : {}),
                      messages: [
                        {
                          role: "user",
                          content: [
                            { type: "text", text: prompt },
                            {
                              type: "image_url",
                              image_url: { url: originalUrl },
                            },
                          ],
                        },
                      ],
                      options: {
                        modalities: ["image", "text"],
                      },
                    }),
                  }
                );

                const aiWrapper = await aiResp.json();
                const aiData = aiWrapper.result || aiWrapper;
                const genImage =
                  aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

                if (genImage) {
                  const base64Data = genImage.replace(
                    /^data:image\/\w+;base64,/,
                    ""
                  );
                  const bytes = Uint8Array.from(atob(base64Data), (c) =>
                    c.charCodeAt(0)
                  );

                  const lifestyleId = `${Date.now()}_${crypto
                    .randomUUID()
                    .slice(0, 8)}`;
                  const path = `${workspaceId}/${productId}/lifestyle_${lifestyleId}.webp`;

                  await sb.storage
                    .from("product-images")
                    .upload(path, bytes, {
                      contentType: "image/webp",
                      upsert: true,
                    });

                  const { data: urlData } = sb.storage
                    .from("product-images")
                    .getPublicUrl(path);

                  const lifestyleUrl = urlData.publicUrl;
                  lifestyleUrls.push(lifestyleUrl);
                  processedUrls.push(lifestyleUrl);

                  // Generate alt text for the lifestyle image
                  const productName = product.original_title || product.sku || "produto";
                  const lifestyleAlt = await generateAltText(lifestyleUrl, productName);
                  console.log(`🏷️ [lifestyle] Alt text generated: "${lifestyleAlt}" for ${productId}`);

                  await sb.from("images").insert({
                    product_id: productId,
                    original_url: originalUrl,
                    optimized_url: lifestyleUrl,
                    s3_key: path,
                    sort_order: nextSortOrder,
                    status: "done",
                    alt_text: lifestyleAlt,
                  });

                  nextSortOrder += 1;
                } else {
                  processedUrls.push(originalUrl);
                }
              }

              continue;
            }

            // Optimize/Upscale mode: enhance quality, sharpen, brighten — NO layout changes
            {
              const upscalePrompt = `Melhora a qualidade desta imagem de produto. Torna-a mais nítida, com melhor definição e resolução. Aumenta ligeiramente o brilho e a saturação para cores mais vivas e vibrantes. Remove qualquer desfocagem ou ruído. Mantém o enquadramento, fundo e composição EXATAMENTE como estão — não alteres a posição do produto, não adiciones fundo branco, não recortes. Apenas melhora a qualidade visual da imagem existente. Resultado profissional de e-commerce.`;

              const aiResp = await fetch(
                `${supabaseUrl}/functions/v1/resolve-ai-route`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${serviceKey}`,
                  },
                  body: JSON.stringify({
                    taskType: "image_upscale",
                    workspaceId,
                    ...(imageModel ? { modelOverride: imageModel } : {}),
                    messages: [
                      {
                        role: "user",
                        content: [
                          { type: "text", text: upscalePrompt },
                          {
                            type: "image_url",
                            image_url: { url: originalUrl },
                          },
                        ],
                      },
                    ],
                    options: {
                      modalities: ["image", "text"],
                    },
                  }),
                }
              );

              const aiWrapper = await aiResp.json();
              const aiData = aiWrapper.result || aiWrapper;
              const optimizedImage =
                aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

              if (optimizedImage) {
                const base64Data = optimizedImage.replace(
                  /^data:image\/\w+;base64,/,
                  ""
                );
                // Process in chunks to avoid stack overflow
                const raw = atob(base64Data);
                const chunkSize = 8192;
                const chunks: number[] = [];
                for (let c = 0; c < raw.length; c += chunkSize) {
                  const slice = raw.slice(c, c + chunkSize);
                  for (let j = 0; j < slice.length; j++) {
                    chunks.push(slice.charCodeAt(j));
                  }
                }
                const bytes = new Uint8Array(chunks);

                const upscaleId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
                const path = `${workspaceId}/${productId}/upscale_${upscaleId}.webp`;
                await sb.storage
                  .from("product-images")
                  .upload(path, bytes, {
                    contentType: "image/webp",
                    upsert: true,
                  });

                const { data: urlData } = sb.storage
                  .from("product-images")
                  .getPublicUrl(path);
                processedUrls.push(urlData.publicUrl);

                // Update images table
                await sb.from("images").upsert(
                  {
                    product_id: productId,
                    original_url: originalUrl,
                    optimized_url: urlData.publicUrl,
                    s3_key: path,
                    sort_order: i,
                    status: "done",
                  },
                  { onConflict: "product_id,sort_order", ignoreDuplicates: false }
                );
              } else {
                // AI didn't return image, keep original
                processedUrls.push(originalUrl);
              }
            }
          } catch (imgErr) {
            const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
            console.error(`Error processing image ${i} for ${productId}:`, errMsg);
            // Keep original URL but record that this image failed
            processedUrls.push(originalUrl);
            imageErrors.push({ index: i, url: originalUrl, error: errMsg });
          }
        }

        // === IMPORTANT: NEVER delete/replace original image_urls ===
        // Both modes APPEND new images; originals are always preserved.

        // Collect new URLs generated by AI (not originals)
        const newGeneratedUrls: string[] = [];

        if (mode === "lifestyle" && lifestyleUrls.length > 0) {
          newGeneratedUrls.push(...lifestyleUrls);

          // Propagate to all family members (parent + variations)
          let familyIds: string[] = [productId];

          if (product.product_type === "variable") {
            const { data: children } = await sb
              .from("products")
              .select("id, image_urls")
              .eq("parent_product_id", productId);
            if (children) familyIds.push(...children.map((c: any) => c.id));
          } else if (product.parent_product_id) {
            const parentId = product.parent_product_id;
            familyIds.push(parentId);
            const { data: siblings } = await sb
              .from("products")
              .select("id, image_urls")
              .eq("parent_product_id", parentId)
              .neq("id", productId);
            if (siblings) familyIds.push(...siblings.map((s: any) => s.id));
          }

          for (const fid of familyIds) {
            const { data: famProduct } = await sb
              .from("products")
              .select("id, image_urls")
              .eq("id", fid)
              .single();
            if (!famProduct) continue;

            const existing = Array.isArray(famProduct.image_urls) ? famProduct.image_urls : [];
            const merged = [...existing];
            for (const url of lifestyleUrls) {
              if (!merged.includes(url)) merged.push(url);
            }

            await sb.from("products").update({ image_urls: merged }).eq("id", fid);

            if (fid !== productId) {
              for (const url of lifestyleUrls) {
                await sb.from("images").insert({
                  product_id: fid,
                  original_url: product.image_urls?.[0] || null,
                  optimized_url: url,
                  s3_key: `lifestyle_shared_from_${productId}`,
                  sort_order: (existing.length + lifestyleUrls.indexOf(url)),
                  status: "done",
                });
              }
            }
          }
        } else if (mode === "optimize") {
          // Optimize mode: keep ALL originals, APPEND optimized versions
          // processedUrls has optimized URLs at the same index as originals
          for (let idx = 0; idx < processedUrls.length; idx++) {
            if (processedUrls[idx] !== product.image_urls[idx]) {
              newGeneratedUrls.push(processedUrls[idx]);
            }
          }

          if (newGeneratedUrls.length > 0) {
            // Merge: original URLs first, then new optimized URLs (no duplicates)
            const existing = Array.isArray(product.image_urls) ? product.image_urls : [];
            const merged = [...existing];
            for (const url of newGeneratedUrls) {
              if (!merged.includes(url)) merged.push(url);
            }
            await sb.from("products").update({ image_urls: merged }).eq("id", productId);
            console.log(`📸 Appended ${newGeneratedUrls.length} optimized images for ${productId}. Total: ${merged.length}`);
          }
        }

        // Only increment credits if images were actually generated by AI
        if (newGeneratedUrls.length > 0) {
          await sb.rpc("increment_image_credits", {
            _workspace_id: workspaceId,
          });
        }

        results.push({
          productId,
          status: "done",
          original: product.image_urls.length,
          processed: processedUrls.length,
          imageErrorCount: imageErrors.length,
          imageErrors: imageErrors.length > 0 ? imageErrors : undefined,
        });
      } catch (prodErr) {
        console.error(`Error processing product ${productId}:`, prodErr);
        results.push({
          productId,
          status: "error",
          error: prodErr instanceof Error ? prodErr.message : "Erro",
        });
      }
    }

    return new Response(
      JSON.stringify({
        total: productIds.length,
        processed: results.filter((r) => r.status === "done").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "error").length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("process-product-images error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? (err as Error).message : "Erro interno",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
