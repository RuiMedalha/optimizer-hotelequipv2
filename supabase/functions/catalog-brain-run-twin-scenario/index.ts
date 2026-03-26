import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { scenarioId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Update status to running
    await supabase.from("catalog_twin_scenarios").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", scenarioId);

    // Get scenario and actions
    const { data: scenario } = await supabase.from("catalog_twin_scenarios").select("*").eq("id", scenarioId).single();
    const { data: actions } = await supabase.from("catalog_twin_actions").select("*").eq("scenario_id", scenarioId);

    // Simulate each action
    const results: any[] = [];
    const typeMultipliers: Record<string, number> = {
      seo_optimization: 12, bundle_creation: 8, price_adjustment: 15, taxonomy_change: 5,
      translation_rollout: 6, image_replacement: 10, channel_publish: 7, schema_update: 3, catalog_reorganization: 4,
    };
    const multiplier = typeMultipliers[scenario?.scenario_type || ""] || 5;

    for (const action of (actions || [])) {
      const baseline = 50 + Math.random() * 30;
      const delta = (Math.random() * multiplier * 2) - (multiplier * 0.3);
      const predicted = baseline + delta;
      results.push({
        scenario_id: scenarioId,
        metric_type: delta > 0 ? "positive" : delta < -2 ? "negative" : "neutral",
        baseline_value: Math.round(baseline * 100) / 100,
        predicted_value: Math.round(predicted * 100) / 100,
        delta: Math.round(delta * 100) / 100,
        result_type: delta > 2 ? "expected_improvement" : delta < -2 ? "expected_decline" : "neutral",
        confidence: Math.round(60 + Math.random() * 35),
        metadata: { action_type: action.action_type, entity_type: action.target_entity_type },
      });
    }

    if (results.length > 0) {
      await supabase.from("catalog_twin_results").insert(results);
    }

    // Mark completed
    await supabase.from("catalog_twin_scenarios").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", scenarioId);

    return new Response(JSON.stringify({ scenario_id: scenarioId, results_count: results.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!).from("catalog_twin_scenarios").update({ status: "failed" }).eq("id", (await req.clone().json()).scenarioId).catch(() => {});
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
