import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { run_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: run } = await supabase.from("catalog_workflow_runs").select("*").eq("id", run_id).single();
    if (!run) throw new Error("Run not found");

    const { data: steps } = await supabase.from("catalog_workflow_steps")
      .select("*").eq("workflow_run_id", run_id).order("step_order");

    const { data: handoffs } = await supabase.from("workflow_handoffs")
      .select("*").eq("workflow_run_id", run_id);

    const total = (steps || []).length;
    const completed = (steps || []).filter((s: any) => s.status === "completed").length;
    const failed = (steps || []).filter((s: any) => s.status === "failed").length;

    const summary = {
      run_id, status: run.status,
      started_at: run.started_at, completed_at: run.completed_at,
      total_steps: total, completed_steps: completed, failed_steps: failed,
      handoffs_count: (handoffs || []).length,
      failed_handoffs: (handoffs || []).filter((h: any) => h.handoff_status === "failed").length,
      duration_minutes: run.completed_at && run.started_at
        ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 60000)
        : null,
      step_details: (steps || []).map((s: any) => ({
        name: s.step_name, type: s.step_type, status: s.status,
        duration_ms: s.completed_at && s.started_at
          ? new Date(s.completed_at).getTime() - new Date(s.started_at).getTime() : null,
      })),
    };

    // Save summary to run
    await supabase.from("catalog_workflow_runs").update({ run_summary: summary }).eq("id", run_id);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
