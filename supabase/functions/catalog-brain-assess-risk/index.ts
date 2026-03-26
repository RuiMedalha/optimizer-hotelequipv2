import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId, runId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: run } = await supabase
      .from("catalog_simulation_runs").select("*").eq("id", runId).single();
    if (!run) throw new Error("Run not found");

    const { data: results } = await supabase
      .from("catalog_simulation_results").select("*").eq("simulation_run_id", runId);

    // Get historical performance for similar simulations
    const { data: history } = await supabase
      .from("decision_performance_history").select("*")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);

    const negativeOutcomes = (history || []).filter((h: any) => h.learning_outcome === "negative").length;
    const historyPenalty = negativeOutcomes > 5 ? 10 : negativeOutcomes > 2 ? 5 : 0;

    // Assess risk
    const avgDelta = (results || []).reduce((s: number, r: any) => s + Number(r.delta), 0) / Math.max(1, (results || []).length);
    const hasDeclines = (results || []).some((r: any) => r.result_type === "expected_decline");
    const confidence = run.confidence || 50;

    let riskLevel = "low";
    if (hasDeclines || confidence < 40 || avgDelta < 0) riskLevel = "high";
    else if (confidence < 60 || historyPenalty > 5) riskLevel = "medium";

    // Update run with assessed risk
    await supabase.from("catalog_simulation_runs")
      .update({ risk_level: riskLevel }).eq("id", runId);

    return new Response(JSON.stringify({
      risk_level: riskLevel, confidence, avg_delta: avgDelta,
      has_declines: hasDeclines, history_penalty: historyPenalty,
      metrics_count: (results || []).length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
