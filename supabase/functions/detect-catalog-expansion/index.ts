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

    // Find categories with demand but few products
    const { data: keywords } = await supabase
      .from("keyword_opportunities")
      .select("*")
      .eq("workspace_id", workspace_id)
      .order("opportunity_score", { ascending: false })
      .limit(20);

    // Find market gaps
    const { data: gaps } = await supabase
      .from("catalog_gap_analysis")
      .select("*")
      .eq("workspace_id", workspace_id)
      .limit(20);

    const recommendations: any[] = [];

    for (const kw of (keywords || [])) {
      recommendations.push({
        workspace_id,
        recommendation_type: "catalog_expansion",
        target_category_id: kw.category_id,
        recommendation_payload: {
          keyword: kw.keyword,
          search_volume: kw.estimated_search_volume,
          opportunity_score: kw.opportunity_score,
          source: "demand_intelligence",
        },
        expected_impact: (kw.opportunity_score || 0) * 50,
        confidence: Math.min(90, (kw.opportunity_score || 0)),
      });
    }

    for (const gap of (gaps || [])) {
      recommendations.push({
        workspace_id,
        recommendation_type: "catalog_expansion",
        target_category_id: gap.category_id,
        recommendation_payload: {
          gap_type: gap.gap_type,
          description: gap.gap_description,
          suggested_products: gap.suggested_products,
          source: "gap_analysis",
        },
        expected_impact: (gap.confidence || 50) * 30,
        confidence: gap.confidence || 50,
      });
    }

    if (recommendations.length > 0) {
      await supabase.from("strategy_recommendations").insert(recommendations);
    }

    return new Response(JSON.stringify({ expansions_detected: recommendations.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
