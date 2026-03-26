import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { taskId } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: task, error } = await supabase
      .from("agent_tasks")
      .select("*, catalog_agents(*)")
      .eq("id", taskId)
      .single();
    if (error || !task) throw new Error("Task not found");

    // Mark as running
    await supabase.from("agent_tasks").update({ status: "running", started_at: new Date().toISOString() }).eq("id", taskId);

    const productId = task.payload?.product_id;
    let result: any = { success: true };

    try {
      // Check publish locks
      if (productId) {
        const { data: locks } = await supabase
          .from("publish_locks")
          .select("id")
          .eq("product_id", productId)
          .eq("is_active", true);
        if (locks?.length) {
          throw new Error("Product is locked by publish_locks");
        }
      }

      // Check policies
      const { data: policies } = await supabase
        .from("agent_policies")
        .select("*")
        .eq("workspace_id", task.workspace_id)
        .eq("agent_type", task.catalog_agents?.agent_type);

      const requiresApproval = policies?.some((p: any) => p.requires_approval) ?? true;

      // Execute based on task type
      switch (task.task_type) {
        case "update_seo_fields":
          if (productId && !requiresApproval) {
            const { data: seo } = await supabase
              .from("seo_recommendations")
              .select("*")
              .eq("product_id", productId)
              .order("created_at", { ascending: false })
              .limit(1)
              .single();
            if (seo) {
              await supabase.from("products").update({
                meta_title: seo.recommended_title,
                meta_description: seo.recommended_meta_description,
              }).eq("id", productId);
              result = { applied: true, seo_id: seo.id };
            }
          }
          break;

        case "create_bundle":
          result = { bundle_suggestion_recorded: true };
          break;

        default:
          result = { task_type: task.task_type, status: "recorded" };
      }

      // Log action
      await supabase.from("agent_actions").insert({
        workspace_id: task.workspace_id,
        agent_id: task.agent_id,
        product_id: productId,
        action_type: mapTaskToAction(task.task_type),
        action_payload: task.payload,
        action_result: result,
        confidence: 70,
        approved_by_user: !requiresApproval,
      });

      await supabase.from("agent_tasks").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        result,
      }).eq("id", taskId);

      // Learn from decision
      await supabase.from("agent_decision_memory").insert({
        workspace_id: task.workspace_id,
        agent_type: task.catalog_agents?.agent_type,
        decision_context: { task_type: task.task_type, product_id: productId },
        decision_action: result,
        confidence: 70,
        approved: !requiresApproval,
      });

    } catch (execErr) {
      await supabase.from("agent_tasks").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: execErr.message,
      }).eq("id", taskId);
      result = { error: execErr.message };
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function mapTaskToAction(taskType: string): string {
  const map: Record<string, string> = {
    update_seo_fields: "update_seo_fields",
    create_bundle: "create_bundle",
    update_title: "update_title",
    update_description: "update_description",
    fix_completeness: "update_attributes",
  };
  return map[taskType] || "update_attributes";
}
