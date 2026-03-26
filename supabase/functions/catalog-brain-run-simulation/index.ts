import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SIMULATION_CONFIGS: Record<string, { metrics: string[]; baseMultiplier: number }> = {
  seo_simulation: { metrics: ["seo_score", "ctr"], baseMultiplier: 1.15 },
  feed_validation_simulation: { metrics: ["feed_acceptance", "publish_success"], baseMultiplier: 1.1 },
  conversion_simulation: { metrics: ["conversion_rate", "revenue"], baseMultiplier: 1.2 },
  pricing_simulation: { metrics: ["revenue", "conversion_rate"], baseMultiplier: 1.1 },
  bundle_simulation: { metrics: ["revenue", "conversion_rate"], baseMultiplier: 1.25 },
  translation_quality_simulation: { metrics: ["completion_rate", "feed_acceptance"], baseMultiplier: 1.08 },
  image_quality_simulation: { metrics: ["quality_score", "conversion_rate"], baseMultiplier: 1.12 },
  schema_validation_simulation: { metrics: ["quality_score", "feed_acceptance"], baseMultiplier: 1.05 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId, scenarioId, entityType, entityId, simulationType, scenarioName, inputData } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Create scenario if not provided
    let sId = scenarioId;
    if (!sId) {
      const { data: scenario, error: sErr } = await supabase.from("catalog_simulation_scenarios").insert({
        workspace_id: workspaceId, entity_type: entityType, entity_id: entityId,
        simulation_type: simulationType, scenario_name: scenarioName || `${simulationType} simulation`,
        input_data: inputData || {}, created_by: "brain",
      }).select("id").single();
      if (sErr) throw sErr;
      sId = scenario!.id;
    }

    // Create run
    const { data: run, error: rErr } = await supabase.from("catalog_simulation_runs").insert({
      workspace_id: workspaceId, scenario_id: sId, status: "running", started_at: new Date().toISOString(),
    }).select("id").single();
    if (rErr) throw rErr;

    const config = SIMULATION_CONFIGS[simulationType] || SIMULATION_CONFIGS.seo_simulation;
    const confidence = 50 + Math.floor(Math.random() * 30);
    const results: any[] = [];

    for (const metric of config.metrics) {
      const baseline = 40 + Math.floor(Math.random() * 40);
      const multiplier = config.baseMultiplier * (0.9 + Math.random() * 0.2);
      const predicted = Math.round(baseline * multiplier * 100) / 100;
      const delta = Math.round((predicted - baseline) * 100) / 100;
      const resultType = delta > 2 ? "expected_improvement" : delta < -2 ? "expected_decline" : "neutral";

      results.push({
        simulation_run_id: run!.id, metric_type: metric, baseline_value: baseline,
        predicted_value: predicted, delta, result_type: resultType, confidence,
      });
    }

    if (results.length) {
      await supabase.from("catalog_simulation_results").insert(results);
    }

    // Assess risk
    const avgDelta = results.reduce((s, r) => s + r.delta, 0) / results.length;
    const riskLevel = confidence > 70 && avgDelta > 0 ? "low" : confidence < 40 || avgDelta < 0 ? "high" : "medium";

    // Update run
    await supabase.from("catalog_simulation_runs").update({
      status: "completed", completed_at: new Date().toISOString(),
      simulation_output: { metrics: results.map((r: any) => ({ metric: r.metric_type, delta: r.delta })), avg_delta: avgDelta },
      confidence, risk_level: riskLevel,
    }).eq("id", run!.id);

    return new Response(JSON.stringify({ run_id: run!.id, results: results.length, risk_level: riskLevel, confidence, avg_delta: avgDelta }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
