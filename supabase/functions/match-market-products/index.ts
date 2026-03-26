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

    const { data: observations } = await supabase.from("market_observations").select("id, observed_title, observed_category, observed_price").eq("workspace_id", workspaceId).order("observed_at", { ascending: false }).limit(200);
    const { data: products } = await supabase.from("products").select("id, original_title, optimized_title, category, original_price").eq("workspace_id", workspaceId).limit(500);

    if (!observations?.length || !products?.length) return new Response(JSON.stringify({ matched: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let matched = 0;
    const normalize = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

    for (const obs of observations) {
      const obsTitle = normalize(obs.observed_title || "");
      if (!obsTitle) continue;

      let bestMatch: any = null;
      let bestConf = 0;

      for (const p of products) {
        const pTitle = normalize(p.optimized_title || p.original_title || "");
        if (!pTitle) continue;

        const obsWords = new Set(obsTitle.split(/\s+/));
        const pWords = new Set(pTitle.split(/\s+/));
        const intersection = [...obsWords].filter(w => pWords.has(w)).length;
        const union = new Set([...obsWords, ...pWords]).size;
        const jaccard = union > 0 ? Math.round((intersection / union) * 100) : 0;

        if (jaccard > bestConf && jaccard >= 30) {
          bestConf = jaccard;
          bestMatch = p;
        }
      }

      if (bestMatch) {
        await supabase.from("market_product_matches").insert({
          workspace_id: workspaceId,
          product_id: bestMatch.id,
          market_observation_id: obs.id,
          match_confidence: bestConf,
          match_reason: `Jaccard similarity ${bestConf}%`,
        });
        matched++;
      }
    }

    return new Response(JSON.stringify({ matched }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
