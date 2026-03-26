import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, event_type, source_type, entity_type, entity_id, event_payload, outcome, confidence_before, confidence_after } = await req.json();

    if (!supplier_id || !event_type) {
      return new Response(JSON.stringify({ error: "supplier_id and event_type required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Record learning event
    const { data: event, error: eventErr } = await supabase.from("supplier_learning_events").insert({
      supplier_id, event_type, source_type, entity_type, entity_id, event_payload, outcome: outcome || "success", confidence_before, confidence_after,
    }).select().single();
    if (eventErr) throw eventErr;

    // Update decision memory
    const decisionKey = `${event_type}:${entity_type || "general"}`;
    const { data: existing } = await supabase
      .from("supplier_decision_memory")
      .select("*")
      .eq("supplier_id", supplier_id)
      .eq("decision_key", decisionKey)
      .maybeSingle();

    if (existing) {
      const isSuccess = outcome === "success" || outcome === "confirmed";
      const newTimesUsed = existing.times_used + 1;
      const newSuccessRate = ((existing.success_rate * existing.times_used) + (isSuccess ? 1 : 0)) / newTimesUsed;
      await supabase.from("supplier_decision_memory").update({
        times_used: newTimesUsed,
        success_rate: newSuccessRate,
        last_used_at: new Date().toISOString(),
        decision_value: event_payload || existing.decision_value,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await supabase.from("supplier_decision_memory").insert({
        supplier_id,
        decision_type: event_type,
        decision_key: decisionKey,
        decision_value: event_payload || {},
        success_rate: (outcome === "success" || outcome === "confirmed") ? 1.0 : 0.0,
      });
    }

    return new Response(JSON.stringify({ event }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
