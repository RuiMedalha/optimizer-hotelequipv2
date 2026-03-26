import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { directAICall } from "../_shared/ai/direct-ai-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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
      .select("*")
      .eq("id", providerId)
      .single();
    if (pErr || !provider) throw new Error("Provider not found");

    const testPrompt = "Reply with exactly: OK";
    const startMs = Date.now();
    let status = "success";
    let errorMessage: string | null = null;
    let latencyMs = 0;

    try {
      if (provider.provider_type === "lovable_gateway") {
        // Lovable gateway replaced with direct AI calls
        try {
          const result = await directAICall({
            systemPrompt: "",
            messages: [{ role: "user", content: testPrompt }],
            model: provider.default_model || "gemini-2.5-flash",
            maxTokens: 10,
          });
          latencyMs = Date.now() - startMs;
        } catch (e: any) {
          throw e;
        }
      } else if (provider.provider_type === "openai_direct") {
        const apiKey = provider.config?.api_key;
        if (!apiKey) throw new Error("OpenAI API key not configured in provider config");
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: provider.default_model || "gpt-4o-mini",
            messages: [{ role: "user", content: testPrompt }],
            max_tokens: 10,
          }),
        });
        latencyMs = Date.now() - startMs;
        if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
        await resp.json();
      } else if (provider.provider_type === "gemini_direct") {
        const apiKey = provider.config?.api_key;
        if (!apiKey) throw new Error("Gemini API key not configured in provider config");
        const model = provider.default_model || "gemini-2.5-flash";
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: testPrompt }] }] }),
          }
        );
        latencyMs = Date.now() - startMs;
        if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
        await resp.json();
      } else if (provider.provider_type === "anthropic_direct") {
        const apiKey = provider.config?.api_key;
        if (!apiKey) throw new Error("Anthropic API key not configured in provider config");
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: provider.default_model || "claude-3-5-haiku-20241022",
            max_tokens: 10,
            messages: [{ role: "user", content: testPrompt }],
          }),
        });
        latencyMs = Date.now() - startMs;
        if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
        await resp.json();
      } else {
        latencyMs = Date.now() - startMs;
        // OCR or unknown — just mark as success
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
      model_tested: provider.default_model,
    });

    // Update provider health
    await supabase.from("ai_providers").update({
      last_health_check: new Date().toISOString(),
      last_health_status: status,
      last_error: errorMessage,
      avg_latency_ms: latencyMs,
      updated_at: new Date().toISOString(),
    }).eq("id", providerId);

    return new Response(JSON.stringify({ status, latencyMs, error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
