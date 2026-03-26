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

    const { review_task_id, assigned_user_id, assigned_by, assignment_reason } = await req.json();
    if (!review_task_id || !assigned_user_id) throw new Error("review_task_id and assigned_user_id required");

    await supabase
      .from("human_review_tasks")
      .update({ assigned_to: assigned_user_id, status: "assigned" })
      .eq("id", review_task_id);

    const { data } = await supabase.from("review_assignments").insert({
      review_task_id,
      assigned_user_id,
      assigned_by,
      assignment_reason: assignment_reason || "Manual assignment",
    }).select().single();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
