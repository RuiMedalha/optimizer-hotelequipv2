import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { outcomeId, feedbackRating, feedbackText } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Update outcome with human feedback
    const { error } = await supabase.from("catalog_brain_outcomes").update({
      feedback_human: feedbackText || null,
      feedback_rating: feedbackRating || null,
    }).eq("id", outcomeId);
    if (error) throw error;

    // Get outcome details to feed into decision memory
    const { data: outcome } = await supabase
      .from("catalog_brain_outcomes").select("*, catalog_brain_plans(*)").eq("id", outcomeId).single();

    if (outcome?.plan_id) {
      // Store learning in agent_decision_memory
      await supabase.from("agent_decision_memory").insert({
        workspace_id: outcome.workspace_id,
        agent_type: "catalog_gap_detector",
        decision_context: { plan_id: outcome.plan_id, outcome_type: outcome.outcome_type },
        decision_action: { impact_score: outcome.impact_score, feedback_rating: feedbackRating },
        confidence: feedbackRating ? feedbackRating * 20 : 50,
        approved: (feedbackRating || 0) >= 3,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
