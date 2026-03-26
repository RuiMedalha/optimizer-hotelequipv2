import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { step_id, run_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Mark step as running
    await supabase.from("catalog_workflow_steps").update({
      status: "running", started_at: new Date().toISOString(),
    }).eq("id", step_id);

    // Get step details
    const { data: step } = await supabase.from("catalog_workflow_steps").select("*").eq("id", step_id).single();
    if (!step) throw new Error("Step not found");

    // Simulate execution (in production, this would dispatch to real modules)
    const output = { executed_at: new Date().toISOString(), step_type: step.step_type, result: "simulated_success" };

    await supabase.from("catalog_workflow_steps").update({
      status: "completed", completed_at: new Date().toISOString(), output_ref: output,
    }).eq("id", step_id);

    // Create handoff to next step
    const { data: nextStep } = await supabase.from("catalog_workflow_steps")
      .select("*").eq("workflow_run_id", run_id)
      .eq("step_order", step.step_order + 1).single();

    if (nextStep) {
      await supabase.from("workflow_handoffs").insert({
        workflow_run_id: run_id, from_module: step.step_type, to_module: nextStep.step_type,
        handoff_payload: output, handoff_status: "completed",
      });
    } else {
      // Last step — complete the run
      await supabase.from("catalog_workflow_runs").update({
        status: "completed", completed_at: new Date().toISOString(),
      }).eq("id", run_id);
    }

    return new Response(JSON.stringify({ success: true, step_id, next_step: nextStep?.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
