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

    const { workspace_id, conflict_case_id, canonical_product_id, product_id, task_type, priority, review_reason, assigned_to } = await req.json();
    if (!workspace_id || !task_type) throw new Error("workspace_id and task_type required");

    const { data: task, error } = await supabase
      .from("human_review_tasks")
      .insert({
        workspace_id,
        conflict_case_id,
        canonical_product_id,
        product_id,
        task_type,
        priority: priority || 50,
        assigned_to,
        status: assigned_to ? "assigned" : "pending",
        review_reason,
      })
      .select()
      .single();

    if (error) throw error;

    if (assigned_to) {
      await supabase.from("review_assignments").insert({
        review_task_id: task.id,
        assigned_user_id: assigned_to,
        assignment_reason: "Initial assignment",
      });
    }

    if (conflict_case_id) {
      await supabase
        .from("conflict_cases")
        .update({ status: "in_review", requires_human_review: true })
        .eq("id", conflict_case_id);
    }

    return new Response(JSON.stringify(task), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
