import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { directAICall } from "../_shared/ai/direct-ai-call.ts";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { workspaceId, productId, productTitle, productDescription, productCategory, productAttributes } = body;

    if (!workspaceId || !productId || !productTitle) {
      return new Response(JSON.stringify({ error: "Missing required fields: workspaceId, productId, productTitle" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to load custom prompt from prompt_templates
    let systemPrompt = `És um especialista em equipamentos profissionais para hotelaria, restauração e catering em Portugal. Escreves conteúdo editorial em português europeu para um catálogo B2B. O teu público são chefs, responsáveis de F&B, gestores de hotel e compradores profissionais.

Quando descreves como um equipamento é usado, focas em:
- Contextos reais de uso profissional (não doméstico)
- Benefícios operacionais concretos (velocidade, consistência, higiene, custo)
- Linguagem técnica mas acessível
- Casos de uso específicos da hotelaria portuguesa

NUNCA uses linguagem de review de consumidor. 
Escreves como um técnico especialista, não como um cliente.`;

    // Check for custom prompt in prompt_templates
    const { data: customPrompt } = await supabase
      .from("prompt_templates")
      .select("template_text")
      .eq("workspace_id", workspaceId)
      .eq("category", "uso_profissional")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (customPrompt?.template_text) {
      systemPrompt = customPrompt.template_text;
    }

    const attributesText = Array.isArray(productAttributes)
      ? productAttributes.map((a: any) => `${a.name || a.key}: ${a.value || (a.options || []).join(", ")}`).join("\n")
      : "Sem atributos disponíveis";

    const userPrompt = `Produto: ${productTitle}
Categoria: ${productCategory || "Não definida"}
Descrição base: ${productDescription || "Sem descrição"}
Atributos:
${attributesText}

Gera conteúdo editorial de uso profissional para este produto.
Responde APENAS com JSON válido, sem markdown, sem code blocks:
{
  "intro": "1 parágrafo sobre o que este equipamento faz para profissionais",
  "useCases": [
    { "context": "Nome do contexto profissional", "description": "2-3 frases sobre como usam este equipamento" },
    { "context": "Outro contexto", "description": "..." },
    { "context": "Terceiro contexto", "description": "..." }
  ],
  "professionalTips": ["dica 1", "dica 2", "dica 3"],
  "targetProfiles": ["perfil 1", "perfil 2", "perfil 3"]
}`;

    // Use direct-ai-call which respects AI Provider Center routing
    const aiResponse = await directAICall({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.7,
      maxTokens: 2000,
      jsonMode: true,
    });

    const rawContent = aiResponse.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("AI returned empty response");
    }

    // Parse the JSON response
    let parsed;
    try {
      // Clean potential markdown code blocks
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[generate-uso-profissional] Failed to parse AI response:", rawContent);
      throw new Error("AI response was not valid JSON");
    }

    // Validate structure
    const result = {
      intro: typeof parsed.intro === "string" ? parsed.intro : "",
      useCases: Array.isArray(parsed.useCases)
        ? parsed.useCases.filter((uc: any) => uc.context && uc.description)
        : [],
      professionalTips: Array.isArray(parsed.professionalTips)
        ? parsed.professionalTips.filter((t: any) => typeof t === "string")
        : [],
      targetProfiles: Array.isArray(parsed.targetProfiles)
        ? parsed.targetProfiles.filter((t: any) => typeof t === "string")
        : [],
    };

    // Log AI usage
    try {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await serviceClient.from("ai_usage_logs").insert({
        workspace_id: workspaceId,
        task_type: "uso_profissional_generation",
        model_name: aiResponse.model || "unknown",
        input_tokens: aiResponse.usage?.prompt_tokens ?? 0,
        output_tokens: aiResponse.usage?.completion_tokens ?? 0,
        estimated_cost: ((aiResponse.usage?.prompt_tokens ?? 0) * 0.00000015 + (aiResponse.usage?.completion_tokens ?? 0) * 0.0000006),
        decision_source: "direct-ai-call",
      });
    } catch (logErr) {
      console.warn("[generate-uso-profissional] Failed to log usage:", logErr);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-uso-profissional] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
