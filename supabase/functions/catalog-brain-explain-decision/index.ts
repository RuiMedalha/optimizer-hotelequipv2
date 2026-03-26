import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { decisionId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get decision
    const { data: decision, error: dErr } = await supabase
      .from("catalog_decisions").select("*").eq("id", decisionId).single();
    if (dErr) throw dErr;

    // Get explanation
    const { data: explanation } = await supabase
      .from("decision_explanations").select("*").eq("decision_id", decisionId).single();

    // Get related signals
    const { data: signals } = await supabase
      .from("catalog_decision_signals").select("*")
      .eq("workspace_id", decision.workspace_id)
      .eq("entity_id", decision.entity_id).limit(20);

    // Get related evaluations
    const { data: evaluations } = await supabase
      .from("catalog_impact_evaluations").select("*")
      .eq("workspace_id", decision.workspace_id)
      .eq("entity_id", decision.entity_id).limit(20);

    // Get related plan if exists
    const { data: plans } = await supabase
      .from("catalog_brain_plans").select("*")
      .eq("workspace_id", decision.workspace_id)
      .eq("target_entity_id", decision.entity_id).limit(1);

    return new Response(JSON.stringify({
      decision,
      explanation: explanation || null,
      signals: signals || [],
      evaluations: evaluations || [],
      plan: plans?.[0] || null,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
