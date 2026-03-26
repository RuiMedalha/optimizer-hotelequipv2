import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, plan_type = "quarterly_plan", title, horizon_months = 3 } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Gather intelligence data
    const [marketOpps, demandSignals, revenueActions, brainObs] = await Promise.all([
      supabase.from("market_opportunities").select("*").eq("workspace_id", workspace_id).eq("status", "open").limit(50),
      supabase.from("demand_signals").select("*").eq("workspace_id", workspace_id).order("detected_at", { ascending: false }).limit(50),
      supabase.from("revenue_actions").select("*").eq("workspace_id", workspace_id).eq("status", "pending").limit(50),
      supabase.from("catalog_brain_observations").select("*").eq("workspace_id", workspace_id).eq("processed", false).limit(50),
    ]);

    // Create the strategy plan
    const { data: plan, error: planError } = await supabase
      .from("strategy_plans")
      .insert({
        workspace_id,
        plan_type,
        title: title || `Plano Estratégico - ${new Date().toLocaleDateString("pt-PT")}`,
        planning_horizon_months: horizon_months,
        status: "draft",
      })
      .select()
      .single();

    if (planError) throw planError;

    const actions: any[] = [];

    // Generate actions from market opportunities
    for (const opp of (marketOpps.data || [])) {
      const actionType = opp.opportunity_type === "price_adjustment" ? "optimize_price"
        : opp.opportunity_type === "bundle_creation" ? "create_bundle"
        : opp.opportunity_type === "content_enrichment" ? "improve_content"
        : "expand_category";

      actions.push({
        workspace_id,
        plan_id: plan.id,
        action_type: actionType,
        target_product_id: opp.product_id,
        target_category_id: opp.category_id,
        action_payload: opp.recommendation_payload,
        expected_revenue: opp.estimated_revenue_impact || 0,
        priority_score: opp.priority_score || 0,
        status: "draft",
      });
    }

    // Generate actions from demand signals
    for (const sig of (demandSignals.data || [])) {
      if (sig.signal_type === "demand_spike" || sig.signal_type === "keyword_gap") {
        actions.push({
          workspace_id,
          plan_id: plan.id,
          action_type: "launch_product",
          target_product_id: sig.product_id,
          action_payload: { keyword: sig.keyword, signal: sig.payload },
          expected_revenue: (sig.signal_strength || 0) * 100,
          priority_score: sig.signal_strength || 0,
          status: "draft",
        });
      }
    }

    // Generate actions from revenue pipeline
    for (const ra of (revenueActions.data || [])) {
      const actionType = ra.action_type === "create_bundle" ? "create_bundle"
        : ra.action_type === "add_cross_sell" ? "add_cross_sell"
        : ra.action_type === "add_upsell" ? "add_upsell"
        : ra.action_type === "launch_promotion" ? "run_promotion"
        : "optimize_price";

      actions.push({
        workspace_id,
        plan_id: plan.id,
        action_type: actionType,
        action_payload: ra.action_payload,
        expected_revenue: ra.expected_revenue || 0,
        priority_score: ra.expected_revenue || 0,
        status: "draft",
      });
    }

    // Insert actions (top 30 by priority)
    const sorted = actions.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0)).slice(0, 30);
    if (sorted.length > 0) {
      await supabase.from("strategy_actions").insert(sorted);
    }

    // Generate recommendations
    const recommendations: any[] = [];
    const categories = new Set((marketOpps.data || []).map((o: any) => o.category_id).filter(Boolean));
    for (const catId of categories) {
      recommendations.push({
        workspace_id,
        recommendation_type: "expand_category",
        target_category_id: catId,
        recommendation_payload: { source: "market_intelligence" },
        expected_impact: 500,
        confidence: 70,
      });
    }
    if (recommendations.length > 0) {
      await supabase.from("strategy_recommendations").insert(recommendations);
    }

    // Feed brain
    await supabase.from("catalog_brain_observations").insert({
      workspace_id,
      observation_type: "strategy_plan_created",
      signal_payload: { plan_id: plan.id, actions_count: sorted.length },
      signal_strength: 80,
      source: "strategic_planner",
    });

    return new Response(JSON.stringify({ plan, actions_count: sorted.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
