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
      .select("agent_name, status, confidence_score, cost_estimate, latency_ms, fallback_used")
      .eq("workspace_id", workspace_id).order("created_at", { ascending: false }).limit(500);

    const agents: Record<string, any> = {};
    for (const r of runs || []) {
      if (!agents[r.agent_name]) {
        agents[r.agent_name] = { total: 0, completed: 0, failed: 0, fallbacks: 0, totalConf: 0, totalCost: 0, totalLatency: 0 };
      }
      const a = agents[r.agent_name];
      a.total++;
      if (r.status === "completed" || r.status === "fallback_completed") a.completed++;
      if (r.status === "failed") a.failed++;
      if (r.fallback_used) a.fallbacks++;
      if (r.confidence_score) a.totalConf += Number(r.confidence_score);
      if (r.cost_estimate) a.totalCost += Number(r.cost_estimate);
      if (r.latency_ms) a.totalLatency += r.latency_ms;
    }

    const summary = Object.entries(agents).map(([name, a]: [string, any]) => ({
      agent_name: name, total_runs: a.total,
      success_rate: a.total ? Math.round((a.completed / a.total) * 100) : 0,
      failure_rate: a.total ? Math.round((a.failed / a.total) * 100) : 0,
      fallback_rate: a.total ? Math.round((a.fallbacks / a.total) * 100) : 0,
      avg_confidence: a.completed ? Math.round((a.totalConf / a.completed) * 100) / 100 : 0,
      avg_cost: a.total ? Math.round((a.totalCost / a.total) * 10000) / 10000 : 0,
      avg_latency_ms: a.total ? Math.round(a.totalLatency / a.total) : 0,
    }));

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
