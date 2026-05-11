import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Variação de tom para evitar descrições repetitivas
const TONE_VARIATIONS = [
  "Escreve com um tom direto e confiante, como se estivesses a apresentar o equipamento a um chef experiente que sabe exatamente o que precisa.",
  "Adota um tom consultivo e informativo, como um especialista que ajuda o comprador a tomar a melhor decisão para o seu negócio.",
  "Usa um tom prático e objetivo, focando nos resultados concretos que este equipamento entrega no dia-a-dia de uma cozinha profissional.",
  "Escreve como se fosse uma recomendação pessoal entre profissionais — genuína, com conhecimento de causa, sem exageros.",
  "Adota um tom técnico mas acessível, que demonstra domínio do produto sem ser intimidante para quem está a equipar um novo espaço.",
];

const OPENING_STYLES = [
  "Começa com o benefício principal — o que este equipamento resolve ou melhora na operação.",
  "Abre com o contexto de utilização — onde e como este equipamento se integra numa cozinha profissional.",
  "Inicia com uma afirmação factual sobre a capacidade ou performance do equipamento.",
  "Começa pelo diferencial técnico — o que torna este modelo específico uma escolha inteligente.",
  "Abre com a aplicação prática — para que tipo de estabelecimento e volume de trabalho é ideal.",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product, language } = await req.json();
    if (!workspace_id || !product) throw new Error("workspace_id and product are required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const lang = language || "pt";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Selecionar variação aleatória para diversidade
    const toneVariation = TONE_VARIATIONS[Math.floor(Math.random() * TONE_VARIATIONS.length)];
    const openingStyle = OPENING_STYLES[Math.floor(Math.random() * OPENING_STYLES.length)];

    const langInstruction = lang === "pt" ? "Português de Portugal (pt-PT)" 
      : lang === "es" ? "Espanhol" 
      : lang === "fr" ? "Francês" 
      : "Inglês";

    const systemPrompt = `És um copywriter especialista em equipamento profissional para hotelaria, restauração e catering.

IDIOMA: Escreve em ${langInstruction}.

REGRAS DE LINGUAGEM NATURAL — OBRIGATÓRIO:
O conteúdo DEVE soar humano, conversacional e natural. NUNCA soar robótico ou repetitivo.

1. LIMITAR "HORECA": Máximo 1 menção por texto. Substituir por: "o seu restaurante", "o seu bar", "cozinhas profissionais", "negócio de hotelaria".
2. TOM CONVERSACIONAL: Dirige-te ao cliente ("Perfeito para o seu restaurante", "A sua equipa vai apreciar").
3. VARIAR CONSTRUÇÕES: Nunca começar 2 parágrafos seguidos com "Este equipamento..." ou "Este produto...". Alternar com: "Projetado para...", "Com capacidade para...", "Ideal para...", "Graças ao...".
4. CONTEXTO ESPECÍFICO: Usar contextos concretos ("pizzarias movimentadas", "buffet de hotel") em vez de vagos ("uso profissional").
5. BENEFÍCIOS REAIS: Explicar o impacto no negócio ("reduz custos", "isola o ruído") em vez de apenas specs técnicas.

TOM E PERSONALIDADE:
${toneVariation}

ABERTURA:
${openingStyle}

REGRAS DE ESCRITA ADICIONAIS:
- Sê específico: em vez de "alta qualidade", diz "construção em aço inox AISI 304"
- Sê útil: menciona aplicações reais (ex: "ideal para serviço de 80-120 refeições/dia")
- Sê honesto: não inventes specs que não foram fornecidas
- NUNCA uses clichés como "revolucionário", "incrível", "o melhor do mercado"
- NUNCA comeces com "Descubra" ou "Apresentamos" — vai direto ao valor
- Menciona normas relevantes (CE, HACCP) quando aplicável
- Usa verbos de ação: "produz", "mantém", "reduz", "otimiza", "suporta"

ESTRUTURA short_description:
- 1-2 frases, máximo 160 caracteres
- Foca no benefício operacional principal + 1 spec diferenciadora
- Deve funcionar como snippet em listagens de produtos

ESTRUTURA long_description (HTML com estilos inline para compatibilidade WooCommerce):
Envolve TUDO num div raiz: <div class="product-description" style="font-size:15px; line-height:1.65; color:#2c2c2c;"> ... </div> (Obrigatório fechar o div no final).

Cada secção é um div com classe própria e margin-bottom:22px. Usa h2 para secções principais e h3 para subsecções, com este estilo:
H2 (secções principais): style="margin:0 0 10px; font-size:18px; font-weight:700; color:#00526d; border-bottom:2px solid #e5e7eb; padding-bottom:6px;"
H3 (subsecções): style="margin:0 0 8px; font-size:16px; font-weight:700; color:#2c2c2c;"

SECÇÕES OBRIGATÓRIAS (nesta ordem):

1. <div class="product-benefits"> com <h2>Principais Vantagens</h2>
   - Dentro de <div style="margin-top:10px;">, parágrafos com benefícios-chave (2-4 bullets ou parágrafos)

2. <div class="product-applications"> com <h2>Aplicações</h2>
   - Dentro de <div style="margin-top:10px;">, aplicações concretas: tipos de estabelecimento, volume, situações

3. <div class="product-specs"> com <h2>Especificações Técnicas</h2>
   - <div class="specs-table" style="margin-top:10px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
   - Dentro, <table style="width:100%; border-collapse:collapse; font-size:0.9em;">
   - th: style="border:1px solid #e5e7eb; padding:8px 12px; background:#f3f4f6; font-weight:bold; text-align:left; text-transform:uppercase; font-size:0.8em; letter-spacing:0.05em;"
   - td: style="border:1px solid #e5e7eb; padding:8px 12px;"

4. <div class="product-faq"> com <h2>Perguntas Frequentes</h2>
   - MÁXIMO 4 perguntas (nunca mais de 4, mínimo 2)
   - Dentro de <div style="margin-top:10px; background:#fcfcfd; border:1px solid #e5e7eb; border-radius:8px; padding:14px 16px;">
   - NÃO uses <details>/<summary> — as respostas são SEMPRE visíveis
   - Cada FAQ como:
     <p style="font-weight:bold; margin:0 0 4px; color:#2c2c2c;">Pergunta aqui?</p>
     <p style="font-style:italic; color:#6b7280; margin:0 0 14px;">Resposta aqui.</p>

REGRAS SEO:
- Keywords naturais no texto, sem stuffing.
- A primeira frase deve conter a keyword principal do produto.
- OBRIGATÓRIO: Utiliza sinónimos e variações linguísticas do produto ao longo do texto (ex: se é uma 'Campânula', usa também 'hotte', 'coifa', 'exaustor').
- Inclui variações long-tail nas keywords (ex: "fritadeira a gás 8 litros profissional").
- Alt-text pensado para pesquisa, não para decoração.

FORMATO DE RESPOSTA (JSON puro, sem markdown fences):
{
  "short_description": "string",
  "long_description": "string (HTML)",
  "seo_keywords": ["string"],
  "confidence_score": 0.0-1.0
}`;

    const userPrompt = `Gera descrição para este produto:

Título: ${product.title || product.original_title || "N/A"}
Marca/Linha: ${product.brand || "N/A"}
Categoria: ${product.category || "N/A"}
Descrição Atual: ${product.description || product.original_description || "N/A"}
Specs Técnicas: ${product.technical_specs || "N/A"}
Atributos: ${product.attributes ? JSON.stringify(product.attributes) : "N/A"}
Preço: ${product.price || product.original_price || "N/A"}`;

    // Use centralized resolve-ai-route
    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        taskType: "description_generation",
        workspaceId: workspace_id,
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        options: { max_tokens: 2048 },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI Route error: ${aiResponse.status} - ${errText}`);
    }

    const routeData = await aiResponse.json();
    const aiMeta = routeData.meta || {};
    const promptSource = aiMeta.promptSource || "unknown";
    console.log(`📋 [generate-description] Prompt source: ${promptSource} | Provider: ${aiMeta.usedProvider || "?"} | Model: ${aiMeta.usedModel || "?"}`);
    const content = (routeData.result?.choices?.[0]?.message?.content || "")
      .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = {
        short_description: "",
        long_description: "",
        seo_keywords: [],
        confidence_score: 0,
        error: "Failed to parse AI response",
      };
    }

    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "product_description_generator",
      status: "completed",
      input_payload: { title: product.title || product.original_title, language: lang },
      output_payload: result,
      confidence_score: result.confidence_score,
      cost_estimate: routeData.result?.usage ? (routeData.result.usage.prompt_tokens + routeData.result.usage.completion_tokens) * 0.000001 : null,
      completed_at: new Date().toISOString(),
    });

    // Update the product with generated content
    const updateData: any = {
      optimized_short_description: result.short_description || "",
      seo_short_description: result.short_description || "", // Clean text version
      optimized_description: result.long_description || "",
      seo_keywords: result.seo_keywords || [],
    };

    await supabase
      .from("products")
      .update(updateData)
      .eq("id", product.id);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
