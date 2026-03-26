import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { modelName, metrics } = await req.json();

    if (modelName && metrics) {
      // Update specific model stats
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (metrics.quality_score != null) updates.quality_score = metrics.quality_score;
      if (metrics.relative_cost_score != null) updates.relative_cost_score = metrics.relative_cost_score;
      if (metrics.relative_latency_score != null) updates.relative_latency_score = metrics.relative_latency_score;

      const { error } = await supabase
        .from("model_capability_matrix")
        .update(updates)
        .eq("model_name", modelName);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, updated: modelName }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch update from execution outcomes
    const { data: outcomes } = await supabase
      .from("execution_outcomes")
      .select("*, execution_plan_steps!inner(model_name, executor_type)")
      .not("execution_plan_steps.model_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);

    const modelStats: Record<string, { totalLatency: number; totalCost: number; successCount: number; totalCount: number }> = {};

    for (const o of outcomes || []) {
      const mn = (o as any).execution_plan_steps?.model_name;
      if (!mn) continue;
      if (!modelStats[mn]) modelStats[mn] = { totalLatency: 0, totalCost: 0, successCount: 0, totalCount: 0 };
      modelStats[mn].totalLatency += Number(o.latency_ms || 0);
      modelStats[mn].totalCost += Number(o.cost || 0);
      if (o.success) modelStats[mn].successCount++;
      modelStats[mn].totalCount++;
    }

    let updatedCount = 0;
    for (const [model, stats] of Object.entries(modelStats)) {
      if (stats.totalCount < 5) continue;
      const avgLatency = stats.totalLatency / stats.totalCount;
      const successRate = stats.successCount / stats.totalCount;
      // Adjust quality score based on success rate (scale 1-10)
      const adjustedQuality = Math.min(10, Math.max(1, Math.round(successRate * 10)));
      const latencyScore = Math.min(10, Math.max(1, Math.round(avgLatency / 500)));

      await supabase.from("model_capability_matrix").update({
        quality_score: adjustedQuality,
        relative_latency_score: latencyScore,
        updated_at: new Date().toISOString(),
      }).eq("model_name", model);
      updatedCount++;
    }

    return new Response(JSON.stringify({ success: true, modelsUpdated: updatedCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
