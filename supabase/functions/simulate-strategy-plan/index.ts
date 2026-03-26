import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, plan_id } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: actions } = await supabase
      .from("strategy_actions")
      .select("*")
      .eq("plan_id", plan_id)
      .eq("workspace_id", workspace_id);

    if (!actions || actions.length === 0) throw new Error("No actions to simulate");

    const totalRevenue = actions.reduce((s, a) => s + (a.expected_revenue || 0), 0);
    const totalMargin = totalRevenue * 0.3;
    const avgConversion = actions.length > 0
      ? actions.reduce((s, a) => s + (a.expected_conversion || 0), 0) / actions.length
      : 0;
    const confidence = Math.min(90, 40 + actions.length * 2);

    const { data: sim } = await supabase.from("strategy_simulations").insert({
      workspace_id,
      plan_id,
      simulation_payload: {
        actions_count: actions.length,
        action_types: [...new Set(actions.map(a => a.action_type))],
      },
      predicted_revenue: totalRevenue,
      predicted_margin: totalMargin,
      predicted_conversion: avgConversion,
      confidence,
    }).select().single();

    // Update plan status
    await supabase.from("strategy_plans").update({ status: "simulated" }).eq("id", plan_id);

    return new Response(JSON.stringify({ simulation: sim }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
