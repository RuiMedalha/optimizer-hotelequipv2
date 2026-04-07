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

    const renderPromptTemplate = (
      template: string,
      context: { productName: string; productType?: string | null },
    ) => {
      return template
        .replaceAll("{{product_name}}", context.productName)
        .replaceAll("{{product_type}}", context.productType || "produto");
    };

    async function getActiveImagePrompt(promptName: string): Promise<string | null> {
      const { data: template } = await sb
        .from("prompt_templates")
        .select("id, base_prompt")
        .eq("workspace_id", workspaceId)
        .eq("prompt_type", "image")
        .eq("prompt_name", promptName)
        .eq("is_active", true)
        .maybeSingle();

      if (!template?.id) return null;

      const { data: version } = await sb
        .from("prompt_versions")
        .select("prompt_text")
        .eq("template_id", template.id)
        .eq("is_active", true)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      return version?.prompt_text || template.base_prompt || null;
    }

    const [altPromptTemplate, lifestylePromptTemplate, optimizePromptTemplate, lifestyleGeneratorPrompt] = await Promise.all([
      getActiveImagePrompt("Imagem — Alt Text SEO"),
      getActiveImagePrompt("Imagem — Lifestyle"),
      getActiveImagePrompt("Imagem — Otimização"),
      getActiveImagePrompt("Imagem — Lifestyle Prompt Generator"),
    ]);

    // Helper: generate SEO alt text for an image URL
    async function generateAltText(imageUrl: string, productName: string): Promise<string | null> {
      try {
        const altSystemPrompt = renderPromptTemplate(
          altPromptTemplate ||
          `Gera um texto alternativo (alt text) otimizado para SEO em Português de Portugal para esta imagem de produto.
O alt text deve:
- Ter no máximo 125 caracteres
- Descrever o produto de forma clara e concisa
- Incluir palavras-chave relevantes para e-commerce
- Ser útil para acessibilidade
 Responde APENAS com o texto alt, sem aspas nem formatação extra.`,
          { productName, productType: null },
        );

        const promptSource = altPromptTemplate ? "prompt_governance_image" : "hardcoded_fallback";
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
          .select("id, sku, original_title, image_urls, product_type, parent_product_id, category, optimized_short_description, short_description")
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
                const shortDesc = product.optimized_short_description || product.short_description || "";
                const categories = product.category || "";

                // ── STEP 1: Generate optimized image prompt via text AI (Prompt Governance) ──
                let imagePrompt: string;
                let promptSource = "hardcoded_fallback";
                let textProvider = "none";

                if (lifestyleGeneratorPrompt) {
                  // Use the LIFESTYLE_IMAGE_PROMPT_GENERATOR from Prompt Governance
                  const systemPrompt = renderPromptTemplate(lifestyleGeneratorPrompt, { productName, productType: product.product_type });
                  const userMessage = `INFORMAÇÃO DO PRODUTO:\n- Nome: ${productName}\n- Categorias WooCommerce: ${categories}\n- Descrição curta: ${shortDesc}`;

                  try {
                    const textResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
                      body: JSON.stringify({
                        taskType: "image_lifestyle_generation",
                        workspaceId,
                        capability: "text",
                        systemPrompt,
                        messages: [{ role: "user", content: userMessage }],
                        options: { max_tokens: 500 },
                      }),
                    });
                    const textWrapper = await textResp.json();
                    const textResult = textWrapper.result || textWrapper;
                    const generatedPrompt = (textResult.choices?.[0]?.message?.content || "").trim();
                    textProvider = textResult.model || textWrapper.used_model || "unknown";

                    if (generatedPrompt && generatedPrompt.length > 30) {
                      imagePrompt = generatedPrompt;
                      promptSource = "prompt_governance_lifestyle_generator";
                      console.log(`🎯 [lifestyle] AI-generated prompt (${imagePrompt.length} chars) via ${textProvider}`);
                    } else {
                      console.warn(`[lifestyle] Generator returned short/empty result, falling back`);
                      imagePrompt = renderPromptTemplate(
                        lifestylePromptTemplate || `Coloca este produto num ambiente comercial realista e profissional. O produto deve ser o foco principal, centrado e em destaque. O ambiente deve corresponder à categoria do produto. Iluminação profissional, estilo de fotografia comercial de alta qualidade. Produto: {{product_name}}`,
                        { productName, productType: product.product_type },
                      );
                      promptSource = lifestylePromptTemplate ? "prompt_governance_image_fallback" : "hardcoded_fallback";
                    }
                  } catch (genErr) {
                    console.warn(`[lifestyle] Prompt generator failed, using fallback:`, genErr);
                    imagePrompt = renderPromptTemplate(
                      lifestylePromptTemplate || `Coloca este produto num ambiente comercial realista e profissional. O produto deve ser o foco principal, centrado e em destaque. O ambiente deve corresponder à categoria do produto. Iluminação profissional, estilo de fotografia comercial de alta qualidade. Produto: {{product_name}}`,
                      { productName, productType: product.product_type },
                    );
                    promptSource = lifestylePromptTemplate ? "prompt_governance_image_fallback" : "hardcoded_fallback";
                  }
                } else {
                  // No generator prompt available — use direct lifestyle prompt
                  imagePrompt = renderPromptTemplate(
                    lifestylePromptTemplate || `Coloca este produto num ambiente comercial realista e profissional. O produto deve ser o foco principal, centrado e em destaque. O ambiente deve corresponder à categoria do produto. Iluminação profissional, estilo de fotografia comercial de alta qualidade. Produto: {{product_name}}`,
                    { productName, productType: product.product_type },
                  );
                  promptSource = lifestylePromptTemplate ? "prompt_governance_image" : "hardcoded_fallback";
                }

                console.log(`🖼️ [lifestyle] Prompt source: ${promptSource} | Text provider: ${textProvider}`);

                // ── STEP 2: Generate the image using the crafted prompt ──
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
                            { type: "text", text: imagePrompt },
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
                    generation_prompt: `${imagePrompt}\n\n--- METADATA ---\nprompt_source: ${promptSource}\ntext_provider: ${textProvider}\nimage_provider: ${imageModel || "default_routed"}`,
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
              const upscalePrompt = renderPromptTemplate(
                optimizePromptTemplate || `Melhora a qualidade desta imagem de produto. Torna-a mais nítida, com melhor definição e resolução. Aumenta ligeiramente o brilho e a saturação para cores mais vivas e vibrantes. Remove qualquer desfocagem ou ruído. Mantém o enquadramento, fundo e composição EXATAMENTE como estão — não alteres a posição do produto, não adiciones fundo branco, não recortes. Apenas melhora a qualidade visual da imagem existente. Resultado profissional de e-commerce.`,
                {
                  productName: product.original_title || product.sku || "produto",
                  productType: product.product_type,
                },
              );

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

                // Generate alt text for the optimized image
                const productName = product.original_title || product.sku || "produto";
                const optimizedAlt = await generateAltText(urlData.publicUrl, productName);
                console.log(`🏷️ [optimize] Alt text generated: "${optimizedAlt}" for ${productId} image ${i}`);

                // Update images table
                await sb.from("images").upsert(
                  {
                    product_id: productId,
                    original_url: originalUrl,
                    optimized_url: urlData.publicUrl,
                    s3_key: path,
                    sort_order: i,
                    status: "done",
                    alt_text: optimizedAlt,
                    generation_prompt: upscalePrompt,
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
                // Reuse the alt text from the original lifestyle image
                const { data: srcImg } = await sb
                  .from("images")
                  .select("alt_text")
                  .eq("product_id", productId)
                  .eq("optimized_url", url)
                  .maybeSingle();

                await sb.from("images").insert({
                  product_id: fid,
                  original_url: product.image_urls?.[0] || null,
                  optimized_url: url,
                  s3_key: `lifestyle_shared_from_${productId}`,
                  sort_order: (existing.length + lifestyleUrls.indexOf(url)),
                  status: "done",
                  alt_text: srcImg?.alt_text || null,
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

        // Sync image_alt_texts JSONB on the product from images table
        const { data: allImgs } = await sb
          .from("images")
          .select("optimized_url, alt_text")
          .eq("product_id", productId)
          .not("alt_text", "is", null);

        if (allImgs && allImgs.length > 0) {
          const altTextsObj: Record<string, string> = {};
          for (const img of allImgs) {
            if (img.optimized_url && img.alt_text) {
              altTextsObj[img.optimized_url] = img.alt_text;
            }
          }
          await sb.from("products").update({ image_alt_texts: altTextsObj }).eq("id", productId);
          console.log(`🏷️ Synced ${Object.keys(altTextsObj).length} alt texts to product ${productId}`);
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
