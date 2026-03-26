import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspaceId, forecastType, scopeType, scopeId, volume, executionMode, jobType } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    // Get historical average costs
    const { data: history } = await supabase
      .from("usage_cost_records")
      .select("total_cost, cost_category")
      .eq("workspace_id", workspaceId)
      .eq("job_type", jobType || "enrichment")
      .order("created_at", { ascending: false })
      .limit(100);

    const avgCostPerUnit = history && history.length > 0
      ? history.reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0) / history.length
      : 0.005; // default fallback

    const modeMultiplier = executionMode === "economic" ? 0.5 : executionMode === "premium" ? 2.5 : 1;
    const estimatedCost = (volume || 1) * avgCostPerUnit * modeMultiplier;
    const confidence = history && history.length > 20 ? 0.85 : history && history.length > 5 ? 0.65 : 0.4;

    const { data: forecast, error } = await supabase.from("cost_forecasts").insert({
      workspace_id: workspaceId,
      forecast_type: forecastType || "job_forecast",
      scope_type: scopeType || "workspace",
      scope_id: scopeId || null,
      estimated_cost: estimatedCost,
      forecast_confidence: confidence,
      forecast_payload: { volume, executionMode, avgCostPerUnit, modeMultiplier, historySample: history?.length || 0 },
    }).select().single();
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, forecast: { id: forecast.id, estimatedCost, confidence } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
