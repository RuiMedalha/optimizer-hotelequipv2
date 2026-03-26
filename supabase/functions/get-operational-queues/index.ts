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

    const { workspace_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    const [
      { data: ingestionQueue },
      { data: reviewQueue },
      { data: conflictQueue },
      { data: publishQueue },
    ] = await Promise.all([
      supabase.from("ingestion_jobs")
        .select("id, source_type, status, created_at")
        .eq("workspace_id", workspace_id)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: true }).limit(20),
      supabase.from("human_review_tasks")
        .select("id, task_type, priority, status, created_at")
        .eq("workspace_id", workspace_id)
        .eq("status", "pending")
        .order("priority", { ascending: false }).limit(20),
      supabase.from("conflict_cases")
        .select("id, conflict_type, severity, status, created_at")
        .eq("workspace_id", workspace_id)
        .eq("status", "open")
        .order("severity", { ascending: false }).limit(20),
      supabase.from("channel_payloads")
        .select("id, channel_id, payload_status, created_at")
        .eq("workspace_id", workspace_id)
        .in("payload_status", ["queued", "building", "validated"])
        .order("created_at", { ascending: true }).limit(20),
    ]);

    const now = Date.now();
    const addAging = (items: any[]) => (items || []).map(i => ({
      ...i,
      aging_minutes: Math.round((now - new Date(i.created_at).getTime()) / 60000),
    }));

    return new Response(JSON.stringify({
      success: true,
      queues: {
        ingestion: addAging(ingestionQueue),
        review: addAging(reviewQueue),
        conflicts: addAging(conflictQueue),
        publish: addAging(publishQueue),
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
