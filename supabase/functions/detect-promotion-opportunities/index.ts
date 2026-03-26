import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: products } = await supabase.from("products").select("id, original_price, optimized_price, seo_score, image_urls, status").eq("workspace_id", workspaceId).limit(300);
    if (!products?.length) return new Response(JSON.stringify({ promotions: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const promos: any[] = [];
    const types: string[] = ["discount", "bundle_offer", "limited_time_offer", "volume_discount", "channel_promotion"];
    for (const p of products) {
      const price = Number(p.optimized_price || p.original_price || 0);
      if (price <= 0) continue;
      const seo = p.seo_score || 0;
      const imgs = (p.image_urls || []).length;
      let score = 0;
      if (seo > 70) score += 20;
      if (imgs >= 3) score += 15;
      if (price > 100) score += 10;
      score += Math.random() * 30;
      if (score > 40) {
        promos.push({ workspace_id: workspaceId, product_id: p.id, promotion_type: types[Math.floor(Math.random() * types.length)], estimated_revenue_gain: Math.round(price * 0.1 * 100) / 100, confidence: Math.round(score) });
      }
    }
    if (promos.length > 0) await supabase.from("promotion_candidates").insert(promos.slice(0, 100));
    return new Response(JSON.stringify({ promotions: Math.min(promos.length, 100) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
});
