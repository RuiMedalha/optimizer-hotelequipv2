import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const observations: any[] = [];

    // ─── 1. Quality Gate Failures ───
    const { data: qgResults } = await supabase
      .from("quality_gate_results").select("*").eq("workspace_id", workspaceId).limit(50);
    for (const r of (qgResults || [])) {
      if (r.passed === false) {
        observations.push({
          workspace_id: workspaceId, observation_type: "quality_gate_fail",
          entity_type: "product", entity_id: r.product_id,
          product_id: r.product_id, signal_source: "quality_gates", source: "quality_gates",
          signal_payload: { gate_id: r.id, failures: r.failures }, severity: 80, signal_strength: 80,
        });
      }
    }

    // ─── 2. Channel Rejections ───
    const { data: rejections } = await supabase
      .from("channel_rejections").select("*").eq("workspace_id", workspaceId).eq("resolved", false).limit(50);
    for (const r of (rejections || [])) {
      observations.push({
        workspace_id: workspaceId, observation_type: "channel_rejection",
        entity_type: "product", entity_id: r.product_id,
        product_id: r.product_id, signal_source: "channel_rejections", source: "channel_rejections",
        signal_payload: { rejection_id: r.id, code: r.external_code, message: r.external_message },
        severity: 70, signal_strength: 70,
      });
    }

    // ─── 3. SEO Weaknesses from Insights ───
    const { data: insights } = await supabase
      .from("product_insights").select("*").eq("workspace_id", workspaceId).eq("status", "open")
      .in("insight_type", ["seo_improvement", "title_optimization", "missing_attribute"]).limit(50);
    for (const i of (insights || [])) {
      const typeMap: Record<string, string> = {
        seo_improvement: "seo_weakness", title_optimization: "seo_weakness", missing_attribute: "missing_attribute",
      };
      observations.push({
        workspace_id: workspaceId, observation_type: typeMap[i.insight_type] || "seo_weakness",
        entity_type: "product", entity_id: i.product_id,
        product_id: i.product_id, signal_source: "product_insights", source: "product_insights",
        signal_payload: { insight_id: i.id, payload: i.insight_payload },
        severity: i.priority || 50, signal_strength: i.priority || 50,
      });
    }

    // ─── 4. WooCommerce Publish Feedback Loop (NEW) ───
    // Collect recent publish results to feed back into the brain
    const { data: publishJobs } = await supabase
      .from("publish_jobs")
      .select("id, status, product_ids, result_payload, created_at, completed_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20);

    for (const job of (publishJobs || [])) {
      const productIds = job.product_ids || [];
      const resultPayload = job.result_payload || {};
      const published = resultPayload.published || [];
      const failed = resultPayload.failed || [];

      // Track publish successes — brain learns what products publish well
      for (const pid of published) {
        observations.push({
          workspace_id: workspaceId,
          observation_type: "publish_success",
          entity_type: "product",
          entity_id: pid,
          product_id: pid,
          signal_source: "woocommerce_publish",
          source: "woocommerce_publish",
          signal_payload: {
            job_id: job.id,
            published_at: job.completed_at,
          },
          severity: 10,
          signal_strength: 60,
        });
      }

      // Track publish failures — brain prioritizes fixes
      for (const f of failed) {
        const fProductId = typeof f === "string" ? f : f?.product_id;
        const fError = typeof f === "object" ? f?.error : undefined;
        if (!fProductId) continue;

        observations.push({
          workspace_id: workspaceId,
          observation_type: "publish_failure",
          entity_type: "product",
          entity_id: fProductId,
          product_id: fProductId,
          signal_source: "woocommerce_publish",
          source: "woocommerce_publish",
          signal_payload: {
            job_id: job.id,
            error: fError,
            attempted_at: job.created_at,
          },
          severity: 85,
          signal_strength: 90,
        });
      }
    }

    // ─── 5. Agent Task Outcomes Feedback (NEW) ───
    // Learn from completed/failed agent tasks
    const { data: recentTasks } = await supabase
      .from("agent_tasks")
      .select("id, agent_id, task_type, status, result, error_message, product_id:payload->product_id, completed_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["completed", "failed"])
      .order("completed_at", { ascending: false })
      .limit(30);

    for (const t of (recentTasks || [])) {
      if (t.status === "failed" && t.error_message) {
        observations.push({
          workspace_id: workspaceId,
          observation_type: "agent_task_failure",
          entity_type: "agent",
          entity_id: t.agent_id,
          product_id: typeof t.product_id === "string" ? t.product_id : null,
          signal_source: "agent_system",
          source: "agent_system",
          signal_payload: {
            task_id: t.id,
            task_type: t.task_type,
            error: t.error_message,
          },
          severity: 60,
          signal_strength: 70,
        });
      } else if (t.status === "completed" && t.result?.applied) {
        observations.push({
          workspace_id: workspaceId,
          observation_type: "agent_task_success",
          entity_type: "agent",
          entity_id: t.agent_id,
          product_id: typeof t.product_id === "string" ? t.product_id : null,
          signal_source: "agent_system",
          source: "agent_system",
          signal_payload: {
            task_id: t.id,
            task_type: t.task_type,
            confidence: t.result?.confidence,
          },
          severity: 10,
          signal_strength: 50,
        });
      }
    }

    // ─── 6. Deduplicate before insert ───
    // Avoid re-ingesting same observations by checking recent records
    const filteredObs = observations.filter(o => o.entity_id != null);

    if (filteredObs.length) {
      const { error } = await supabase.from("catalog_brain_observations").insert(filteredObs);
      if (error) throw error;
    }

    return new Response(JSON.stringify({
      ingested: filteredObs.length,
      sources: {
        quality_gates: qgResults?.length || 0,
        channel_rejections: rejections?.length || 0,
        seo_insights: insights?.length || 0,
        publish_feedback: publishJobs?.length || 0,
        agent_outcomes: recentTasks?.length || 0,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
