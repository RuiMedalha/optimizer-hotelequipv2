import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { stepId } = await req.json();
    if (!stepId) throw new Error("stepId required");

    const { data: step, error: stepErr } = await supabase
      .from("execution_plan_steps")
      .select("*")
      .eq("id", stepId)
      .single();
    if (stepErr) throw stepErr;

    const startTime = Date.now();

    // Mark running
    await supabase.from("execution_plan_steps").update({ status: "running" }).eq("id", stepId);

    // Execute the target function
    let success = true;
    let errorPayload = null;
    try {
      const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${step.executor_target}`;
      const resp = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify(step.input_scope || {}),
      });
      if (!resp.ok) {
        success = false;
        errorPayload = { status: resp.status, body: await resp.text() };
      }
    } catch (execErr) {
      success = false;
      errorPayload = { message: execErr.message };
    }

    const latency = Date.now() - startTime;
    const actualCost = step.estimated_cost || 0;

    // Update step
    await supabase.from("execution_plan_steps").update({
      status: success ? "completed" : "failed",
      actual_cost: actualCost,
      actual_duration_ms: latency,
    }).eq("id", stepId);

    // Record outcome
    await supabase.from("execution_outcomes").insert({
      plan_id: step.plan_id,
      step_id: stepId,
      outcome_type: success ? "success" : "fallback_used",
      success,
      confidence_score: success ? 0.85 : 0.3,
      cost: actualCost,
      latency_ms: latency,
      error_payload: errorPayload,
    });

    // If failed, check fallback rules
    if (!success) {
      const { data: plan } = await supabase.from("execution_plans").select("workspace_id").eq("id", step.plan_id).single();
      if (plan) {
        const { data: fallbacks } = await supabase
          .from("execution_fallback_rules")
          .select("*")
          .eq("workspace_id", plan.workspace_id)
          .eq("primary_executor", step.executor_type)
          .eq("is_active", true)
          .limit(1);

        if (fallbacks && fallbacks.length > 0) {
          const fb = fallbacks[0];
          // Could trigger fallback here - for now just log
          await supabase.from("execution_outcomes").insert({
            plan_id: step.plan_id,
            step_id: stepId,
            outcome_type: "fallback_used",
            success: false,
            error_payload: { fallback_to: fb.fallback_executor, rule: fb.rule_name },
          });
        }
      }
    }

    // Check if all steps done → complete plan
    const { data: remaining } = await supabase
      .from("execution_plan_steps")
      .select("id")
      .eq("plan_id", step.plan_id)
      .in("status", ["pending", "running"]);

    if (!remaining || remaining.length === 0) {
      // Calculate actuals
      const { data: allSteps } = await supabase
        .from("execution_plan_steps")
        .select("actual_cost, actual_duration_ms, status")
        .eq("plan_id", step.plan_id);

      const totalCost = (allSteps || []).reduce((s: number, st: any) => s + Number(st.actual_cost || 0), 0);
      const totalDuration = (allSteps || []).reduce((s: number, st: any) => s + Number(st.actual_duration_ms || 0), 0);
      const anyFailed = (allSteps || []).some((st: any) => st.status === "failed");

      await supabase.from("execution_plans").update({
        status: anyFailed ? "completed_with_errors" : "completed",
        actual_cost: totalCost,
        actual_duration_ms: totalDuration,
      }).eq("id", step.plan_id);
    }

    return new Response(JSON.stringify({ success, stepId, latency }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
