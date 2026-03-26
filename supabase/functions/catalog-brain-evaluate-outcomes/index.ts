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

    // Get completed plans without outcomes
    const { data: completedPlans } = await supabase
      .from("catalog_brain_plans").select("id, workspace_id")
      .eq("workspace_id", workspaceId).eq("status", "completed").limit(20);

    let evaluated = 0;
    for (const plan of (completedPlans || [])) {
      const { data: existingOutcome } = await supabase
        .from("catalog_brain_outcomes").select("id").eq("plan_id", plan.id).maybeSingle();
      if (existingOutcome) continue;

      // Get steps for this plan
      const { data: steps } = await supabase
        .from("catalog_brain_plan_steps").select("*").eq("plan_id", plan.id);

      const completedSteps = (steps || []).filter((s: any) => s.status === "completed").length;
      const totalSteps = (steps || []).length;
      const successRate = totalSteps > 0 ? completedSteps / totalSteps : 0;

      const outcomeType = successRate >= 0.8 ? "improvement" : successRate >= 0.5 ? "neutral" : "degradation";

      await supabase.from("catalog_brain_outcomes").insert({
        workspace_id: workspaceId, plan_id: plan.id,
        outcome_type: outcomeType,
        metrics_before: { total_steps: totalSteps },
        metrics_after: { completed_steps: completedSteps, success_rate: successRate },
        impact_score: successRate * 100,
        measured_at: new Date().toISOString(),
      });
      evaluated++;
    }

    return new Response(JSON.stringify({ evaluated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
