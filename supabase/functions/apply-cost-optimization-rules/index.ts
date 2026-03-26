import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspaceId, context } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    const { data: rules } = await supabase.from("cost_optimization_rules")
      .select("*").eq("workspace_id", workspaceId).eq("is_active", true);

    const appliedOptimizations: any[] = [];

    for (const rule of rules || []) {
      const trigger = rule.trigger_condition as any;
      const action = rule.optimization_action as any;

      // Simple trigger matching
      let matches = true;
      if (trigger?.scope_type && context?.scopeType && trigger.scope_type !== context.scopeType) matches = false;
      if (trigger?.min_cost && context?.estimatedCost && context.estimatedCost < trigger.min_cost) matches = false;

      if (matches && action) {
        appliedOptimizations.push({ ruleId: rule.id, ruleName: rule.rule_name, action });

        // Log saving
        if (action.estimated_saving) {
          await supabase.from("optimization_savings_logs").insert({
            workspace_id: workspaceId,
            rule_id: rule.id,
            action_type: action.type || rule.rule_name,
            estimated_saving: action.estimated_saving,
            saving_scope: context?.scopeType || "workspace",
            saving_scope_id: context?.scopeId || null,
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, optimizations: appliedOptimizations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
