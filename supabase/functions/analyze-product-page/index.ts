import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { sampleHtmlPages, mode } = await req.json();
    // sampleHtmlPages: Array<{ url: string; html: string; isProduct?: boolean }>
    // mode: "fingerprint" | "fields" | "both"

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const effectiveMode = mode || "both";

    // Build a compact representation of each page (strip scripts/styles, keep structure)
    const pageDigests = sampleHtmlPages.map((p: any, i: number) => {
      // Strip scripts and styles, keep first 8000 chars of body
      const bodyMatch = p.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      let content = bodyMatch ? bodyMatch[1] : p.html;
      content = content
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 6000);
      return `PAGE ${i + 1} (${p.url})${p.isProduct != null ? ` [labeled: ${p.isProduct ? 'product' : 'non-product'}]` : ''}:\n${content}`;
    }).join("\n\n---\n\n");

    let systemPrompt = "";
    let userPrompt = "";

    if (effectiveMode === "fingerprint" || effectiveMode === "both") {
      systemPrompt = `És um especialista em análise de estrutura web. Analisas a estrutura HTML de páginas para identificar os seletores CSS e padrões XPath que identificam de forma única os campos de dados dos produtos.

A tua tarefa:
1. FINGERPRINT: Identifica o que distingue páginas de PRODUTO de páginas que NÃO são produto (categorias, sobre, contacto, etc).
   Procura padrões diferenciadores como:
   - Presença de SKU/números de referência
   - Elementos de preço
   - Botões de adicionar ao carrinho
   - Dados estruturados específicos de produto (schema.org Product)
   - Classes CSS ou estruturas HTML únicas de páginas de produto

2. FIELDS: Para páginas que SÃO produtos, identifica os seletores CSS para os campos extraíveis.

Devolve APENAS JSON válido com esta estrutura:
{
  "fingerprint": {
    "product_indicators": [
      { "pattern": "CSS selector or text pattern", "type": "selector|text|attribute", "confidence": 0.0-1.0, "description": "why this indicates a product" }
    ],
    "non_product_indicators": [
      { "pattern": "pattern", "type": "selector|text|attribute", "confidence": 0.0-1.0, "description": "why this indicates NOT a product" }
    ]
  },
  "fields": [
    { "name": "field name in Portuguese", "selector": "CSS selector", "type": "text|image|html|link", "confidence": 0.0-1.0, "sample_value": "preview text" }
  ],
  "overall_confidence": 0.0-1.0
}`;

      userPrompt = `Analyze these ${sampleHtmlPages.length} web pages and identify:
1. What patterns distinguish PRODUCT pages from non-product pages
2. What fields can be extracted from product pages and their CSS selectors

${pageDigests}`;
    } else if (effectiveMode === "fields") {
      systemPrompt = `És um especialista em análise de páginas web de fornecedores. Analisas o HTML de páginas de produtos e extraís os campos de produto solicitados.

Devolve APENAS JSON válido:
{
  "fields": [
    { "name": "field name in Portuguese", "selector": "CSS selector", "type": "text|image|html|link", "confidence": 0.0-1.0, "sample_value": "preview" }
  ],
  "overall_confidence": 0.0-1.0
}

Campos comuns a procurar: Título, Referência/SKU, Preço, Descrição, Imagem Principal, Galeria, Características/Especificações, Categoria, Marca, Peso, Dimensões, Stock, EAN/GTIN, Documentos PDF.`;

      userPrompt = `Analyze these product page(s) and identify all extractable fields with precise CSS selectors:

${pageDigests}`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    // Parse the JSON from the AI response
    let parsed: any = {};
    try {
      // Try to extract JSON from markdown code blocks or raw
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[ \s\S]*\})/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      }
    } catch (e: unknown) {
      console.error("Failed to parse AI response:", content);
      parsed = { error: "Failed to parse AI response", raw: content.substring(0, 500) };
    }

    return new Response(JSON.stringify({ success: true, analysis: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: unknown) {
    console.error("analyze-product-page error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? (e as Error).message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
