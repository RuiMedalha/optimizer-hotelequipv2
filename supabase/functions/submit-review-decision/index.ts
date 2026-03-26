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

    const { review_task_id, decision_type, decision_reason, field_overrides, approved_by } = await req.json();
    if (!review_task_id || !decision_type || !approved_by) throw new Error("review_task_id, decision_type and approved_by required");

    // Save decision
    const { data: decision } = await supabase.from("review_decisions").insert({
      review_task_id,
      decision_type,
      decision_reason,
      field_overrides,
      approved_by,
    }).select().single();

    // Update task status
    const taskStatus = ["approve", "unlock_publish"].includes(decision_type) ? "approved"
      : ["reject", "block_publish"].includes(decision_type) ? "rejected" : "done";

    await supabase.from("human_review_tasks").update({
      status: taskStatus,
      decision_payload: { decision_type, decision_reason, field_overrides },
      resolved_at: new Date().toISOString(),
    }).eq("id", review_task_id);

    // Get the task to find linked conflict case
    const { data: task } = await supabase
      .from("human_review_tasks")
      .select("conflict_case_id, workspace_id, supplier_id:conflict_cases(supplier_id)")
      .eq("id", review_task_id)
      .single();

    // Resolve linked conflict case
    if (task?.conflict_case_id) {
      await supabase.from("conflict_cases").update({
        status: "human_resolved",
        resolved_at: new Date().toISOString(),
      }).eq("id", task.conflict_case_id);

      await supabase.from("resolution_history").insert({
        conflict_case_id: task.conflict_case_id,
        resolution_source: "human",
        resolution_action: `Human decision: ${decision_type}`,
        after_state: { decision_type, field_overrides },
      });
    }

    return new Response(JSON.stringify(decision), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
