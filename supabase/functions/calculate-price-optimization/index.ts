import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: products } = await supabase.from("products").select("id, original_price, optimized_price, category").eq("workspace_id", workspaceId).not("original_price", "is", null).limit(300);
    const { data: benchmarks } = await supabase.from("market_benchmarks").select("*").eq("workspace_id", workspaceId).limit(50);

    if (!products?.length) return new Response(JSON.stringify({ recommendations: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const benchMap: Record<string, number> = {};
    (benchmarks || []).forEach((b: any) => { const cat = (b.common_attributes as any)?.category_name; if (cat && b.median_price) benchMap[cat] = Number(b.median_price); });

    const recs: any[] = [];
    for (const p of products) {
      const current = Number(p.optimized_price || p.original_price);
      if (!current || current <= 0) continue;
      const median = benchMap[p.category || ""] || current;
      const recommended = Math.round(((current + median) / 2) * 100) / 100;
      const minPrice = Math.round(current * 0.75 * 100) / 100;
      const margin = Math.round(((recommended - minPrice) / recommended) * 100) / 100;
      recs.push({ workspace_id: workspaceId, product_id: p.id, current_price: current, recommended_price: recommended, minimum_price: minPrice, expected_margin: margin, confidence: Math.round(50 + Math.random() * 40) });
    }
    if (recs.length > 0) await supabase.from("pricing_recommendations").insert(recs.slice(0, 200));
    return new Response(JSON.stringify({ recommendations: Math.min(recs.length, 200) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
});
