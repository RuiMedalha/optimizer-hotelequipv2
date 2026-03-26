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

    const alerts: any[] = [];

    // Check failed jobs
    const { count: failedJobs } = await supabase
      .from("optimization_jobs").select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace_id).eq("status", "error");
    if ((failedJobs || 0) > 0) {
      alerts.push({
        workspace_id, alert_type: "failed_jobs", alert_scope: "workspace",
        entity_type: "optimization_jobs", severity: 3,
        title: `${failedJobs} jobs falhados`, message: `Existem ${failedJobs} jobs com erro que requerem atenção.`,
      });
    }

    // Check review backlog
    const { count: reviewBacklog } = await supabase
      .from("human_review_tasks").select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace_id).eq("status", "pending");
    if ((reviewBacklog || 0) > 5) {
      alerts.push({
        workspace_id, alert_type: "review_backlog", alert_scope: "review_queue",
        entity_type: "human_review_tasks", severity: 2,
        title: `${reviewBacklog} tarefas de revisão pendentes`, message: "O backlog de revisão está a crescer.",
      });
    }

    // Check open conflicts
    const { count: conflicts } = await supabase
      .from("conflict_cases").select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace_id).eq("status", "open");
    if ((conflicts || 0) > 0) {
      alerts.push({
        workspace_id, alert_type: "open_conflicts", alert_scope: "product",
        entity_type: "conflict_cases", severity: 2,
        title: `${conflicts} conflitos abertos`, message: "Existem conflitos por resolver.",
      });
    }

    // Check invalid payloads
    const { count: invalidPayloads } = await supabase
      .from("channel_payloads").select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace_id).eq("payload_status", "invalid");
    if ((invalidPayloads || 0) > 0) {
      alerts.push({
        workspace_id, alert_type: "invalid_payloads", alert_scope: "channel",
        entity_type: "channel_payloads", severity: 2,
        title: `${invalidPayloads} payloads inválidos`, message: "Existem payloads que não passaram na validação.",
      });
    }

    // Insert new alerts (avoid duplicates by checking existing open alerts)
    let inserted = 0;
    for (const alert of alerts) {
      const { count: existing } = await supabase
        .from("control_tower_alerts").select("*", { count: "exact", head: true })
        .eq("workspace_id", workspace_id).eq("alert_type", alert.alert_type).eq("status", "open");
      if ((existing || 0) === 0) {
        await supabase.from("control_tower_alerts").insert(alert);
        inserted++;
      }
    }

    return new Response(JSON.stringify({ success: true, alerts_generated: inserted, alerts_checked: alerts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
