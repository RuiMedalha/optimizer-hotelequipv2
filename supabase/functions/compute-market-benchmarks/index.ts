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

    const { data: observations } = await supabase.from("market_observations").select("observed_category, observed_price, observed_title, observed_images").eq("workspace_id", workspaceId).not("observed_category", "is", null);

    if (!observations?.length) return new Response(JSON.stringify({ benchmarks: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const byCategory: Record<string, any[]> = {};
    for (const o of observations) {
      const cat = o.observed_category || "uncategorized";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(o);
    }

    let count = 0;
    for (const [cat, items] of Object.entries(byCategory)) {
      const prices = items.map(i => Number(i.observed_price)).filter(p => p > 0).sort((a, b) => a - b);
      const titles = items.map(i => (i.observed_title || "").length).filter(l => l > 0);
      const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
      const avgTitle = titles.length ? titles.reduce((s, v) => s + v, 0) / titles.length : null;

      await supabase.from("market_benchmarks").insert({
        workspace_id: workspaceId,
        category_id: null,
        channel_type: "general",
        median_price: median,
        average_title_length: avgTitle ? Math.round(avgTitle) : null,
        average_description_length: null,
        average_image_count: null,
        common_attributes: { category_name: cat, sample_size: items.length },
        benchmark_date: new Date().toISOString(),
      });
      count++;
    }

    return new Response(JSON.stringify({ benchmarks: count }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
