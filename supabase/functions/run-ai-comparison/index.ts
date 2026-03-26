import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function toProviderModel(modelId: string): string {
  if (modelId.includes("/")) return modelId;
  if (modelId.startsWith("gemini-"))  return `google/${modelId}`;
  if (modelId.startsWith("gpt-"))     return `openai/${modelId}`;
  if (modelId.startsWith("claude-"))  return `anthropic/${modelId}`;
  // TODO: resolve-ai-route does not yet support deepseek provider.
  // DeepSeek models are is_active=false in ai_model_pricing until this is wired.
  if (modelId.startsWith("deepseek")) return `deepseek/${modelId}`;
  return modelId;
}

function providerFromModel(modelId: string): string {
  if (modelId.startsWith("gemini-") || modelId.startsWith("google/"))     return "gemini";
  if (modelId.startsWith("gpt-")    || modelId.startsWith("openai/"))     return "openai";
  if (modelId.startsWith("claude-") || modelId.startsWith("anthropic/"))  return "anthropic";
  return "unknown";
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  title:             "Título do produto (máx 70 caracteres, SEO-friendly, em português)",
  short_description: "Descrição curta do produto (2-3 frases concisas, máx 150 caracteres, em português)",
  description:       "Descrição detalhada do produto com características e benefícios, em HTML (3-5 parágrafos, em português)",
  seo_title:         "Meta título SEO (máx 60 caracteres, inclui palavra-chave principal, em português)",
  meta_description:  "Meta descrição SEO (máx 155 caracteres, chamada à ação, em português)",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      runId,
      productId,
      modelId,
      sections,
      workspaceId,
    }: {
      runId: string;
      productId: string;
      modelId: string;
      sections: string[];
      workspaceId: string;
    } = await req.json();

    if (!runId || !productId || !modelId || !sections?.length || !workspaceId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase    = createClient(supabaseUrl, serviceKey);

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, original_title, optimized_title, original_description, optimized_description, short_description, optimized_short_description, meta_title, meta_description, category, sku, tags")
      .eq("id", productId)
      .single();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: pricing } = await supabase
      .from("ai_model_pricing")
      .select("input_cost_per_1m, output_cost_per_1m")
      .eq("model_id", modelId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const validSections = sections.filter((s) => !!SECTION_DESCRIPTIONS[s]);
    const sectionProperties: Record<string, { type: string; description: string }> = {};
    for (const section of validSections) {
      sectionProperties[section] = { type: "string", description: SECTION_DESCRIPTIONS[section] };
    }

    const toolDef = {
      type: "function",
      function: {
        name: "generate_product_content",
        description: "Generate optimized content for the specified product sections",
        parameters: {
          type: "object",
          properties: sectionProperties,
          required: validSections,
        },
      },
    };

    const productContext = [
      `Título atual: ${product.optimized_title || product.original_title || "N/A"}`,
      `Categoria: ${product.category || "N/A"}`,
      `Tags: ${(product.tags || []).join(", ") || "N/A"}`,
      `Descrição atual: ${(product.optimized_description || product.original_description || "").slice(0, 600)}`,
    ].join("\n");

    const systemPrompt =
      "És um especialista em copywriting de produtos de e-commerce. Geras conteúdo otimizado para SEO e conversão, sempre em português de Portugal.";

    const userMessage =
      `Produto:\n${productContext}\n\nGera conteúdo otimizado apenas para as secções pedidas. Responde usando a ferramenta generate_product_content.`;

    const t0 = Date.now();
    const routeResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        taskType: "product_optimization",
        workspaceId,
        messages: [{ role: "user", content: userMessage }],
        systemPrompt,
        options: {
          tools: [toolDef],
          tool_choice: { type: "function", function: { name: "generate_product_content" } },
        },
        modelOverride: toProviderModel(modelId),
      }),
    });
    const latencyMs = Date.now() - t0;

    if (!routeResp.ok) {
      const errText = await routeResp.text();
      throw new Error(`resolve-ai-route ${routeResp.status}: ${errText}`);
    }

    const routeData = await routeResp.json();
    const usage        = routeData.result?.usage ?? {};
    const inputTokens  = usage.prompt_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? 0;

    let generated: Record<string, string> = {};
    try {
      const rawArgs = routeData.result?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      generated = typeof rawArgs === "string" ? JSON.parse(rawArgs) : (rawArgs ?? {});
    } catch {
      const content = routeData.result?.choices?.[0]?.message?.content ?? "";
      try { generated = JSON.parse(content); } catch { /* ignore */ }
    }

    const totalCost = pricing
      ? (inputTokens  / 1_000_000) * Number(pricing.input_cost_per_1m) +
        (outputTokens / 1_000_000) * Number(pricing.output_cost_per_1m)
      : 0;
    const costPerSection   = validSections.length > 0 ? totalCost / validSections.length : 0;
    const tokensPerSection = {
      input:  Math.round(inputTokens  / (validSections.length || 1)),
      output: Math.round(outputTokens / (validSections.length || 1)),
    };

    const providerId = providerFromModel(modelId);

    const rows = validSections
      .filter((s) => generated[s] !== undefined)
      .map((section) => ({
        run_id:         runId,
        product_id:     productId,
        model_id:       modelId,
        provider_id:    providerId,
        section,
        output_text:    String(generated[section] ?? ""),
        input_tokens:   tokensPerSection.input,
        output_tokens:  tokensPerSection.output,
        estimated_cost: costPerSection,
        latency_ms:     latencyMs,
        selected:       false,
      }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from("ai_comparison_results")
        .insert(rows);
      if (insertError) throw insertError;
    }

    return new Response(
      JSON.stringify({ ok: true, sectionsGenerated: rows.length, latencyMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[run-ai-comparison]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
