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
    let systemPrompt = `És um especialista em equipamentos profissionais para hotelaria, restauração e catering em Portugal. Escreves conteúdo editorial para um catálogo B2B.

REGRAS DE LINGUAGEM NATURAL — OBRIGATÓRIO:
O conteúdo DEVE soar humano e natural. NUNCA soar robótico.
1. LIMITAR \"HORECA\": Máximo 1 menção.
2. DIRIGIR-SE A PROFISSIONAIS: Chefs, gestores F&B, compradores.
3. LINGUAGEM DE INSIDER: \"rush do serviço\", \"mise en place\", \"rotação de stock\".
4. CONTEXTOS CONCRETOS: \"Fine Dining com 80 lugares\", \"Hotel 4 estrelas com buffet\", \"Catering para 200+ pessoas\".
5. EVITAR \"estabelecimentos HORECA\" — usar contextos específicos.

NUNCA uses linguagem de review de consumidor. Escreves como um técnico especialista.`;

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

Gera conteúdo editorial de uso profissional DETALHADO e rico em informações técnicas e contextos de negócio.
Responde APENAS com JSON válido:
{
  "intro": "1 parágrafo sobre o que este equipamento faz para profissionais",
  "useCases": [
    { "context": "Nome do contexto profissional (ex: Serviço de Buffet)", "description": "2-3 frases sobre como usam este equipamento" }
  ],
  "targetProfiles": ["Perfil Profissional 1", "Perfil Profissional 2", "Perfil Profissional 3"],
  "professionalTips": ["Dica Profissional: conteúdo da dica"]
}

IMPORTANTE: Devolve APENAS o JSON acima. Sem texto antes ou depois. Sem markdown.`;

    // Resolve model from ai_routing_rules with precedence:
    // workspace-specific rule -> global rule -> safe low-cost fallback.
    // Important: never fall back to workspace default provider here, because
    // direct-only defaults can silently bounce into a paid gateway preview model.
    let resolvedModel = "google/gemini-1.5-flash";
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

    // --- HTML Generation with Fail-safe Autoria ---
    let htmlContent = `<div class="uso-profissional" style="font-family: sans-serif; color: #374151;">`;
    
    if (result.intro) {
      htmlContent += `<p style="font-size: 15px; line-height: 1.6; margin-bottom: 20px;">${result.intro}</p>`;
    }

    if (result.useCases && result.useCases.length > 0) {
      result.useCases.forEach((uc) => {
        htmlContent += `
          <div class="use-case" style="margin-bottom: 20px;">
            <h3 style="margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #00526d; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">${uc.context}</h3>
            <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #4b5563;">${uc.description}</p>
          </div>`;
      });
    }

    // Check for Perfis section and add fallback if missing
    const hasPerfis = htmlContent.includes('Perfis Profissionais') || (result.targetProfiles && result.targetProfiles.length > 0);
    
    if (!hasPerfis) {
      htmlContent += `
        <div class="professional-profiles" style="margin-top: 24px; margin-bottom: 20px;">
          <h3 style="margin: 16px 0 8px; font-size: 16px; font-weight: 700; color: #2c2c2c;">Perfis Profissionais</h3>
          <h4 style="margin: 12px 0 6px; font-size: 15px; font-weight: 600; color: #00526d;">Uso Geral HORECA</h4>
          <p style="font-size: 14px; color: #4b5563;">Este equipamento adapta-se a diferentes contextos de serviço profissional, desde estabelecimentos de pequena dimensão até operações de maior escala.</p>
          <h5 style="margin: 10px 0 4px; font-size: 14px; font-weight: 600; color: #2c2c2c;">Dica Profissional</h5>
          <p style="font-size: 14px; color: #6b7280;">Consulte as especificações técnicas para garantir compatibilidade com as suas necessidades operacionais.</p>
        </div>`;
    } else if (result.targetProfiles && result.targetProfiles.length > 0) {
       htmlContent += `
        <div class="professional-profiles" style="margin-top: 24px; margin-bottom: 20px;">
          <h3 style="margin: 16px 0 8px; font-size: 16px; font-weight: 700; color: #2c2c2c;">Perfis Profissionais</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #4b5563;">
            ${result.targetProfiles.map(profile => `<li style="margin-bottom: 4px;">${profile}</li>`).join('')}
          </ul>
        </div>`;
    }

    if (result.professionalTips && result.professionalTips.length > 0) {
      htmlContent += `
        <div class="professional-tips" style="margin-top: 20px;">
          ${result.professionalTips.map(tip => `
            <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 12px; margin-bottom: 12px; border-radius: 0 4px 4px 0;">
              <p style="margin: 0; font-size: 14px; color: #0369a1;"><strong>💡 Dica:</strong> ${tip}</p>
            </div>
          `).join('')}
        </div>`;
    }

    // FAIL-SAFE PROGRAMMATIC AUTORIA
    htmlContent += `
      <p style="margin-top:24px; padding:16px; background:#f9fafb; border-left:4px solid #00526d; font-size:13px; color:#4b5563; font-style:italic; border-radius: 0 8px 8px 0; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);">
        <strong style="color: #00526d;">Nota HotelEquip:</strong> Informação baseada em 30 anos a servir a hotelaria com profissionalismo.
      </p>
    </div>`;

    // Save to database
    try {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      
      const payload: Record<string, any> = { 
        professional_use_content: htmlContent,
        is_published: true,
        status: 'published',
        updated_at: new Date().toISOString()
      };

      console.log(`[generate-uso-profissional] Saving content and PUBLISHING product ${productId}.`);
      
      const { error: updateError } = await serviceClient
        .from("products")
        .update(payload)
        .eq("id", productId);
        
      if (updateError) {
        console.error("[generate-uso-profissional] Failed to update product table:", updateError);
      } else {
        console.log(`[generate-uso-profissional] Successfully saved professional_use_content to products table for product ${productId}`);
        
        // Also ensure it's saved to product_uso_profissional for the UI state
        const usoPayload = {
          product_id: productId,
          workspace_id: workspaceId,
          intro: result.intro,
          use_cases: result.useCases,
          professional_tips: result.professionalTips,
          target_profiles: result.targetProfiles,
          publish_enabled: true,
          placement: "before_faq",
          routing_in_description: true,
          routing_in_custom_field: false,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error: usoError } = await serviceClient
          .from("product_uso_profissional")
          .upsert(usoPayload, { onConflict: "product_id,workspace_id" });

        if (usoError) {
          console.error("[generate-uso-profissional] Failed to update product_uso_profissional table:", usoError);
        } else {
          console.log(`[generate-uso-profissional] Successfully updated product_uso_profissional table for product ${productId}`);
        }
      }
    } catch (dbErr) {
      console.error("[generate-uso-profissional] Database operation exception:", dbErr);
    }

    return new Response(JSON.stringify({ ...result, html: htmlContent }), {
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
