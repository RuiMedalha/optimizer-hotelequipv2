import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { directAICall } from "../_shared/ai/direct-ai-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // AI keys resolved from env (GEMINI_API_KEY, OPENAI_API_KEY, etc.)
    const supabase = createClient(supabaseUrl, serviceKey);

    const { providerId, workspaceId } = await req.json();

    // Get provider config
    let provider: any;
    if (providerId && providerId !== "default") {
      const { data } = await supabase
        .from("document_ai_providers")
        .select("*")
        .eq("id", providerId)
        .single();
      provider = data;
    }

    if (!provider) {
      provider = {
        provider_name: "Lovable AI Gateway",
        provider_type: "lovable_gateway",
        default_model: "google/gemini-2.5-flash",
        config: {},
      };
    }

    const testPrompt = "Extract a table from this test text:\n\nRef | Product | Price\nSKU001 | Widget A | 29.99\nSKU002 | Widget B | 39.99";

    // For lovable_gateway type, use directAICall (provider-agnostic)
    if (provider.provider_type === "lovable_gateway") {
      try {
        const aiResult = await directAICall({
          systemPrompt: "Extract tables from text. Return JSON with tables array.",
          messages: [{ role: "user", content: testPrompt }],
          model: provider.default_model || "gemini-2.5-flash",
          maxTokens: 500,
        });
        const responseTimeMs = Date.now() - startTime;
        const content = aiResult.choices?.[0]?.message?.content || "";
        return new Response(JSON.stringify({
          status: "ok",
          provider: provider.provider_name,
          model: provider.default_model || "gemini-2.5-flash",
          responseTimeMs,
          outputPreview: content.substring(0, 200),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: unknown) {
        return new Response(JSON.stringify({
          status: "failed",
          error: (e as Error).message,
          provider: provider.provider_name,
          responseTimeMs: Date.now() - startTime,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // OpenAI direct
    if (provider.provider_type === "openai_direct") {
      const apiKey = provider.config?.api_key;
      if (!apiKey) {
        return new Response(JSON.stringify({
          status: "failed", error: "No API key configured", provider: provider.provider_name, responseTimeMs: Date.now() - startTime,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: provider.default_model || "gpt-4o-mini",
            messages: [
              { role: "system", content: "Extract tables from text. Return JSON with tables array." },
              { role: "user", content: testPrompt },
            ],
            max_tokens: 500,
          }),
        });
        const responseTimeMs = Date.now() - startTime;
        if (resp.ok) {
          const data = await resp.json();
          return new Response(JSON.stringify({
            status: "ok", provider: provider.provider_name, model: provider.default_model || "gpt-4o-mini",
            responseTimeMs, outputPreview: (data.choices?.[0]?.message?.content || "").substring(0, 200),
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const errText = await resp.text();
        return new Response(JSON.stringify({
          status: "failed", error: `OpenAI ${resp.status}: ${errText.substring(0, 200)}`, provider: provider.provider_name, responseTimeMs,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: unknown) {
        return new Response(JSON.stringify({
          status: "failed", error: (e as Error).message, provider: provider.provider_name, responseTimeMs: Date.now() - startTime,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Gemini direct
    if (provider.provider_type === "gemini_direct") {
      const apiKey = provider.config?.api_key;
      if (!apiKey) {
        return new Response(JSON.stringify({
          status: "failed", error: "No API key configured", provider: provider.provider_name, responseTimeMs: Date.now() - startTime,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const model = provider.default_model || "gemini-2.5-flash";
      try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: testPrompt }] }] }),
        });
        const responseTimeMs = Date.now() - startTime;
        if (resp.ok) {
          const data = await resp.json();
          return new Response(JSON.stringify({
            status: "ok", provider: provider.provider_name, model, responseTimeMs,
            outputPreview: (data.candidates?.[0]?.content?.parts?.[0]?.text || "").substring(0, 200),
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const errText = await resp.text();
        return new Response(JSON.stringify({
          status: "failed", error: `Gemini API ${resp.status}: ${errText.substring(0, 200)}`, provider: provider.provider_name, responseTimeMs,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: unknown) {
        return new Response(JSON.stringify({
          status: "failed", error: (e as Error).message, provider: provider.provider_name, responseTimeMs: Date.now() - startTime,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Unknown provider type
    return new Response(JSON.stringify({
      status: "failed", error: `Unknown provider type: ${provider.provider_type}`, provider: provider.provider_name, responseTimeMs: Date.now() - startTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ status: "failed", error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
