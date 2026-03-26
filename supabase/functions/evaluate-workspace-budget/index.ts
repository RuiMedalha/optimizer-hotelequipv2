import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspaceId, budgetType, additionalCost } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    // Get budget
    const { data: budgets } = await supabase.from("workspace_budgets")
      .select("*").eq("workspace_id", workspaceId)
      .eq("budget_type", budgetType || "global");

    if (!budgets || budgets.length === 0) {
      return new Response(JSON.stringify({ success: true, allowed: true, reason: "no_budget_set" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const budget = budgets[0];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Calculate current usage
    const { data: usage } = await supabase.from("usage_cost_records")
      .select("total_cost").eq("workspace_id", workspaceId)
      .gte("created_at", monthStart);

    const currentUsage = (usage || []).reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0);
    const projectedUsage = currentUsage + Number(additionalCost || 0);
    const budgetLimit = Number(budget.budget_limit);
    const warningThreshold = budgetLimit * (budget.warning_threshold_percent / 100);
    const percentUsed = (projectedUsage / budgetLimit) * 100;

    let status = "ok";
    let allowed = true;
    if (projectedUsage >= budgetLimit) {
      status = "exceeded";
      if (budget.hard_limit_enabled) allowed = false;
    } else if (currentUsage >= warningThreshold) {
      status = "warning";
    }

    return new Response(JSON.stringify({
      success: true, allowed, status, currentUsage, projectedUsage, budgetLimit, percentUsed,
      hardLimitActive: budget.hard_limit_enabled,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
