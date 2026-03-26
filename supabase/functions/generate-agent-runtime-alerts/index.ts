import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    const { data: runs } = await supabase.from("agent_runs")
      .select("agent_name, agent_id, status, fallback_used, confidence_score, cost_estimate, latency_ms")
      .eq("workspace_id", workspace_id)
      .gte("created_at", new Date(Date.now() - 3600000).toISOString())
      .limit(500);

    const alerts: any[] = [];
    const agents: Record<string, any> = {};
    for (const r of runs || []) {
      if (!agents[r.agent_name]) agents[r.agent_name] = { id: r.agent_id, total: 0, failed: 0, fallbacks: 0 };
      const a = agents[r.agent_name];
      a.total++; if (r.status === "failed") a.failed++; if (r.fallback_used) a.fallbacks++;
    }

    for (const [name, a] of Object.entries(agents) as any[]) {
      if (a.total >= 5 && a.failed / a.total > 0.3) {
        alerts.push({ workspace_id, agent_id: a.id, alert_type: "failure_spike", severity: 3, message: `${name}: ${Math.round(a.failed/a.total*100)}% failure rate na última hora` });
      }
      if (a.total >= 5 && a.fallbacks / a.total > 0.4) {
        alerts.push({ workspace_id, agent_id: a.id, alert_type: "fallback_rate_high", severity: 2, message: `${name}: ${Math.round(a.fallbacks/a.total*100)}% fallback rate na última hora` });
      }
    }

    let inserted = 0;
    for (const alert of alerts) {
      const { count } = await supabase.from("agent_runtime_alerts")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", workspace_id).eq("alert_type", alert.alert_type)
        .eq("status", "open").eq("agent_id", alert.agent_id);
      if ((count || 0) === 0) { await supabase.from("agent_runtime_alerts").insert(alert); inserted++; }
    }

    return new Response(JSON.stringify({ success: true, alerts_generated: inserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
