import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id is required");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const results: Record<string, any> = {};

    // Step 1: Catalog Intelligence
    console.log("[Pipeline] Step 1: Catalog Intelligence");
    const catalogRes = await supabase.functions.invoke("analyze-catalog", {
      body: { workspace_id },
    });
    results.catalog = catalogRes.data;

    // Step 2: Demand Intelligence (uses catalog context)
    console.log("[Pipeline] Step 2: Demand Intelligence");
    const demandRes = await supabase.functions.invoke("collect-demand-data", {
      body: { workspace_id },
    });
    results.demand = demandRes.data;

    // Step 3: Revenue Optimization (uses catalog + demand context)
    console.log("[Pipeline] Step 3: Revenue Optimization");
    const revenueRes = await supabase.functions.invoke("evaluate-revenue-impact", {
      body: { workspace_id },
    });
    results.revenue = revenueRes.data;

    // Store consolidated observation in Catalog Brain
    const consolidatedSummary = {
      catalog_issues: (results.catalog?.issues_found || []).length,
      catalog_priority: results.catalog?.priority_score || 0,
      demand_opportunities: (results.demand?.missing_catalog_opportunities || []).length + (results.demand?.high_demand_products || []).length,
      demand_confidence: results.demand?.confidence_score || 0,
      revenue_opportunities: (results.revenue?.revenue_opportunities || []).length,
      estimated_revenue: results.revenue?.estimated_impact?.total_estimated_revenue || 0,
      pipeline_completed_at: new Date().toISOString(),
    };

    await supabase.from("catalog_brain_observations").insert({
      workspace_id,
      observation_type: "intelligence_pipeline",
      source_agent: "intelligence_pipeline",
      payload: consolidatedSummary,
      confidence: Math.min(
        results.catalog?.summary ? 0.9 : 0.3,
        results.demand?.confidence_score || 0.3,
      ),
    });

    // Log pipeline run
    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "intelligence_pipeline",
      status: "completed",
      input_payload: { workspace_id },
      output_payload: consolidatedSummary,
      confidence_score: 0.85,
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success: true,
      ...consolidatedSummary,
      details: results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[Pipeline] Error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
