import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const invoke = async (fn: string) => {
      const resp = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      return resp.json();
    };

    const r1 = await invoke("collect-market-data");
    const r2 = await invoke("match-market-products");
    const r3 = await invoke("compute-market-benchmarks");
    const r4 = await invoke("generate-market-signals");
    const r5 = await invoke("generate-market-opportunities");

    // Feed brain observations
    const { data: signals } = await supabase.from("market_signals").select("*").eq("workspace_id", workspaceId).order("detected_at", { ascending: false }).limit(20);
    if (signals?.length) {
      const brainObs = signals.map((s: any) => ({
        workspace_id: workspaceId,
        observation_type: "market_signal",
        product_id: s.product_id,
        signal_source: "market_intelligence",
        signal_strength: s.signal_strength,
        signal_payload: { signal_type: s.signal_type, ...(s.signal_payload || {}) },
        processed: false,
      }));
      await supabase.from("catalog_brain_observations").insert(brainObs).catch(() => {});
    }

    return new Response(JSON.stringify({ pipeline: "complete", collected: r1.collected, matched: r2.matched, benchmarks: r3.benchmarks, signals: r4.signals, opportunities: r5.opportunities }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
