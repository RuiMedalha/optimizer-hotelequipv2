import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId, decisionId, feedback, feedbackType } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Record learning signal from human feedback
    const signalType = feedback === "positive" ? "human_approval" : "human_rejection";
    const strength = feedback === "positive" ? 1 : -1;

    let entityType = null;
    let entityId = null;

    if (decisionId) {
      const { data: decision } = await supabase
        .from("catalog_decisions").select("*").eq("id", decisionId).single();
      if (decision) {
        entityType = decision.entity_type;
        entityId = decision.entity_id;
      }
    }

    await supabase.from("catalog_learning_signals").insert({
      workspace_id: workspaceId,
      entity_type: entityType,
      entity_id: entityId,
      signal_type: signalType,
      feedback_type: feedbackType || "explicit_feedback",
      signal_strength: strength,
      metadata: { decision_id: decisionId, feedback },
      source: "human_feedback",
    });

    // Update reinforcement memory with feedback
    if (decisionId) {
      const { data: decision } = await supabase
        .from("catalog_decisions").select("*").eq("id", decisionId).single();
      if (decision) {
        await supabase.from("catalog_reinforcement_memory").insert({
          workspace_id: workspaceId,
          decision_type: decision.decision_type,
          context_features: decision.decision_context,
          action_taken: decision.decision_type,
          reward: feedback === "positive" ? 10 : -10,
          confidence: 90,
        });
      }
    }

    return new Response(JSON.stringify({ recorded: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
