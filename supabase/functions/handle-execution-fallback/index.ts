import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { stepId, failureType } = await req.json();
    if (!stepId) throw new Error("stepId required");

    const { data: step, error } = await supabase.from("execution_plan_steps").select("*").eq("id", stepId).single();
    if (error) throw error;

    const { data: plan } = await supabase.from("execution_plans").select("workspace_id").eq("id", step.plan_id).single();
    if (!plan) throw new Error("Plan not found");

    // Find matching fallback rule
    const { data: rules } = await supabase
      .from("execution_fallback_rules")
      .select("*")
      .eq("workspace_id", plan.workspace_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    const matchedRule = (rules || []).find((r: any) =>
      r.primary_executor === step.executor_type &&
      (!failureType || r.failure_type === failureType)
    );

    if (!matchedRule) {
      // Escalate to human
      await supabase.from("execution_outcomes").insert({
        plan_id: step.plan_id,
        step_id: stepId,
        outcome_type: "escalated_to_human",
        success: false,
        error_payload: { reason: "No fallback rule matched", failure_type: failureType },
      });

      return new Response(JSON.stringify({ success: true, action: "escalated_to_human" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Apply fallback
    await supabase.from("execution_plan_steps").update({
      executor_type: matchedRule.fallback_executor,
      status: "pending",
    }).eq("id", stepId);

    await supabase.from("execution_outcomes").insert({
      plan_id: step.plan_id,
      step_id: stepId,
      outcome_type: "fallback_used",
      success: true,
      error_payload: { rule: matchedRule.rule_name, fallback_to: matchedRule.fallback_executor },
    });

    return new Response(JSON.stringify({ success: true, action: "fallback_applied", rule: matchedRule.rule_name, newExecutor: matchedRule.fallback_executor }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
