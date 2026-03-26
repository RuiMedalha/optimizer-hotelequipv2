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

    const { workspace_id, conflict_case_id } = await req.json();
    if (!workspace_id || !conflict_case_id) throw new Error("workspace_id and conflict_case_id required");

    const { data: conflict } = await supabase
      .from("conflict_cases")
      .select("*")
      .eq("id", conflict_case_id)
      .single();

    if (!conflict || conflict.status !== "open") {
      return new Response(JSON.stringify({ resolved: false, reason: "Conflict not open" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get resolution rules
    const { data: rules } = await supabase
      .from("conflict_resolution_rules")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("conflict_type", conflict.conflict_type)
      .eq("is_active", true)
      .order("rule_priority", { ascending: false });

    const rule = rules?.[0];
    if (!rule || rule.resolution_mode === "manual_only") {
      await supabase
        .from("conflict_cases")
        .update({ auto_resolution_status: "escalated", requires_human_review: true })
        .eq("id", conflict_case_id);

      return new Response(JSON.stringify({ resolved: false, reason: "Escalated to human review" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get items for this conflict
    const { data: items } = await supabase
      .from("conflict_case_items")
      .select("*")
      .eq("conflict_case_id", conflict_case_id)
      .order("confidence_score", { ascending: false });

    if (!items || items.length === 0) {
      await supabase
        .from("conflict_cases")
        .update({ auto_resolution_status: "failed" })
        .eq("id", conflict_case_id);

      return new Response(JSON.stringify({ resolved: false, reason: "No items to resolve" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auto-resolve: pick highest confidence
    const winner = items[0];
    await supabase
      .from("conflict_case_items")
      .update({ selection_status: "selected" })
      .eq("id", winner.id);

    for (const item of items.slice(1)) {
      await supabase
        .from("conflict_case_items")
        .update({ selection_status: "rejected" })
        .eq("id", item.id);
    }

    await supabase
      .from("conflict_cases")
      .update({
        status: "auto_resolved",
        auto_resolution_status: "resolved",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", conflict_case_id);

    // Log resolution
    await supabase.from("resolution_history").insert({
      conflict_case_id,
      resolution_source: "system",
      resolution_action: `Auto-resolved using ${rule.resolution_mode}`,
      before_state: { items: items.map((i: any) => ({ id: i.id, value: i.candidate_value })) },
      after_state: { winner_id: winner.id, winner_value: winner.candidate_value },
      confidence_delta: winner.confidence_score - (items[1]?.confidence_score || 0),
    });

    return new Response(JSON.stringify({ resolved: true, winner_id: winner.id, rule_used: rule.rule_name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
