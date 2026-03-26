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

    // Get pending decisions without simulations
    const { data: decisions } = await supabase
      .from("catalog_decisions").select("*")
      .eq("workspace_id", workspaceId).eq("status", "pending")
      .order("priority_score", { ascending: false }).limit(20);

    const DECISION_SIM_MAP: Record<string, string> = {
      optimize_seo: "seo_simulation", fix_channel_compliance: "feed_validation_simulation",
      create_bundle: "bundle_simulation", fix_quality: "schema_validation_simulation",
      fix_data: "schema_validation_simulation", optimize_pricing: "pricing_simulation",
      fix_feed: "feed_validation_simulation", fix_schema: "schema_validation_simulation",
    };

    let simulated = 0;
    for (const decision of (decisions || [])) {
      const simType = DECISION_SIM_MAP[decision.decision_type] || "seo_simulation";

      // Run simulation via internal call
      const simResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/catalog-brain-run-simulation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          workspaceId, entityType: decision.entity_type, entityId: decision.entity_id,
          simulationType: simType, scenarioName: `Simulation for ${decision.decision_type}`,
          inputData: decision.decision_context,
        }),
      });
      const simResult = await simResponse.json();

      if (simResult.run_id) {
        // Calculate expected value
        const avgDelta = simResult.avg_delta || 0;
        const riskPenalty = simResult.risk_level === "high" ? 15 : simResult.risk_level === "medium" ? 5 : 0;
        const expectedValue = Math.round(((simResult.confidence / 100) * avgDelta - riskPenalty) * 100) / 100;

        await supabase.from("catalog_action_simulations").insert({
          workspace_id: workspaceId, decision_id: decision.id,
          simulation_run_id: simResult.run_id, expected_value: expectedValue,
          risk_level: simResult.risk_level, recommended: expectedValue > 5,
        });
        simulated++;
      }
    }

    return new Response(JSON.stringify({ simulated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
