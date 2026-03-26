import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const lovableKey = Deno.env.get("LOVABLE_API_KEY") || "";
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

    let apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let result: any = { status: "failed", error: "Unknown provider type" };

    if (provider.provider_type === "lovable_gateway") {
      headers["Authorization"] = `Bearer ${lovableKey}`;
    } else if (provider.provider_type === "openai_direct") {
      const apiKey = provider.config?.api_key;
      if (!apiKey) {
        return new Response(JSON.stringify({
          status: "failed",
          error: "No API key configured",
          provider: provider.provider_name,
          responseTimeMs: Date.now() - startTime,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      apiUrl = "https://api.openai.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${apiKey}`;
    } else if (provider.provider_type === "gemini_direct") {
      const apiKey = provider.config?.api_key;
      if (!apiKey) {
        return new Response(JSON.stringify({
          status: "failed",
          error: "No API key configured",
          provider: provider.provider_name,
          responseTimeMs: Date.now() - startTime,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const model = provider.default_model || "gemini-2.5-flash";
      const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      try {
        const resp = await fetch(gUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: testPrompt }] }],
          }),
        });
        const responseTimeMs = Date.now() - startTime;
        if (resp.ok) {
          const data = await resp.json();
          return new Response(JSON.stringify({
            status: "ok",
            provider: provider.provider_name,
            model: model,
            responseTimeMs,
            outputPreview: (data.candidates?.[0]?.content?.parts?.[0]?.text || "").substring(0, 200),
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else {
          const errText = await resp.text();
          return new Response(JSON.stringify({
            status: "failed",
            error: `Gemini API ${resp.status}: ${errText.substring(0, 200)}`,
            provider: provider.provider_name,
            responseTimeMs,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch (e: unknown) {
        return new Response(JSON.stringify({
          status: "failed",
          error: (e as Error).message,
          provider: provider.provider_name,
          responseTimeMs: Date.now() - startTime,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Lovable Gateway / OpenAI compatible test
    if (!headers["Authorization"]) headers["Authorization"] = `Bearer ${lovableKey}`;

    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: provider.default_model || "google/gemini-2.5-flash",
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
        const content = data.choices?.[0]?.message?.content || "";
        return new Response(JSON.stringify({
          status: "ok",
          provider: provider.provider_name,
          model: provider.default_model || "google/gemini-2.5-flash",
          responseTimeMs,
          outputPreview: content.substring(0, 200),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        const errText = await resp.text();
        return new Response(JSON.stringify({
          status: "failed",
          error: `API ${resp.status}: ${errText.substring(0, 200)}`,
          provider: provider.provider_name,
          responseTimeMs,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch (e: unknown) {
      return new Response(JSON.stringify({
        status: "failed",
        error: (e as Error).message,
        provider: provider.provider_name,
        responseTimeMs: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e: unknown) {
    return new Response(JSON.stringify({ status: "failed", error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
