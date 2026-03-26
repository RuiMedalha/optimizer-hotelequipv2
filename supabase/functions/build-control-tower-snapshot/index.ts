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

    const { workspace_id, snapshot_type = "manual" } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    // Gather metrics from multiple tables
    const [
      { count: activeJobs },
      { count: failedJobs },
      { count: reviewPending },
      { count: conflictsOpen },
      { count: payloadsInvalid },
      { count: alertsOpen },
    ] = await Promise.all([
      supabase.from("optimization_jobs").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).in("status", ["running", "pending"]),
      supabase.from("optimization_jobs").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("status", "error"),
      supabase.from("human_review_tasks").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("status", "pending"),
      supabase.from("conflict_cases").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("status", "open"),
      supabase.from("channel_payloads").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("payload_status", "invalid"),
      supabase.from("control_tower_alerts").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("status", "open"),
    ]);

    const snapshot_payload = {
      active_jobs: activeJobs || 0,
      failed_jobs: failedJobs || 0,
      review_pending: reviewPending || 0,
      conflicts_open: conflictsOpen || 0,
      payloads_invalid: payloadsInvalid || 0,
      alerts_open: alertsOpen || 0,
      captured_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("control_tower_snapshots").insert({
      workspace_id,
      snapshot_type,
      snapshot_payload,
    }).select().single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, snapshot: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
