import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { scenarioId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: scenario } = await supabase.from("catalog_twin_scenarios").select("*, catalog_twins!inner(workspace_id)").eq("id", scenarioId).single();
    if (!scenario) throw new Error("Cenário não encontrado");

    const { data: actions } = await supabase.from("catalog_twin_actions").select("*").eq("scenario_id", scenarioId);
    const workspaceId = (scenario as any).catalog_twins.workspace_id;

    // Create a real plan from twin scenario
    const steps = (actions || []).map((a: any, i: number) => ({
      step_order: i + 1,
      step_type: a.action_type || "twin_promoted_action",
      step_description: `Promoted from twin: ${a.action_type} on ${a.target_entity_type}`,
      input_payload: a.action_payload,
      product_id: a.target_entity_id,
    }));

    const { data: plan } = await supabase.from("catalog_brain_plans").insert({
      workspace_id: workspaceId,
      plan_name: `Promoted: ${scenario.scenario_name || scenario.scenario_type}`,
      plan_description: `Auto-promoted from Digital Twin scenario ${scenarioId}`,
      status: "pending",
      requires_approval: true,
      created_by: "twin_engine",
    }).select().single();

    if (plan && steps.length > 0) {
      await supabase.from("catalog_brain_plan_steps").insert(steps.map((s: any) => ({ ...s, plan_id: plan.id })));
    }

    await supabase.from("catalog_twin_scenarios").update({ status: "promoted", updated_at: new Date().toISOString() }).eq("id", scenarioId);

    return new Response(JSON.stringify({ plan_id: plan!.id, steps_count: steps.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
