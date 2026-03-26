import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspaceId, planType, executionMode, runId, context } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    const mode = executionMode || "balanced";
    const type = planType || "enrichment";

    // Fetch routing policies for context
    const { data: policies } = await supabase
      .from("ai_routing_policies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("context_type", type)
      .eq("is_active", true);

    // Fetch model matrix
    const { data: models } = await supabase
      .from("model_capability_matrix")
      .select("*")
      .eq("is_active", true);

    // Choose model based on mode
    const sortedModels = (models || []).sort((a: any, b: any) => {
      if (mode === "economic") return a.relative_cost_score - b.relative_cost_score;
      if (mode === "premium") return b.quality_score - a.quality_score;
      return (b.quality_score / b.relative_cost_score) - (a.quality_score / a.relative_cost_score);
    });

    const primaryModel = sortedModels[0]?.model_name || "google/gemini-3-flash-preview";

    // Determine steps based on plan type
    const stepTemplates: Record<string, Array<{ name: string; executor: string; target: string }>> = {
      ingestion: [
        { name: "Parse input", executor: "rules_engine", target: "parse-ingestion" },
        { name: "Normalize fields", executor: "rules_engine", target: "normalize-canonical-fields" },
        { name: "Resolve identity", executor: "ai_text", target: "assemble-canonical-product" },
      ],
      canonical_assembly: [
        { name: "Resolve fields", executor: "ai_text", target: "resolve-canonical-fields" },
        { name: "Normalize", executor: "rules_engine", target: "normalize-canonical-fields" },
        { name: "Link assets", executor: "rules_engine", target: "link-canonical-assets" },
        { name: "Build relationships", executor: "ai_text", target: "build-canonical-relationships" },
      ],
      enrichment: [
        { name: "Generate content", executor: "ai_text", target: "enrich-products" },
        { name: "Validate schema", executor: "rules_engine", target: "validate-product" },
        { name: "Quality gate", executor: "rules_engine", target: "evaluate-quality-gate" },
      ],
      validation: [
        { name: "Schema validation", executor: "rules_engine", target: "validate-product" },
        { name: "Quality gate", executor: "rules_engine", target: "evaluate-quality-gate" },
        { name: "Detect conflicts", executor: "rules_engine", target: "detect-conflicts" },
      ],
      translation: [
        { name: "Translate", executor: "ai_text", target: "translate-product" },
        { name: "Validate translation", executor: "rules_engine", target: "validate-product" },
      ],
      asset_processing: [
        { name: "Process images", executor: "ai_vision", target: "process-product-images" },
        { name: "Link assets", executor: "rules_engine", target: "link-canonical-assets" },
      ],
      publish: [
        { name: "Build payload", executor: "rules_engine", target: "build-channel-payload" },
        { name: "Validate payload", executor: "rules_engine", target: "validate-channel-payload" },
        { name: "Publish approval", executor: "rules_engine", target: "evaluate-publish-approval" },
      ],
      sync: [
        { name: "Snapshot state", executor: "rules_engine", target: "snapshot-channel-state" },
        { name: "Rebuild payload", executor: "rules_engine", target: "rebuild-channel-payload" },
      ],
      review_support: [
        { name: "Detect conflicts", executor: "rules_engine", target: "detect-conflicts" },
        { name: "Auto resolution", executor: "ai_text", target: "attempt-auto-resolution" },
      ],
    };

    const steps = stepTemplates[type] || stepTemplates.enrichment;

    // Cost estimation per executor type
    const costMap: Record<string, number> = {
      rules_engine: 0,
      ai_text: mode === "economic" ? 0.001 : mode === "premium" ? 0.01 : 0.003,
      ai_vision: mode === "economic" ? 0.005 : mode === "premium" ? 0.03 : 0.01,
      ocr: 0.002,
      human_review: 0,
      api_connector: 0.001,
      internal_function: 0,
    };

    const estimatedCost = steps.reduce((sum, s) => sum + (costMap[s.executor] || 0), 0);
    const estimatedDuration = steps.length * (mode === "economic" ? 500 : mode === "premium" ? 2000 : 1000);

    // Create plan
    const { data: plan, error: planErr } = await supabase
      .from("execution_plans")
      .insert({
        workspace_id: workspaceId,
        run_id: runId || null,
        plan_type: type,
        execution_mode: mode,
        status: "pending",
        estimated_cost: estimatedCost,
        estimated_duration_ms: estimatedDuration,
      })
      .select()
      .single();

    if (planErr) throw planErr;

    // Create steps
    const stepInserts = steps.map((s, i) => ({
      plan_id: plan.id,
      step_order: i + 1,
      step_name: s.name,
      executor_type: s.executor,
      executor_target: s.target,
      model_name: s.executor.startsWith("ai_") ? primaryModel : null,
      status: "pending",
      estimated_cost: costMap[s.executor] || 0,
      estimated_duration_ms: mode === "economic" ? 500 : mode === "premium" ? 2000 : 1000,
    }));

    await supabase.from("execution_plan_steps").insert(stepInserts);

    return new Response(JSON.stringify({ success: true, planId: plan.id, steps: stepInserts.length, estimatedCost, model: primaryModel }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
