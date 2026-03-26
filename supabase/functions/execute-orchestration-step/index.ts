import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { stepId, runId } = await req.json();
    if (!stepId && !runId) throw new Error("stepId or runId required");

    let step;
    if (stepId) {
      const { data, error } = await supabase.from("orchestration_steps").select("*").eq("id", stepId).single();
      if (error) throw error;
      step = data;
    } else {
      // Get next pending step for this run
      const { data, error } = await supabase
        .from("orchestration_steps")
        .select("*")
        .eq("run_id", runId)
        .eq("status", "pending")
        .order("step_order", { ascending: true })
        .limit(1)
        .single();
      if (error) throw new Error("No pending steps found");
      step = data;
    }

    // Mark step as running
    await supabase.from("orchestration_steps").update({
      status: "running",
      started_at: new Date().toISOString(),
    }).eq("id", step.id);

    // Simulate step execution (in production, this would call the actual function)
    const result = {
      step_type: step.step_type,
      processed: true,
      timestamp: new Date().toISOString(),
    };

    // Mark step completed
    await supabase.from("orchestration_steps").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      result_payload: result,
      confidence_score: 0.85,
    }).eq("id", step.id);

    // Check if all steps completed
    const { data: remaining } = await supabase
      .from("orchestration_steps")
      .select("id")
      .eq("run_id", step.run_id)
      .in("status", ["pending", "running"]);

    if (!remaining || remaining.length === 0) {
      await supabase.from("orchestration_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", step.run_id);
    }

    return new Response(JSON.stringify({ success: true, stepId: step.id, status: "completed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
