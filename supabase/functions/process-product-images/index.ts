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

    const { productIds, workspaceId, mode = "optimize", modelOverride, imagePromptTemplateId } = await req.json();
    // mode: "optimize" = pad+enhance, "lifestyle" = generate contextual image
    // modelOverride: optional AI model to use (e.g. "google/gemini-3-pro-image-preview")
    // imagePromptTemplateId: optional specific prompt template ID to use for lifestyle generation
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

    async function getImagePromptById(templateId: string): Promise<string | null> {
      const { data: template } = await sb
        .from("prompt_templates")
        .select("id, base_prompt")
        .eq("id", templateId)
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

    // If a specific image prompt template is provided, use it; otherwise use default active prompts
    let lifestyleGeneratorPrompt: string | null = null;
    let lifestyleGeneratorName = "none";
    if (imagePromptTemplateId) {
      lifestyleGeneratorPrompt = await getImagePromptById(imagePromptTemplateId);
      lifestyleGeneratorName = imagePromptTemplateId;
      console.log(`🎯 [process-images] Using specific image prompt template: ${imagePromptTemplateId} (found: ${!!lifestyleGeneratorPrompt})`);
    }

    const [altPromptTemplate, lifestylePromptTemplate, optimizePromptTemplate, defaultGeneratorPrompt] = await Promise.all([
      getActiveImagePrompt("Imagem — Alt Text SEO"),
      getActiveImagePrompt("Imagem — Lifestyle"),
      getActiveImagePrompt("Imagem — Otimização"),
      !imagePromptTemplateId ? getActiveImagePrompt("Imagem — Lifestyle Prompt Generator") : Promise.resolve(null),
    ]);

    // Use specific template if provided, otherwise use default active generator
    if (!lifestyleGeneratorPrompt && defaultGeneratorPrompt) {
      lifestyleGeneratorPrompt = defaultGeneratorPrompt;
      lifestyleGeneratorName = "Imagem — Lifestyle Prompt Generator (default active)";
    }

    // Log generator resolution for debugging
    console.log(`🔍 [process-images] Generator resolution: generator_found=${!!lifestyleGeneratorPrompt}, generator_name="${lifestyleGeneratorName}", fallback_prompt_found=${!!lifestylePromptTemplate}`);

    function slugify(text: string): string {
      return text
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "-")
        .replace(/[^\w\-]+/g, "")
        .replace(/\-\-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
    }

    function normalizeAltText(value: string | null | undefined): string | null {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      return text ? text.slice(0, 125) : null;
    }

    function buildFallbackAltText(productName: string, imageIndex: number, totalImages: number): string {
      const base = String(productName || "produto profissional").replace(/\s+/g, " ").trim().slice(0, 80) || "produto profissional";
      const suffix = totalImages > 1 ? ` — imagem ${imageIndex + 1}` : "";
      const withBrand = /hotelequip/i.test(base) ? `${base}${suffix}` : `${base}${suffix} | Hotelequip`;
      return withBrand.slice(0, 125);
    }

    async function ensureAllProductImageAlts(product: {
      id: string;
      sku?: string | null;
      original_title?: string | null;
      optimized_title?: string | null;
      image_urls?: string[] | null;
      image_alt_texts?: Record<string, string> | null;
    }): Promise<Record<string, string>> {
      const urls = Array.isArray(product.image_urls) ? product.image_urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0) : [];
      if (urls.length === 0) return {};

      const altTextsObj: Record<string, string> = {};
      const seedAlts = product.image_alt_texts && typeof product.image_alt_texts === "object" && !Array.isArray(product.image_alt_texts)
        ? product.image_alt_texts
        : {};

      for (const [url, alt] of Object.entries(seedAlts)) {
        const normalized = normalizeAltText(alt);
        if (url && normalized) altTextsObj[url] = normalized;
      }

      const { data: existingImages } = await sb
        .from("images")
        .select("optimized_url, alt_text")
        .eq("product_id", product.id)
        .not("optimized_url", "is", null);

      for (const row of existingImages || []) {
        const url = typeof row.optimized_url === "string" ? row.optimized_url : "";
        const normalized = normalizeAltText(row.alt_text);
        if (url && normalized && !altTextsObj[url]) {
          altTextsObj[url] = normalized;
        }
      }

      const productName = product.optimized_title || product.original_title || product.sku || "produto profissional";
      await Promise.all(urls.map(async (url, index) => {
        if (altTextsObj[url]) return;
        const generated = normalizeAltText(await generateAltText(url, productName));
        altTextsObj[url] = generated || buildFallbackAltText(productName, index, urls.length);
      }));

      await sb.from("products").update({ image_alt_texts: altTextsObj }).eq("id", product.id);
      return altTextsObj;
    }

    // Helper: generate SEO alt text for an image URL
    async function generateAltText(imageUrl: string, productName: string): Promise<string | null> {
      try {
        const altSystemPrompt = renderPromptTemplate(
          altPromptTemplate ||
          `Gera um texto alternativo (alt text) otimizado para SEO em Português de Portugal para esta imagem de produto profissional HORECA.
O alt text deve:
- Ser baseado OBRIGATORIAMENTE no título otimizado do produto em PORTUGUÊS
- Ter no máximo 125 caracteres
- Começar pelo nome do produto e incluir "Hotelequip" no final quando houver espaço
- Descrever o produto de forma clara, profissional e concisa
- Incluir palavras-chave relevantes para cozinhas industriais e hotelaria
- Ser útil para acessibilidade
- NÃO usar aspas, emojis ou nomes de marcas de terceiros
Responde APENAS com o texto alt final.`,
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
            options: { max_tokens: 60 },
          }),
        });

        if (!aiResp.ok) return null;
        const aiWrapper = await aiResp.json();
        const altText = normalizeAltText(aiWrapper.result?.choices?.[0]?.message?.content || "");
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
          .select("id, sku, seo_slug, original_title, optimized_title, image_urls, image_alt_texts, product_type, parent_product_id, category, optimized_short_description, short_description")
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

        // === GUARD: filter out already-generated URLs (upscale_ / lifestyle_ / supabase storage) ===
        // Prevents recursive re-processing that creates duplicates and explodes image count.
        const isGeneratedUrl = (u: string) =>
          typeof u === "string" && (
            u.includes("/storage/v1/object/public/product-images/") ||
            u.includes("upscale_") ||
            u.includes("lifestyle_")
          );

        const sourceUrls: string[] = (product.image_urls as string[]).filter((u) => !isGeneratedUrl(u));
        if (sourceUrls.length === 0) {
          console.log(`⏭️ [process-images] Skipping ${productId}: all images are already generated (no original sources to process)`);
          results.push({ productId, status: "skipped", reason: "Sem imagens originais para processar (todas já são geradas)" });
          continue;
        }

        let nextSortOrder =
          typeof latestImageRow?.sort_order === "number"
            ? latestImageRow.sort_order + 1
            : (product.image_urls?.length ?? 0);

        for (let i = 0; i < sourceUrls.length; i++) {
          const originalUrl = sourceUrls[i];
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
              // Lifestyle mode: generate only from first image, only 1 per product per run
              if (i > 0) continue;
              if (lifestyleUrls.length > 0) continue; // already generated one in this run

              {
                const productName = product.original_title || product.sku || "produto";
                const shortDesc = product.optimized_short_description || product.short_description || "";
                const categories = product.category || "";

                // Select original product image (not generated/lifestyle/upscale)
                const originalImage = (product.image_urls as string[]).find((url: string) =>
                  !url.includes('supabase.co/storage') &&
                  !url.includes('lifestyle_') &&
                  !url.includes('upscale_')
                ) ?? product.image_urls[0];

                console.log(`🖼️ [lifestyle] Original image for vision: ${originalImage?.slice(0, 80)}...`);

                // Helper: extract physical terms from description for text-only fallback
                function extractPhysicalTerms(desc: string): string[] {
                  const terms = [
                    'placa', 'chapa', 'queimadores', 'queimador', 'grelha', 'radiante',
                    'ferro fundido', 'anel central', 'porta de vidro', 'porta',
                    'bancada', 'chão', 'pés reguláveis', 'pés', 'gaveta', 'gavetas',
                    'forno', 'banho-maria', 'fritadeira', 'basculante',
                    'aço inoxidável', 'inox', 'cromado', 'esmaltado',
                    'termopar', 'piloto', 'piezoelétrico', 'termóstato',
                    'elétrico', 'gás', 'indução', 'infravermelhos',
                    'tabuleiro', 'cuba', 'torneira', 'prateleira',
                    'rodízios', 'comandos', 'manípulos'
                  ];
                  const lower = (desc || '').toLowerCase();
                  return terms.filter(t => lower.includes(t));
                }

                // ── STEP 1: Generate optimized image prompt via text AI (Prompt Governance) ──
                let imagePrompt: string;
                let promptSource = "hardcoded_fallback";
                let textProvider = "none";
                let generatorError = "";

                // Product dominance framing - always appended
                const PRODUCT_DOMINANCE = "\nthe cooking equipment must occupy at least 60% of the image frame, placed in the foreground, large and dominant, background kitchen environment visible but clearly secondary, tight framing around the product";

                if (lifestyleGeneratorPrompt) {
                  // Use the LIFESTYLE_IMAGE_PROMPT_GENERATOR from Prompt Governance
                  const systemPrompt = renderPromptTemplate(lifestyleGeneratorPrompt, { productName, productType: product.product_type });

                  // Build vision-aware user message (image + text)
                  const textContent = `ANALISA PRIMEIRO A IMAGEM DO PRODUTO.
A imagem é a fonte de verdade sobre as características físicas reais do produto:
- Tipo de superfície (lisa, grelha, queimadores visíveis, placa radiante, topo aberto, etc.)
- Posicionamento (equipamento de chão ou de bancada)
- Características visíveis (portas, janelas, comandos, etc.)
- Materiais e acabamentos visíveis

O prompt de imagem lifestyle que vais gerar DEVE ser 100% fiel ao que vês na imagem — nunca inventar características não visíveis no produto real.

INFORMAÇÃO DO PRODUTO:
- Nome: ${productName}
- Categorias WooCommerce: ${categories}
- Descrição curta: ${shortDesc}`;

                  // Try with image first (vision mode)
                  const visionMessage = originalImage
                    ? [{
                        role: "user",
                        content: [
                          { type: "image_url", image_url: { url: originalImage } },
                          { type: "text", text: textContent },
                        ],
                      }]
                    : [{ role: "user", content: textContent }];

                  console.log(`🔍 [lifestyle] Step 1: Calling text AI with ${originalImage ? 'VISION (image+text)' : 'TEXT-ONLY'} mode, generator prompt (${systemPrompt.length} chars)`);

                  let step1Success = false;

                  try {
                    const textResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
                      body: JSON.stringify({
                        taskType: "image_lifestyle_generation",
                        workspaceId,
                        capability: "text",
                        systemPrompt,
                        messages: visionMessage,
                        options: { max_tokens: 500 },
                      }),
                    });

                    if (!textResp.ok) {
                      generatorError = `HTTP ${textResp.status}: ${textResp.statusText}`;
                      console.error(`❌ [lifestyle] Step 1 vision HTTP error: ${generatorError}`);
                    }

                    const textWrapper = await textResp.json();
                    const textResult = textWrapper.result || textWrapper;
                    const generatedPrompt = (textResult.choices?.[0]?.message?.content || "").trim();
                    textProvider = textResult.model || textWrapper.used_model || "unknown";

                    console.log(`🔍 [lifestyle] Step 1 vision result: status=${textResp.ok}, model=${textProvider}, prompt_length=${generatedPrompt.length}`);
                    if (textWrapper.error) {
                      console.error(`❌ [lifestyle] Step 1 vision API error:`, textWrapper.error);
                      generatorError = String(textWrapper.error);
                    }

                    if (generatedPrompt && generatedPrompt.length > 30) {
                      imagePrompt = generatedPrompt + PRODUCT_DOMINANCE;
                      promptSource = "prompt_governance_lifestyle_generator_vision";
                      console.log(`✅ [lifestyle] Step 1 SUCCESS (vision): AI-generated prompt (${generatedPrompt.length} chars) via ${textProvider}`);
                      step1Success = true;
                    }
                  } catch (visionErr: any) {
                    generatorError = visionErr?.message || String(visionErr);
                    console.warn(`⚠️ [lifestyle] Step 1 vision EXCEPTION: ${generatorError}`);
                  }

                  // Fallback: retry text-only if vision failed and we had an image
                  if (!step1Success && originalImage) {
                    console.log(`🔄 [lifestyle] Step 1: Retrying TEXT-ONLY (vision fallback)...`);
                    const physicalTerms = extractPhysicalTerms(shortDesc + ' ' + (product.optimized_short_description || ''));
                    const textOnlyContent = physicalTerms.length > 0
                      ? `${textContent}\n\nCARACTERÍSTICAS FÍSICAS IDENTIFICADAS NA DESCRIÇÃO:\n${physicalTerms.join(', ')}\nUsa APENAS estas características no prompt de imagem. Não inventes características não listadas.`
                      : textContent;

                    try {
                      const textResp2 = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
                        body: JSON.stringify({
                          taskType: "image_lifestyle_generation",
                          workspaceId,
                          capability: "text",
                          systemPrompt,
                          messages: [{ role: "user", content: textOnlyContent }],
                          options: { max_tokens: 500 },
                        }),
                      });

                      const textWrapper2 = await textResp2.json();
                      const textResult2 = textWrapper2.result || textWrapper2;
                      const generatedPrompt2 = (textResult2.choices?.[0]?.message?.content || "").trim();
                      textProvider = textResult2.model || textWrapper2.used_model || "unknown";

                      if (generatedPrompt2 && generatedPrompt2.length > 30) {
                        imagePrompt = generatedPrompt2 + PRODUCT_DOMINANCE;
                        promptSource = "prompt_governance_lifestyle_generator_text_fallback";
                        console.log(`✅ [lifestyle] Step 1 SUCCESS (text-only fallback): prompt (${generatedPrompt2.length} chars) via ${textProvider}`);
                        step1Success = true;
                      } else {
                        generatorError += ` | Text-only also failed (${generatedPrompt2.length} chars)`;
                      }
                    } catch (textErr: any) {
                      generatorError += ` | Text fallback error: ${textErr?.message}`;
                      console.error(`❌ [lifestyle] Step 1 text-only fallback EXCEPTION:`, textErr);
                    }
                  }

                  // Final fallback: use static prompt template
                  if (!step1Success) {
                    console.warn(`⚠️ [lifestyle] Step 1 ALL ATTEMPTS FAILED: ${generatorError}. Using static fallback.`);
                    imagePrompt = renderPromptTemplate(
                      lifestylePromptTemplate || `Coloca este produto num ambiente comercial realista e profissional. O produto deve ser o foco principal, centrado e em destaque. O ambiente deve corresponder à categoria do produto. Iluminação profissional, estilo de fotografia comercial de alta qualidade. Produto: {{product_name}}`,
                      { productName, productType: product.product_type },
                    ) + PRODUCT_DOMINANCE;
                    promptSource = lifestylePromptTemplate ? "prompt_governance_image_fallback" : "hardcoded_fallback";
                  }
                } else {
                  // No generator prompt available — use direct lifestyle prompt
                  generatorError = "No generator prompt found in DB (Imagem — Lifestyle Prompt Generator not seeded)";
                  console.warn(`⚠️ [lifestyle] ${generatorError}`);
                  imagePrompt = renderPromptTemplate(
                    lifestylePromptTemplate || `Coloca este produto num ambiente comercial realista e profissional. O produto deve ser o foco principal, centrado e em destaque. O ambiente deve corresponder à categoria do produto. Iluminação profissional, estilo de fotografia comercial de alta qualidade. Produto: {{product_name}}`,
                    { productName, productType: product.product_type },
                  ) + PRODUCT_DOMINANCE;
                  promptSource = lifestylePromptTemplate ? "prompt_governance_image" : "hardcoded_fallback";
                }

                console.log(`🖼️ [lifestyle] Prompt source: ${promptSource} | Text provider: ${textProvider}${generatorError ? ` | Error: ${generatorError}` : ""}`);


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
                        image_size: "1024x1024",
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

                  const fileSizeKB = Math.round(bytes.length / 1024);
                  console.log(`📐 [lifestyle] Image size: ${fileSizeKB}KB for ${productId}`);
                  if (bytes.length > 1024 * 1024) {
                    console.warn(`⚠️ [lifestyle] Image exceeds 1MB (${fileSizeKB}KB) for ${productId} — WooCommerce may timeout on download`);
                  }

                  const productSlug = product.seo_slug || slugify(product.optimized_title || product.original_title || product.sku || "produto");
                  const path = `${workspaceId}/${productId}/${productSlug}-lifestyle.jpg`;

                  await sb.storage
                    .from("product-images")
                    .upload(path, bytes, {
                      contentType: "image/jpeg",
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
                  const lifestyleAlt = normalizeAltText(await generateAltText(lifestyleUrl, productName)) || buildFallbackAltText(productName, nextSortOrder, (product.image_urls?.length ?? 0) + 1);
                  console.log(`🏷️ [lifestyle] Alt text generated: "${lifestyleAlt}" for ${productId}`);

                  await sb.from("images").insert({
                    product_id: productId,
                    original_url: originalUrl,
                    optimized_url: lifestyleUrl,
                    s3_key: path,
                    sort_order: nextSortOrder,
                    status: "done",
                    alt_text: lifestyleAlt,
                    generation_prompt: `${imagePrompt}\n\n--- METADATA ---\nprompt_source: ${promptSource}\ntext_provider: ${textProvider}\nimage_provider: ${imageModel || "default_routed"}${generatorError ? `\ngenerator_error: ${generatorError}` : ""}`,
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
                      image_size: "1024x1024",
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

                const fileSizeKB = Math.round(bytes.length / 1024);
                console.log(`📐 [upscale] Image size: ${fileSizeKB}KB for ${productId} image ${i}`);
                if (bytes.length > 1024 * 1024) {
                  console.warn(`⚠️ [upscale] Image exceeds 1MB (${fileSizeKB}KB) for ${productId} image ${i} — WooCommerce may timeout on download`);
                }

                const productSlug = product.seo_slug || slugify(product.optimized_title || product.original_title || product.sku || "produto");
                const path = `${workspaceId}/${productId}/${productSlug}-${i + 1}.jpg`;
                await sb.storage
                  .from("product-images")
                  .upload(path, bytes, {
                    contentType: "image/jpeg",
                    upsert: true,
                  });

                const { data: urlData } = sb.storage
                  .from("product-images")
                  .getPublicUrl(path);
                processedUrls.push(urlData.publicUrl);

                // Generate alt text for the optimized image
                const productName = product.original_title || product.sku || "produto";
                  const optimizedAlt = normalizeAltText(await generateAltText(urlData.publicUrl, productName)) || buildFallbackAltText(productName, i, product.image_urls?.length ?? 1);
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

        const altTextsObj = await ensureAllProductImageAlts(product);
        console.log(`🏷️ Synced ${Object.keys(altTextsObj).length} alt texts to product ${productId}`);

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
