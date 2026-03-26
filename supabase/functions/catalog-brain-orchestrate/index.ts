import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Ingest observations
    const ingestRes = await supabase.functions.invoke("catalog-brain-ingest-observations", { body: { workspaceId } });

    // 2. Build graph
    const graphRes = await supabase.functions.invoke("catalog-brain-build-graph", { body: { workspaceId } });

    // 3. Generate plans
    const plansRes = await supabase.functions.invoke("catalog-brain-generate-plans", { body: { workspaceId } });

    // 4. Execute ready plans (auto-approved only)
    const { data: readyPlans } = await supabase
      .from("catalog_brain_plans").select("*, catalog_brain_plan_steps(*)")
      .eq("workspace_id", workspaceId).eq("status", "ready")
      .eq("requires_approval", false).limit(10);

    let stepsExecuted = 0;
    for (const plan of (readyPlans || [])) {
      await supabase.from("catalog_brain_plans").update({ status: "running", started_at: new Date().toISOString() }).eq("id", plan.id);

      const steps = (plan.catalog_brain_plan_steps || []).sort((a: any, b: any) => a.step_order - b.step_order);
      let allSuccess = true;

      for (const step of steps) {
        // Check dependencies
        if (step.depends_on?.length) {
          const { data: depSteps } = await supabase
            .from("catalog_brain_plan_steps").select("status").in("id", step.depends_on);
          const allDone = depSteps?.every((d: any) => d.status === "completed");
          if (!allDone) { allSuccess = false; continue; }
        }

        await supabase.from("catalog_brain_plan_steps").update({ status: "running", started_at: new Date().toISOString() }).eq("id", step.id);

        try {
          // Delegate to agent system if agent_id exists
          if (step.agent_id) {
            await supabase.from("agent_tasks").insert({
              workspace_id: workspaceId, agent_id: step.agent_id,
              task_type: step.step_type, payload: step.input_payload, priority: 50,
            });
          }

          await supabase.from("catalog_brain_plan_steps").update({
            status: "completed", completed_at: new Date().toISOString(),
            output_payload: { delegated: !!step.agent_id },
          }).eq("id", step.id);
          stepsExecuted++;
        } catch (stepErr) {
          await supabase.from("catalog_brain_plan_steps").update({
            status: "failed", completed_at: new Date().toISOString(),
            error_message: stepErr.message,
          }).eq("id", step.id);
          allSuccess = false;
        }
      }

      await supabase.from("catalog_brain_plans").update({
        status: allSuccess ? "completed" : "failed",
        completed_at: new Date().toISOString(),
      }).eq("id", plan.id);
    }

    return new Response(JSON.stringify({
      observations: ingestRes.data,
      graph: graphRes.data,
      plans: plansRes.data,
      steps_executed: stepsExecuted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
