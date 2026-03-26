import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { planId } = await req.json();
    if (!planId) throw new Error("planId required");

    const { data: plan, error } = await supabase.from("execution_plans").select("*").eq("id", planId).single();
    if (error) throw error;

    const { data: steps } = await supabase.from("execution_plan_steps").select("*").eq("plan_id", planId);
    const { data: outcomes } = await supabase.from("execution_outcomes").select("*").eq("plan_id", planId);

    const totalEstimatedCost = Number(plan.estimated_cost || 0);
    const totalActualCost = (steps || []).reduce((s: number, st: any) => s + Number(st.actual_cost || 0), 0);
    const totalEstimatedDuration = Number(plan.estimated_duration_ms || 0);
    const totalActualDuration = (steps || []).reduce((s: number, st: any) => s + Number(st.actual_duration_ms || 0), 0);

    const successCount = (outcomes || []).filter((o: any) => o.success).length;
    const totalOutcomes = (outcomes || []).length;
    const successRate = totalOutcomes > 0 ? successCount / totalOutcomes : 0;
    const fallbackCount = (outcomes || []).filter((o: any) => o.outcome_type === "fallback_used").length;
    const avgConfidence = (outcomes || []).reduce((s: number, o: any) => s + Number(o.confidence_score || 0), 0) / Math.max(totalOutcomes, 1);

    const evaluation = {
      plan_id: planId,
      plan_type: plan.plan_type,
      execution_mode: plan.execution_mode,
      cost_efficiency: totalEstimatedCost > 0 ? totalActualCost / totalEstimatedCost : 1,
      duration_efficiency: totalEstimatedDuration > 0 ? totalActualDuration / totalEstimatedDuration : 1,
      success_rate: successRate,
      fallback_count: fallbackCount,
      avg_confidence: avgConfidence,
      estimated_cost: totalEstimatedCost,
      actual_cost: totalActualCost,
      estimated_duration_ms: totalEstimatedDuration,
      actual_duration_ms: totalActualDuration,
    };

    return new Response(JSON.stringify({ success: true, evaluation }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
