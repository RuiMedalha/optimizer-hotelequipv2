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
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get unprocessed observations grouped by product
    const { data: observations } = await supabase
      .from("catalog_brain_observations").select("*")
      .eq("workspace_id", workspaceId).eq("processed", false)
      .order("severity", { ascending: false }).limit(100);

    if (!observations?.length) {
      return new Response(JSON.stringify({ plans_created: 0, message: "No unprocessed observations" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by product
    const byProduct: Record<string, any[]> = {};
    for (const obs of observations) {
      const key = obs.product_id || "general";
      (byProduct[key] = byProduct[key] || []).push(obs);
    }

    let plansCreated = 0;

    for (const [productId, obs] of Object.entries(byProduct)) {
      const avgSeverity = Math.round(obs.reduce((s: number, o: any) => s + o.severity, 0) / obs.length);
      const types = [...new Set(obs.map((o: any) => o.observation_type))];

      // Generate plan
      const planName = productId === "general"
        ? `Plano de otimização geral (${types.length} sinais)`
        : `Otimizar produto (${types.join(", ")})`;

      const { data: plan, error: planErr } = await supabase.from("catalog_brain_plans").insert({
        workspace_id: workspaceId,
        plan_name: planName,
        plan_description: `${obs.length} observações detetadas com severidade média ${avgSeverity}`,
        objective: planName,
        target_entity_type: "product",
        target_entity_id: productId !== "general" ? productId : null,
        priority: avgSeverity,
        priority_score: avgSeverity,
        confidence: Math.min(90, avgSeverity + 10),
        estimated_impact: { observations: obs.length, types, avg_severity: avgSeverity },
        requires_approval: avgSeverity < 70,
        created_by: "brain-orchestrator",
      }).select().single();

      if (planErr || !plan) continue;

      // Generate steps from observations
      const steps: any[] = [];
      let order = 1;
      for (const o of obs) {
        const stepType = mapObservationToStep(o.observation_type);
        steps.push({
          plan_id: plan.id, step_order: order++,
          step_type: stepType,
          step_description: `Corrigir: ${o.observation_type} (severidade ${o.severity})`,
          input_payload: { observation_id: o.id, product_id: o.product_id, signal: o.signal_payload },
          product_id: o.product_id,
        });
      }

      if (steps.length) {
        await supabase.from("catalog_brain_plan_steps").insert(steps);
      }

      // Mark observations as processed
      const obsIds = obs.map((o: any) => o.id);
      await supabase.from("catalog_brain_observations").update({ processed: true }).in("id", obsIds);

      plansCreated++;
    }

    return new Response(JSON.stringify({ plans_created: plansCreated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function mapObservationToStep(obsType: string): string {
  const map: Record<string, string> = {
    quality_gate_fail: "fix_quality", review_correction: "apply_correction",
    seo_weakness: "optimize_seo", missing_attribute: "complete_attribute",
    channel_rejection: "fix_channel_error", low_conversion: "optimize_listing",
    price_anomaly: "review_pricing", image_issue: "optimize_images",
    translation_gap: "generate_translation", feed_error: "fix_feed",
    duplicate_detected: "resolve_duplicate", supplier_signal: "process_supplier_data",
  };
  return map[obsType] || "generic_fix";
}
