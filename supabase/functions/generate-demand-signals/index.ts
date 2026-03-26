import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: products } = await supabase.from("products").select("id, original_title, optimized_title, tags, focus_keyword, category").eq("workspace_id", workspaceId).limit(200);
    if (!products?.length) return new Response(JSON.stringify({ signals: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const signals: any[] = [];
    for (const p of products) {
      const keywords = [...(p.focus_keyword || []), ...(p.tags || [])];
      for (const kw of keywords.slice(0, 3)) {
        signals.push({ workspace_id: workspaceId, keyword: kw, product_id: p.id, signal_type: "search_volume", signal_strength: Math.round(30 + Math.random() * 60), payload: { source: "catalog_keywords", product_title: p.optimized_title || p.original_title } });
      }
    }
    if (signals.length > 0) await supabase.from("demand_signals").insert(signals.slice(0, 300));

    // Feed brain
    const brainObs = signals.slice(0, 5).map((s: any) => ({ workspace_id: workspaceId, observation_type: "demand_signal", signal_source: "demand_intelligence", signal_strength: s.signal_strength, signal_payload: { keyword: s.keyword, signal_type: s.signal_type }, processed: false }));
    if (brainObs.length > 0) await supabase.from("catalog_brain_observations").insert(brainObs).catch(() => {});

    return new Response(JSON.stringify({ signals: Math.min(signals.length, 300) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
});
