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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Get active agents
    const { data: agents, error: agentsErr } = await supabase
      .from("catalog_agents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "active");
    if (agentsErr) throw agentsErr;
    if (!agents?.length) return new Response(JSON.stringify({ message: "No active agents" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // 2. For each agent, generate tasks from existing insights
    const tasksCreated: any[] = [];

    for (const agent of agents) {
      // Check policies
      const { data: policies } = await supabase
        .from("agent_policies")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("agent_type", agent.agent_type);

      let sourceTable = "";
      let taskType = "";
      switch (agent.agent_type) {
        case "seo_optimizer":
          sourceTable = "seo_recommendations";
          taskType = "update_seo_fields";
          break;
        case "bundle_generator":
          sourceTable = "bundle_suggestions";
          taskType = "create_bundle";
          break;
        case "catalog_gap_detector":
          sourceTable = "catalog_gap_analysis";
          taskType = "detect_gap";
          break;
        case "attribute_completeness_agent":
          sourceTable = "attribute_completeness_scores";
          taskType = "fix_completeness";
          break;
        default:
          sourceTable = "product_insights";
          taskType = agent.agent_type;
      }

      // Get unprocessed items (limit 20 per cycle)
      const { data: items } = await supabase
        .from(sourceTable)
        .select("id, product_id, workspace_id")
        .eq("workspace_id", workspaceId)
        .limit(20);

      if (!items?.length) continue;

      const requiresApproval = policies?.some((p: any) => p.requires_approval) ?? true;

      for (const item of items) {
        const { data: task } = await supabase.from("agent_tasks").insert({
          workspace_id: workspaceId,
          agent_id: agent.id,
          task_type: taskType,
          payload: { source_id: item.id, product_id: item.product_id, requires_approval: requiresApproval },
          priority: 100,
          status: "queued",
        }).select().single();
        if (task) tasksCreated.push(task);
      }
    }

    // 3. Execute queued tasks (up to 50)
    const { data: queuedTasks } = await supabase
      .from("agent_tasks")
      .select("*, catalog_agents(*)")
      .eq("workspace_id", workspaceId)
      .eq("status", "queued")
      .order("priority", { ascending: true })
      .limit(50);

    let executed = 0;
    let failed = 0;

    for (const task of (queuedTasks || [])) {
      await supabase.from("agent_tasks").update({ status: "running", started_at: new Date().toISOString() }).eq("id", task.id);

      try {
        const requiresApproval = task.payload?.requires_approval ?? true;

        // Record action
        await supabase.from("agent_actions").insert({
          workspace_id: workspaceId,
          agent_id: task.agent_id,
          product_id: task.payload?.product_id || null,
          action_type: mapTaskToAction(task.task_type),
          action_payload: task.payload,
          confidence: 70,
          approved_by_user: !requiresApproval,
        });

        await supabase.from("agent_tasks").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          result: { success: true, requires_approval: requiresApproval },
        }).eq("id", task.id);
        executed++;
      } catch (e: unknown) {
        await supabase.from("agent_tasks").update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: (e as Error).message,
        }).eq("id", task.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({
      agents: agents.length,
      tasks_created: tasksCreated.length,
      executed,
      failed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function mapTaskToAction(taskType: string): string {
  const map: Record<string, string> = {
    update_seo_fields: "update_seo_fields",
    create_bundle: "create_bundle",
    detect_gap: "update_attributes",
    fix_completeness: "update_attributes",
    seo_optimizer: "update_seo_fields",
    bundle_generator: "create_bundle",
    feed_optimizer: "publish_to_channel",
    translation_agent: "generate_translation",
    image_optimizer: "optimize_images",
    channel_performance_agent: "publish_to_channel",
    pricing_analyzer: "suggest_price_change",
  };
  return map[taskType] || "update_attributes";
}
