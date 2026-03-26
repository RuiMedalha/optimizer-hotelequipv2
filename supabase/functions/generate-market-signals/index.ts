import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: benchmarks } = await supabase.from("market_benchmarks").select("*").eq("workspace_id", workspaceId).order("benchmark_date", { ascending: false }).limit(50);
    const { data: products } = await supabase.from("products").select("id, original_title, optimized_title, original_price, optimized_price, category, image_urls").eq("workspace_id", workspaceId).limit(500);

    if (!benchmarks?.length || !products?.length) return new Response(JSON.stringify({ signals: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const signals: any[] = [];
    const benchmarkMap: Record<string, any> = {};
    for (const b of benchmarks) {
      const cat = (b.common_attributes as any)?.category_name;
      if (cat) benchmarkMap[cat] = b;
    }

    for (const p of products) {
      const bench = benchmarkMap[p.category || ""];
      if (!bench) continue;

      const price = Number(p.optimized_price || p.original_price || 0);
      const medianPrice = Number(bench.median_price || 0);

      if (price > 0 && medianPrice > 0) {
        const ratio = price / medianPrice;
        if (ratio > 1.2) {
          signals.push({ workspace_id: workspaceId, product_id: p.id, signal_type: "price_competitiveness", signal_strength: Math.min(100, Math.round((ratio - 1) * 100)), signal_payload: { price, median: medianPrice, ratio: Math.round(ratio * 100) / 100, direction: "overpriced" } });
        } else if (ratio < 0.7) {
          signals.push({ workspace_id: workspaceId, product_id: p.id, signal_type: "pricing_opportunity", signal_strength: Math.min(100, Math.round((1 - ratio) * 100)), signal_payload: { price, median: medianPrice, ratio: Math.round(ratio * 100) / 100, direction: "underpriced" } });
        }
      }

      const titleLen = (p.optimized_title || p.original_title || "").length;
      const avgTitleLen = Number(bench.average_title_length || 0);
      if (avgTitleLen > 0 && titleLen < avgTitleLen * 0.6) {
        signals.push({ workspace_id: workspaceId, product_id: p.id, signal_type: "content_gap", signal_strength: Math.round((1 - titleLen / avgTitleLen) * 100), signal_payload: { title_length: titleLen, market_avg: avgTitleLen } });
      }

      const imgCount = (p.image_urls || []).length;
      if (imgCount === 0) {
        signals.push({ workspace_id: workspaceId, product_id: p.id, signal_type: "image_gap", signal_strength: 80, signal_payload: { images: 0 } });
      }
    }

    if (signals.length > 0) {
      await supabase.from("market_signals").insert(signals);
    }

    return new Response(JSON.stringify({ signals: signals.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
