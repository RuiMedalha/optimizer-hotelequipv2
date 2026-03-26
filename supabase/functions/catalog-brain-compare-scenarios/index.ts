import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { twinId, scenarioAId, scenarioBId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{ data: resultsA }, { data: resultsB }] = await Promise.all([
      supabase.from("catalog_twin_results").select("*").eq("scenario_id", scenarioAId),
      supabase.from("catalog_twin_results").select("*").eq("scenario_id", scenarioBId),
    ]);

    const avgDelta = (r: any[]) => r.length ? r.reduce((s: number, x: any) => s + (Number(x.delta) || 0), 0) / r.length : 0;
    const avgConf = (r: any[]) => r.length ? r.reduce((s: number, x: any) => s + (Number(x.confidence) || 0), 0) / r.length : 0;

    const deltaA = avgDelta(resultsA || []);
    const deltaB = avgDelta(resultsB || []);
    const confA = avgConf(resultsA || []);
    const confB = avgConf(resultsB || []);
    const evA = (confA / 100) * deltaA;
    const evB = (confB / 100) * deltaB;
    const recommended = evA >= evB ? scenarioAId : scenarioBId;

    const { data: comparison } = await supabase.from("catalog_twin_comparisons").insert({
      twin_id: twinId,
      scenario_a_id: scenarioAId,
      scenario_b_id: scenarioBId,
      comparison_result: {
        scenario_a: { avg_delta: Math.round(deltaA * 100) / 100, avg_confidence: Math.round(confA), expected_value: Math.round(evA * 100) / 100, results_count: (resultsA || []).length },
        scenario_b: { avg_delta: Math.round(deltaB * 100) / 100, avg_confidence: Math.round(confB), expected_value: Math.round(evB * 100) / 100, results_count: (resultsB || []).length },
      },
      recommended_scenario: recommended,
      confidence: Math.round((confA + confB) / 2),
    }).select().single();

    return new Response(JSON.stringify({ comparison_id: comparison!.id, recommended }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
