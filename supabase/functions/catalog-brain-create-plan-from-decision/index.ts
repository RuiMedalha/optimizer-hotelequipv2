import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DECISION_STEP_MAP: Record<string, { steps: { type: string; agent: string; desc: string }[] }> = {
  fix_quality: {
    steps: [
      { type: "validate_schema", agent: "attribute_completeness_agent", desc: "Validar schema e atributos" },
      { type: "fix_attributes", agent: "attribute_completeness_agent", desc: "Corrigir atributos em falta" },
      { type: "validate_quality", agent: "feed_optimizer", desc: "Revalidar quality gate" },
    ],
  },
  optimize_seo: {
    steps: [
      { type: "analyze_seo", agent: "seo_optimizer", desc: "Analisar SEO atual" },
      { type: "optimize_title", agent: "seo_optimizer", desc: "Otimizar título e meta" },
      { type: "validate_seo", agent: "seo_optimizer", desc: "Validar melhorias SEO" },
    ],
  },
  fix_channel_compliance: {
    steps: [
      { type: "analyze_rejection", agent: "feed_optimizer", desc: "Analisar rejeição do canal" },
      { type: "fix_attributes", agent: "attribute_completeness_agent", desc: "Corrigir atributos obrigatórios" },
      { type: "validate_feed", agent: "feed_optimizer", desc: "Revalidar feed" },
      { type: "republish", agent: "channel_performance_agent", desc: "Republicar no canal" },
    ],
  },
  create_bundle: {
    steps: [
      { type: "analyze_products", agent: "bundle_generator", desc: "Analisar produtos relacionados" },
      { type: "create_bundle", agent: "bundle_generator", desc: "Criar bundle" },
      { type: "optimize_bundle_seo", agent: "seo_optimizer", desc: "Otimizar SEO do bundle" },
    ],
  },
  fix_data: {
    steps: [
      { type: "detect_issues", agent: "attribute_completeness_agent", desc: "Detetar inconsistências" },
      { type: "fix_data", agent: "attribute_completeness_agent", desc: "Corrigir dados" },
      { type: "validate", agent: "feed_optimizer", desc: "Validar correções" },
    ],
  },
  optimize_pricing: {
    steps: [
      { type: "analyze_pricing", agent: "pricing_analyzer", desc: "Analisar preços" },
      { type: "suggest_price", agent: "pricing_analyzer", desc: "Sugerir novo preço" },
    ],
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { decisionId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: decision, error: dErr } = await supabase
      .from("catalog_decisions").select("*").eq("id", decisionId).single();
    if (dErr) throw dErr;

    const template = DECISION_STEP_MAP[decision.decision_type] || DECISION_STEP_MAP.fix_data;

    // Create plan
    const { data: plan, error: pErr } = await supabase.from("catalog_brain_plans").insert({
      workspace_id: decision.workspace_id,
      plan_name: `${decision.decision_type} for entity ${decision.entity_id?.substring(0, 8)}`,
      target_entity_type: decision.entity_type,
      target_entity_id: decision.entity_id,
      objective: `Auto-generated from decision: ${decision.decision_type}`,
      status: "draft",
      priority_score: Math.round(Number(decision.priority_score)),
      confidence: decision.confidence,
      requires_approval: true,
      estimated_impact: { total: Number(decision.impact_score), context: decision.decision_context },
    }).select("id").single();
    if (pErr) throw pErr;

    // Create steps
    let prevStepId: string | null = null;
    for (let i = 0; i < template.steps.length; i++) {
      const step = template.steps[i];
      const { data: stepData, error: sErr }: { data: any; error: any } = await supabase.from("catalog_brain_plan_steps").insert({
        plan_id: plan!.id,
        step_order: i + 1,
        step_type: step.type,
        step_description: step.desc,
        assigned_agent_type: step.agent,
        product_id: decision.entity_type === "product" ? decision.entity_id : null,
        depends_on_step_id: prevStepId,
        status: "pending",
        confidence: decision.confidence,
      }).select("id").single();
      if (sErr) throw sErr;
      prevStepId = stepData!.id;
    }

    // Update decision status
    await supabase.from("catalog_decisions")
      .update({ status: "executed", updated_at: new Date().toISOString() })
      .eq("id", decisionId);

    return new Response(JSON.stringify({ plan_id: plan!.id, steps: template.steps.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
