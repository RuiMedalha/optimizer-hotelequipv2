import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspaceId, supplierId, channelId, jobType, jobId, productId, agentId, modelName, costCategory, unitsConsumed, unitCost, totalCost, currency, metadata } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    const record = {
      workspace_id: workspaceId,
      supplier_id: supplierId || null,
      channel_id: channelId || null,
      job_type: jobType || "unknown",
      job_id: jobId || null,
      product_id: productId || null,
      agent_id: agentId || null,
      model_name: modelName || null,
      cost_category: costCategory || "ai_text",
      units_consumed: unitsConsumed || 1,
      unit_cost: unitCost || 0,
      total_cost: totalCost || (unitsConsumed || 1) * (unitCost || 0),
      currency: currency || "EUR",
      cost_metadata: metadata || {},
    };

    const { data, error } = await supabase.from("usage_cost_records").insert(record).select().single();
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, id: data.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
