import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspaceId, contextType, executionMode, requiresVision, requiresTranslation } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    const mode = executionMode || "balanced";

    // Get routing policies
    const { data: policies } = await supabase
      .from("ai_routing_policies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("context_type", contextType || "enrichment")
      .eq("is_active", true);

    // Get model matrix
    const { data: models } = await supabase
      .from("model_capability_matrix")
      .select("*")
      .eq("is_active", true);

    // Filter by capabilities
    let eligible = (models || []).filter((m: any) => {
      if (requiresVision && !m.supports_vision) return false;
      if (requiresTranslation && !m.supports_translation) return false;
      return true;
    });

    if (eligible.length === 0) eligible = models || [];

    // Sort by mode
    eligible.sort((a: any, b: any) => {
      if (mode === "economic") return a.relative_cost_score - b.relative_cost_score;
      if (mode === "premium") return b.quality_score - a.quality_score;
      return (b.quality_score / Math.max(b.relative_cost_score, 1)) - (a.quality_score / Math.max(a.relative_cost_score, 1));
    });

    const chosen = eligible[0];
    const executorType = requiresVision ? "ai_vision" : "ai_text";

    return new Response(JSON.stringify({
      success: true,
      executor_type: executorType,
      model_name: chosen?.model_name || "google/gemini-3-flash-preview",
      provider: chosen?.provider_name || "google",
      estimated_cost: chosen?.relative_cost_score || 5,
      quality_score: chosen?.quality_score || 5,
      policy_applied: policies?.[0]?.policy_name || null,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
