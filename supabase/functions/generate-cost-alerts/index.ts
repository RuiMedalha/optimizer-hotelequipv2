import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspaceId } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: usage } = await supabase.from("usage_cost_records")
      .select("total_cost").eq("workspace_id", workspaceId).gte("created_at", monthStart);
    const totalUsage = (usage || []).reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0);

    const { data: budgets } = await supabase.from("workspace_budgets")
      .select("*").eq("workspace_id", workspaceId);

    const alertsCreated: any[] = [];

    for (const b of budgets || []) {
      const limit = Number(b.budget_limit);
      const warningAt = limit * (b.warning_threshold_percent / 100);

      if (totalUsage >= limit) {
        const { data } = await supabase.from("cost_alerts").insert({
          workspace_id: workspaceId,
          alert_type: "budget_exceeded",
          severity: "critical",
          message: `Budget ${b.budget_type} excedido: ${totalUsage.toFixed(2)}€ / ${limit.toFixed(2)}€`,
          current_value: totalUsage,
          threshold_value: limit,
        }).select().single();
        if (data) alertsCreated.push(data);
      } else if (totalUsage >= warningAt) {
        const { data } = await supabase.from("cost_alerts").insert({
          workspace_id: workspaceId,
          alert_type: "budget_warning",
          severity: "high",
          message: `Budget ${b.budget_type} a ${((totalUsage / limit) * 100).toFixed(0)}%: ${totalUsage.toFixed(2)}€ / ${limit.toFixed(2)}€`,
          current_value: totalUsage,
          threshold_value: warningAt,
        }).select().single();
        if (data) alertsCreated.push(data);
      }
    }

    return new Response(JSON.stringify({ success: true, alertsCreated: alertsCreated.length, totalUsage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
