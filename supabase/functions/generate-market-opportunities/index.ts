import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const signalToOpportunity: Record<string, string> = {
  price_competitiveness: "price_adjustment",
  pricing_opportunity: "price_adjustment",
  seo_alignment: "seo_improvement",
  content_gap: "content_enrichment",
  image_gap: "image_upgrade",
  bundle_opportunity: "bundle_creation",
  category_gap: "taxonomy_update",
  keyword_opportunity: "seo_improvement",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: signals } = await supabase.from("market_signals").select("*").eq("workspace_id", workspaceId).order("detected_at", { ascending: false }).limit(200);

    if (!signals?.length) return new Response(JSON.stringify({ opportunities: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const opportunities: any[] = [];
    for (const sig of signals) {
      const oppType = signalToOpportunity[sig.signal_type] || "content_enrichment";
      const priority = (sig.signal_strength || 50) * 1.2;
      const revenue = sig.signal_type === "price_competitiveness" ? (sig.signal_payload as any)?.price * 0.05 : sig.signal_type === "pricing_opportunity" ? (sig.signal_payload as any)?.median * 0.03 : null;

      opportunities.push({
        workspace_id: workspaceId,
        product_id: sig.product_id,
        category_id: sig.category_id,
        opportunity_type: oppType,
        priority_score: Math.min(100, Math.round(priority)),
        estimated_revenue_impact: revenue ? Math.round(revenue * 100) / 100 : null,
        confidence_score: sig.signal_strength || 50,
        recommendation_payload: { signal_type: sig.signal_type, signal_id: sig.id, ...((sig.signal_payload || {}) as any) },
        status: "open",
      });
    }

    if (opportunities.length > 0) {
      await supabase.from("market_opportunities").insert(opportunities);
    }

    return new Response(JSON.stringify({ opportunities: opportunities.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
