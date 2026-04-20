import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { directAICall } from "../_shared/ai/direct-ai-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Robust JSON extraction — handles markdown, bullets, partial JSON */
function extractJsonFromResponse(raw: string): unknown {
  // Strip markdown code blocks
  let cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Find JSON boundaries
  const jsonStart = cleaned.search(/[\{\[]/);
  if (jsonStart === -1) {
    throw new Error("No JSON object found in response");
  }
  const opener = cleaned[jsonStart];
  const closer = opener === "[" ? "]" : "}";
  const jsonEnd = cleaned.lastIndexOf(closer);
  if (jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("No matching JSON close bracket found");
  }

  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);

  // First attempt
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    // Fix common LLM issues
    cleaned = cleaned
      .replace(/,\s*}/g, "}")          // trailing commas before }
      .replace(/,\s*]/g, "]")          // trailing commas before ]
      .replace(/[\x00-\x1F\x7F]/g, " ") // control characters
      .replace(/"\s*\n\s*"/g, '", "');   // newline-split strings

    try {
      return JSON.parse(cleaned);
    } catch (_e2) {
      throw new Error("Could not parse JSON after cleanup");
    }
  }
}

/** Build result from a possibly messy AI response — extracts fields even if structure varies */
function normalizeUsoProfissional(parsed: any): {
  intro: string;
  useCases: Array<{ context: string; description: string }>;
  professionalTips: string[];
  targetProfiles: string[];
} {
  const intro = typeof parsed.intro === "string" ? parsed.intro : "";

  // useCases might be an array of objects or an array of strings
  let useCases: Array<{ context: string; description: string }> = [];
  if (Array.isArray(parsed.useCases)) {
    useCases = parsed.useCases
      .map((uc: any) => {
        if (typeof uc === "string") return { context: uc, description: uc };
        if (uc && typeof uc === "object" && (uc.context || uc.description)) {
          return { context: uc.context || "", description: uc.description || "" };
        }
        return null;
      })
      .filter(Boolean);
  } else if (Array.isArray(parsed.use_cases)) {
    useCases = parsed.use_cases
      .map((uc: any) => {
        if (typeof uc === "string") return { context: uc, description: uc };
        if (uc && typeof uc === "object") return { context: uc.context || uc.nome || "", description: uc.description || uc.descricao || "" };
        return null;
      })
      .filter(Boolean);
  }

  const extractStrings = (val: any): string[] => {
    if (Array.isArray(val)) return val.filter((t: any) => typeof t === "string" && t.trim());
    return [];
  };

  const professionalTips = extractStrings(parsed.professionalTips || parsed.professional_tips || parsed.dicas);
  const targetProfiles = extractStrings(parsed.targetProfiles || parsed.target_profiles || parsed.perfis);

  return { intro, useCases, professionalTips, targetProfiles };
}

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
      .select("template_text:base_prompt")
      .eq("workspace_id", workspaceId)
      .eq("prompt_type", "uso_profissional")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
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
Responde APENAS com JSON válido, sem markdown, sem code blocks, sem bullets:
{
  "intro": "1 parágrafo sobre o que este equipamento faz para profissionais",
  "useCases": [
    { "context": "Nome do contexto profissional", "description": "2-3 frases sobre como usam este equipamento" },
    { "context": "Outro contexto", "description": "..." },
    { "context": "Terceiro contexto", "description": "..." }
  ],
  "professionalTips": ["dica 1", "dica 2", "dica 3"],
  "targetProfiles": ["perfil 1", "perfil 2", "perfil 3"]
}

IMPORTANTE: Devolve APENAS o JSON acima. Sem texto antes ou depois. Sem markdown.`;

    // Resolve model from ai_routing_rules with precedence:
    // workspace-specific rule -> global rule -> safe low-cost fallback.
    // Important: never fall back to workspace default provider here, because
    // direct-only defaults can silently bounce into a paid gateway preview model.
    let resolvedModel = "google/gemini-2.5-flash";
    let modelSource = "safe_fallback";
    try {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const taskTypes = ["uso_profissional_generation", "uso_profissional", "content_generation"];

      const { data: workspaceRule } = await serviceClient
        .from("ai_routing_rules")
        .select("model_override, recommended_model, fallback_model")
        .eq("workspace_id", workspaceId)
        .in("task_type", taskTypes)
        .eq("is_active", true)
        .order("execution_priority", { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: globalRule } = workspaceRule
        ? { data: null }
        : await serviceClient
            .from("ai_routing_rules")
            .select("model_override, recommended_model, fallback_model")
            .is("workspace_id", null)
            .in("task_type", taskTypes)
            .eq("is_active", true)
            .order("execution_priority", { ascending: true })
            .limit(1)
            .maybeSingle();

      const routingRule = workspaceRule || globalRule;
      if (routingRule) {
        resolvedModel = routingRule.model_override || routingRule.recommended_model || routingRule.fallback_model || resolvedModel;
        modelSource = workspaceRule ? "workspace_rule" : "global_rule";
      }

      console.log(`[generate-uso-profissional] Model resolved from ${modelSource}: ${resolvedModel}`);
    } catch (routeErr) {
      console.warn("[generate-uso-profissional] Failed to resolve model from routing, using safe fallback:", routeErr);
    }

    const aiResponse = await directAICall({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      model: resolvedModel,
      temperature: 0.7,
      maxTokens: 1200,
      jsonMode: true,
    });

    const rawContent = aiResponse.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("AI returned empty response");
    }

    console.log("[generate-uso-profissional] Raw AI response length:", rawContent.length);

    // Parse with robust extractor
    let parsed: any;
    try {
      parsed = extractJsonFromResponse(rawContent);
    } catch (parseErr) {
      console.error("[generate-uso-profissional] JSON extraction failed. Raw:", rawContent.substring(0, 500));
      // Last resort: try to build from raw text
      parsed = {
        intro: rawContent.substring(0, 300),
        useCases: [],
        professionalTips: [],
        targetProfiles: [],
      };
    }

    // Normalize to expected structure
    const result = normalizeUsoProfissional(parsed);

    // Warn if empty
    if (!result.intro && result.useCases.length === 0) {
      console.warn("[generate-uso-profissional] AI produced empty/unparseable content for product:", productId);
    }

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
