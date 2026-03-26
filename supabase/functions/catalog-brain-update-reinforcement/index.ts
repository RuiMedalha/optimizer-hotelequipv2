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

    // Get completed plans with decisions
    const { data: plans } = await supabase
      .from("catalog_brain_plans").select("*")
      .eq("workspace_id", workspaceId).eq("status", "completed").limit(50);

    // Get executed decisions
    const { data: decisions } = await supabase
      .from("catalog_decisions").select("*")
      .eq("workspace_id", workspaceId).eq("status", "executed").limit(50);

    let reinforced = 0;
    for (const decision of (decisions || [])) {
      // Find matching plan
      const plan = (plans || []).find((p: any) => p.target_entity_id === decision.entity_id);
      
      // Get outcomes for this plan
      const outcomes = plan ? await supabase
        .from("catalog_brain_outcomes").select("*")
        .eq("plan_id", plan.id).limit(10) : { data: [] };

      const actualImpact = (outcomes.data || []).reduce((s: number, o: any) => s + (Number(o.delta) || 0), 0);
      const expectedImpact = Number(decision.impact_score) || 0;
      const reward = actualImpact - expectedImpact;
      const outcome = reward > 0 ? "positive" : reward < -5 ? "negative" : "neutral";

      // Store reinforcement memory
      await supabase.from("catalog_reinforcement_memory").insert({
        workspace_id: workspaceId,
        decision_type: decision.decision_type,
        context_features: decision.decision_context,
        action_taken: decision.decision_type,
        reward,
        confidence: decision.confidence,
      });

      // Store performance history
      await supabase.from("decision_performance_history").insert({
        workspace_id: workspaceId,
        decision_id: decision.id,
        plan_id: plan?.id || null,
        expected_impact: expectedImpact,
        actual_impact: actualImpact,
        confidence: decision.confidence,
        learning_outcome: outcome,
        metadata: { reward, outcomes_count: (outcomes.data || []).length },
      });

      reinforced++;
    }

    return new Response(JSON.stringify({ reinforced }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
