import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get rising demand trends
    const { data: trends } = await supabase
      .from("demand_trends")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("trend_direction", "rising")
      .order("trend_strength", { ascending: false })
      .limit(20);

    // Get market observations without internal match
    const { data: unmatched } = await supabase
      .from("market_observations")
      .select("id, observed_title, observed_category, observed_price")
      .eq("workspace_id", workspace_id)
      .limit(100);

    const { data: matched } = await supabase
      .from("market_product_matches")
      .select("market_observation_id")
      .eq("workspace_id", workspace_id);

    const matchedIds = new Set((matched || []).map(m => m.market_observation_id));
    const unmatchedObs = (unmatched || []).filter(o => !matchedIds.has(o.id));

    const recommendations: any[] = [];

    for (const trend of (trends || [])) {
      recommendations.push({
        workspace_id,
        recommendation_type: "launch_product",
        recommendation_payload: {
          keyword: trend.keyword,
          trend_strength: trend.trend_strength,
          source: "demand_trends",
        },
        expected_impact: (trend.trend_strength || 0) * 80,
        confidence: Math.min(85, (trend.trend_strength || 0) + 20),
      });
    }

    for (const obs of unmatchedObs.slice(0, 15)) {
      recommendations.push({
        workspace_id,
        recommendation_type: "launch_product",
        recommendation_payload: {
          title: obs.observed_title,
          category: obs.observed_category,
          price: obs.observed_price,
          source: "market_gap",
        },
        expected_impact: (obs.observed_price || 50) * 2,
        confidence: 55,
      });
    }

    if (recommendations.length > 0) {
      await supabase.from("strategy_recommendations").insert(recommendations);
    }

    return new Response(JSON.stringify({ opportunities: recommendations.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
