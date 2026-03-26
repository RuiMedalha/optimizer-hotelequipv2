import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: signals } = await supabase.from("demand_signals").select("keyword, signal_strength, detected_at").eq("workspace_id", workspaceId).order("detected_at", { ascending: false }).limit(500);
    if (!signals?.length) return new Response(JSON.stringify({ trends: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const kwGroups: Record<string, number[]> = {};
    signals.forEach((s: any) => { const k = (s.keyword || "").toLowerCase(); if (!kwGroups[k]) kwGroups[k] = []; kwGroups[k].push(s.signal_strength || 0); });

    const trends: any[] = [];
    for (const [kw, strengths] of Object.entries(kwGroups)) {
      if (strengths.length < 2) continue;
      const first = strengths[strengths.length - 1], last = strengths[0];
      const direction = last > first * 1.1 ? "rising" : last < first * 0.9 ? "declining" : "stable";
      trends.push({ workspace_id: workspaceId, keyword: kw, trend_direction: direction, trend_strength: Math.round(Math.abs(last - first)), detected_at: new Date().toISOString() });
    }
    if (trends.length > 0) await supabase.from("demand_trends").insert(trends.slice(0, 100));
    return new Response(JSON.stringify({ trends: Math.min(trends.length, 100) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
});
