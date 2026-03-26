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
    const signals: any[] = [];

    // Quality gate failures → quality_issue
    const { data: qgResults } = await supabase
      .from("quality_gate_results").select("*").eq("workspace_id", workspaceId).eq("passed", false).limit(50);
    for (const r of (qgResults || [])) {
      signals.push({
        workspace_id: workspaceId, entity_type: "product", entity_id: r.product_id,
        signal_type: "quality_issue", severity: 80, confidence: 90,
        payload: { gate_id: r.id, failures: r.failures }, source: "quality_gates",
      });
    }

    // Channel rejections → channel_rejection
    const { data: rejections } = await supabase
      .from("channel_rejections").select("*").eq("workspace_id", workspaceId).eq("resolved", false).limit(50);
    for (const r of (rejections || [])) {
      signals.push({
        workspace_id: workspaceId, entity_type: "product", entity_id: r.product_id,
        signal_type: "channel_rejection", severity: 75, confidence: 95,
        payload: { rejection_id: r.id, code: r.external_code, message: r.external_message }, source: "channel_rejections",
      });
    }

    // SEO insights → seo_opportunity
    const { data: insights } = await supabase
      .from("product_insights").select("*").eq("workspace_id", workspaceId).eq("status", "open")
      .in("insight_type", ["seo_improvement", "title_optimization"]).limit(50);
    for (const i of (insights || [])) {
      signals.push({
        workspace_id: workspaceId, entity_type: "product", entity_id: i.product_id,
        signal_type: "seo_opportunity", severity: i.priority || 60, confidence: 70,
        payload: { insight_id: i.id, insight_payload: i.insight_payload }, source: "product_insights",
      });
    }

    // Missing attributes → data_inconsistency
    const { data: missingAttr } = await supabase
      .from("product_insights").select("*").eq("workspace_id", workspaceId).eq("status", "open")
      .eq("insight_type", "missing_attribute").limit(50);
    for (const i of (missingAttr || [])) {
      signals.push({
        workspace_id: workspaceId, entity_type: "product", entity_id: i.product_id,
        signal_type: "data_inconsistency", severity: 65, confidence: 80,
        payload: { insight_id: i.id, insight_payload: i.insight_payload }, source: "product_insights",
      });
    }

    // Bundle suggestions → bundle_opportunity
    const { data: bundles } = await supabase
      .from("bundle_suggestions").select("*").eq("workspace_id", workspaceId).is("accepted", null).limit(30);
    for (const b of (bundles || [])) {
      signals.push({
        workspace_id: workspaceId, entity_type: "product", entity_id: b.primary_product_id,
        signal_type: "bundle_opportunity", severity: 50, confidence: b.confidence || 60,
        payload: { bundle_id: b.id, bundle_type: b.bundle_type }, source: "bundle_suggestions",
      });
    }

    if (signals.length) {
      const { error } = await supabase.from("catalog_decision_signals").insert(signals);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ detected: signals.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
