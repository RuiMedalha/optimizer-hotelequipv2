import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { runId } = await req.json();
    if (!runId) throw new Error("runId required");

    // Get all steps for this run ordered
    const { data: steps, error } = await supabase
      .from("orchestration_steps")
      .select("*")
      .eq("run_id", runId)
      .order("step_order", { ascending: true });

    if (error) throw error;
    if (!steps || steps.length === 0) throw new Error("No steps found");

    // Find next executable steps (all previous completed)
    const readySteps: string[] = [];
    for (const step of steps) {
      if (step.status !== "pending") continue;

      // Check if all previous steps are completed
      const previousSteps = steps.filter((s: any) => s.step_order < step.step_order);
      const allPreviousCompleted = previousSteps.every((s: any) => s.status === "completed" || s.status === "skipped");

      if (allPreviousCompleted) {
        readySteps.push(step.id);
      }
    }

    // Execute ready steps
    const baseUrl = Deno.env.get("SUPABASE_URL");
    for (const stepId of readySteps) {
      await fetch(`${baseUrl}/functions/v1/execute-orchestration-step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ stepId }),
      });
    }

    return new Response(JSON.stringify({ success: true, executedSteps: readySteps.length, readySteps }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
