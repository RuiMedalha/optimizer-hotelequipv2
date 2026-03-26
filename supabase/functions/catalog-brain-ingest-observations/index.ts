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

    const observations: any[] = [];

    // Collect quality gate failures
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

    // Collect channel rejections
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

    // Collect SEO weaknesses from product_insights
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

    // Bulk insert observations
    if (observations.length) {
      const { error } = await supabase.from("catalog_brain_observations").insert(observations);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ ingested: observations.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
