import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspaceId, periodDays } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    const since = new Date(Date.now() - (periodDays || 30) * 86400000).toISOString();

    const { data: records } = await supabase.from("usage_cost_records")
      .select("total_cost, cost_category, job_type, model_name, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since);

    const byCategory: Record<string, number> = {};
    const byJobType: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let total = 0;

    for (const r of records || []) {
      const cost = Number(r.total_cost || 0);
      total += cost;
      byCategory[r.cost_category] = (byCategory[r.cost_category] || 0) + cost;
      byJobType[r.job_type] = (byJobType[r.job_type] || 0) + cost;
      if (r.model_name) byModel[r.model_name] = (byModel[r.model_name] || 0) + cost;
    }

    // Get savings
    const { data: savings } = await supabase.from("optimization_savings_logs")
      .select("estimated_saving").eq("workspace_id", workspaceId).gte("created_at", since);
    const totalSavings = (savings || []).reduce((s: number, r: any) => s + Number(r.estimated_saving || 0), 0);

    return new Response(JSON.stringify({
      success: true,
      summary: { total, recordCount: records?.length || 0, byCategory, byJobType, byModel, totalSavings, periodDays: periodDays || 30 },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
