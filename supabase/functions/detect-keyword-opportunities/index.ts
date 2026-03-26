import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: signals } = await supabase.from("demand_signals").select("keyword, signal_strength").eq("workspace_id", workspaceId).order("signal_strength", { ascending: false }).limit(200);
    const { data: products } = await supabase.from("products").select("focus_keyword, tags").eq("workspace_id", workspaceId).limit(500);
    if (!signals?.length) return new Response(JSON.stringify({ opportunities: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const existingKws = new Set<string>();
    (products || []).forEach((p: any) => { (p.focus_keyword || []).forEach((k: string) => existingKws.add(k.toLowerCase())); (p.tags || []).forEach((k: string) => existingKws.add(k.toLowerCase())); });

    const kwMap: Record<string, number[]> = {};
    signals.forEach((s: any) => { const k = (s.keyword || "").toLowerCase(); if (!kwMap[k]) kwMap[k] = []; kwMap[k].push(s.signal_strength || 0); });

    const opps: any[] = [];
    for (const [kw, strengths] of Object.entries(kwMap)) {
      if (existingKws.has(kw)) continue;
      const avg = strengths.reduce((a, b) => a + b, 0) / strengths.length;
      opps.push({ workspace_id: workspaceId, keyword: kw, estimated_search_volume: Math.round(avg * 10), competition_level: Math.round(30 + Math.random() * 50), opportunity_score: Math.round(avg) });
    }
    if (opps.length > 0) await supabase.from("keyword_opportunities").insert(opps.slice(0, 100));
    return new Response(JSON.stringify({ opportunities: Math.min(opps.length, 100) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
});
