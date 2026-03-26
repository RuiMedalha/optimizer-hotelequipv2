import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Analyze performance history to find which dimensions perform well
    const { data: history } = await supabase
      .from("decision_performance_history").select("*")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);

    if (!history || history.length < 5) {
      return new Response(JSON.stringify({ adjusted: false, reason: "Insufficient data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by decision type and calculate avg reward
    const typeRewards: Record<string, { total: number; count: number }> = {};
    for (const h of history) {
      const reward = Number(h.actual_impact) - Number(h.expected_impact);
      if (!typeRewards[h.metadata?.decision_type || "unknown"]) {
        typeRewards[h.metadata?.decision_type || "unknown"] = { total: 0, count: 0 };
      }
      typeRewards[h.metadata?.decision_type || "unknown"].total += reward;
      typeRewards[h.metadata?.decision_type || "unknown"].count++;
    }

    // Get current impact models
    const { data: models } = await supabase
      .from("impact_models").select("*").eq("workspace_id", workspaceId);

    if (!models || models.length === 0) {
      return new Response(JSON.stringify({ adjusted: false, reason: "No impact models" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Positive outcomes → increase weight slightly, negative → decrease
    const positiveCount = history.filter((h: any) => h.learning_outcome === "positive").length;
    const negativeCount = history.filter((h: any) => h.learning_outcome === "negative").length;
    const successRate = positiveCount / history.length;

    // Only adjust if we have a clear signal
    if (successRate > 0.6 || successRate < 0.4) {
      const adjustmentFactor = successRate > 0.6 ? 1.05 : 0.95;
      for (const model of models) {
        const newWeight = Math.min(1, Math.max(0.01, Number(model.weight) * adjustmentFactor));
        await supabase.from("impact_models")
          .update({ weight: newWeight })
          .eq("id", model.id);
      }

      // Record the model update
      await supabase.from("catalog_learning_models").upsert({
        workspace_id: workspaceId,
        model_type: "impact_weight_adjustment",
        model_parameters: { success_rate: successRate, adjustment_factor: adjustmentFactor, sample_size: history.length },
        last_trained_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,model_type" });
    }

    return new Response(JSON.stringify({ adjusted: true, success_rate: successRate, sample_size: history.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
