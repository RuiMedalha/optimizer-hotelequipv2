import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * Resolves the API key for a provider type.
 * Priority: 1) env secrets 2) user's settings table
 */
async function getProviderApiKey(providerType: string, supabase: any, userId?: string): Promise<string | null> {
  const envKeyMap: Record<string, string> = {
    gemini_direct: "GEMINI_API_KEY",
    openai_direct: "OPENAI_API_KEY",
    anthropic_direct: "ANTHROPIC_API_KEY",
    azure_openai: "AZURE_OPENAI_API_KEY",
  };
  // 1) Try env secret first
  const envVar = envKeyMap[providerType];
  const envKey = envVar ? (Deno.env.get(envVar) ?? null) : null;
  if (envKey) return envKey;

  // 2) Fallback: read from user's settings table
  if (userId) {
    const settingsKeyMap: Record<string, string> = {
      gemini_direct: "gemini_api_key",
      openai_direct: "openai_api_key",
      anthropic_direct: "anthropic_api_key",
      azure_openai: "azure_openai_api_key",
    };
    const settingKey = settingsKeyMap[providerType];
    if (settingKey) {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("user_id", userId)
        .eq("key", settingKey)
        .maybeSingle();
      if (data?.value) return data.value;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { providerId, workspaceId } = await req.json();
    if (!providerId || !workspaceId) throw new Error("providerId and workspaceId required");

    const { data: provider, error: pErr } = await supabase
      .from("ai_providers")
      .select("id, provider_name, provider_type, default_model, fallback_model, config")
      .eq("id", providerId)
      .single();
    if (pErr || !provider) throw new Error("Provider not found");

    // Get the user who owns this workspace to resolve their API keys
    const { data: wsData } = await supabase
      .from("workspaces")
      .select("user_id")
      .eq("id", workspaceId)
      .maybeSingle();
    const userId = wsData?.user_id;

    const testPrompt = "Reply with exactly: OK";
    const startMs = Date.now();
    let status = "success";
    let errorMessage: string | null = null;
    let latencyMs = 0;

    try {
      const apiKey = await getProviderApiKey(provider.provider_type, supabase, userId);

      // Fallback models per provider type
      const FALLBACK_MODELS: Record<string, string[]> = {
        openai_direct: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
        gemini_direct: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"],
        anthropic_direct: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
      };

      const modelsToTry = [
        provider.default_model,
        provider.fallback_model,
        ...(FALLBACK_MODELS[provider.provider_type] || []),
      ].filter(Boolean) as string[];

      // Deduplicate
      const uniqueModels = [...new Set(modelsToTry)];
      let testedModel: string | null = null;

      if (provider.provider_type === "openai_direct") {
        if (!apiKey) throw new Error("OPENAI_API_KEY não configurada. Adicione-a nas configurações do provider.");
        for (const model of uniqueModels) {
          const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: [{ role: "user", content: testPrompt }], max_tokens: 10 }),
          });
          latencyMs = Date.now() - startMs;
          if (resp.ok) { await resp.json(); testedModel = model; break; }
          const body = await resp.text();
          if (resp.status === 404 || body.includes("not_found")) {
            console.warn(`OpenAI model ${model} not found, trying next...`);
            continue;
          }
          throw new Error(`OpenAI ${resp.status}: ${body}`);
        }
        if (!testedModel) throw new Error("Nenhum modelo OpenAI disponível. Verifique os modelos configurados.");

      } else if (provider.provider_type === "gemini_direct") {
        if (!apiKey) throw new Error("GEMINI_API_KEY não configurada. Adicione-a nas configurações do provider.");
        for (const model of uniqueModels) {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: testPrompt }] }] }) }
          );
          latencyMs = Date.now() - startMs;
          if (resp.ok) { await resp.json(); testedModel = model; break; }
          const body = await resp.text();
          if (resp.status === 404 || body.includes("not found")) {
            console.warn(`Gemini model ${model} not found, trying next...`);
            continue;
          }
          throw new Error(`Gemini ${resp.status}: ${body}`);
        }
        if (!testedModel) throw new Error("Nenhum modelo Gemini disponível. Verifique os modelos configurados.");

      } else if (provider.provider_type === "anthropic_direct") {
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada. Adicione-a nas configurações do provider.");
        for (const model of uniqueModels) {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
            body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: "user", content: testPrompt }] }),
          });
          latencyMs = Date.now() - startMs;
          if (resp.ok) { await resp.json(); testedModel = model; break; }
          const body = await resp.text();
          if (resp.status === 404 || body.includes("not_found")) {
            console.warn(`Anthropic model ${model} not found, trying next...`);
            continue;
          }
          throw new Error(`Anthropic ${resp.status}: ${body}`);
        }
        if (!testedModel) throw new Error("Nenhum modelo Anthropic disponível. Verifique os modelos configurados.");

      } else {
        latencyMs = Date.now() - startMs;
        testedModel = provider.default_model;
      }
    } catch (e: any) {
      status = "error";
      errorMessage = (e as Error).message;
      latencyMs = Date.now() - startMs;
    }

    // Log health check
    await supabase.from("ai_provider_health_log").insert({
      provider_id: providerId,
      workspace_id: workspaceId,
      status,
      latency_ms: latencyMs,
      error_message: errorMessage,
      model_tested: testedModel || provider.default_model,
    });

    // Update provider health metadata + auto-fix default_model if fallback succeeded
    const updatePayload: Record<string, any> = {
      last_health_check: new Date().toISOString(),
      last_health_status: status,
      last_error: errorMessage,
      avg_latency_ms: latencyMs,
      updated_at: new Date().toISOString(),
    };
    if (status === "success" && testedModel && testedModel !== provider.default_model) {
      updatePayload.default_model = testedModel;
    }
    await supabase.from("ai_providers").update(updatePayload).eq("id", providerId);

    return new Response(JSON.stringify({ 
      status, latencyMs, error: errorMessage,
      testedModel: testedModel || provider.default_model,
      modelChanged: status === "success" && testedModel !== provider.default_model ? testedModel : null,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
