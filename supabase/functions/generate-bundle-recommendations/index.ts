import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rels } = await supabase.from("product_relationships").select("*").eq("workspace_id", workspaceId).in("relationship_type", ["bundle_candidate", "complementary"]).order("confidence", { ascending: false }).limit(50);
    if (!rels?.length) return new Response(JSON.stringify({ bundles: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const seen = new Set<string>();
    const bundles: any[] = [];
    for (const r of rels) {
      const key = [r.product_a_id, r.product_b_id].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      bundles.push({
        workspace_id: workspaceId,
        bundle_products: { product_ids: [r.product_a_id, r.product_b_id], relationship: r.relationship_type },
        expected_conversion: Math.round((r.confidence * 0.6 + Math.random() * 20) * 100) / 100,
        expected_revenue: Math.round((50 + Math.random() * 200) * 100) / 100,
        confidence: r.confidence,
      });
    }
    if (bundles.length > 0) await supabase.from("bundle_recommendations").insert(bundles.slice(0, 50));
    return new Response(JSON.stringify({ bundles: Math.min(bundles.length, 50) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
});
