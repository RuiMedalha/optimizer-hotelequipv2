import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_WEIGHTS: Record<string, { dimension: string; weight: number }[]> = {
  default: [
    { dimension: "revenue", weight: 0.35 },
    { dimension: "conversion", weight: 0.25 },
    { dimension: "seo_visibility", weight: 0.15 },
    { dimension: "channel_compliance", weight: 0.15 },
    { dimension: "catalog_quality", weight: 0.05 },
    { dimension: "automation_efficiency", weight: 0.05 },
  ],
};

const SIGNAL_DIMENSION_MAP: Record<string, string[]> = {
  quality_issue: ["catalog_quality", "channel_compliance"],
  seo_opportunity: ["seo_visibility", "conversion"],
  channel_rejection: ["channel_compliance", "revenue"],
  missing_translation: ["channel_compliance", "conversion"],
  image_quality_problem: ["conversion", "catalog_quality"],
  bundle_opportunity: ["revenue", "conversion"],
  upsell_opportunity: ["revenue"],
  supplier_pattern: ["automation_efficiency", "catalog_quality"],
  pricing_opportunity: ["revenue", "conversion"],
  data_inconsistency: ["catalog_quality", "channel_compliance"],
  feed_error: ["channel_compliance"],
  schema_mismatch: ["catalog_quality", "channel_compliance"],
  duplicate_product: ["catalog_quality", "automation_efficiency"],
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get workspace impact models or use defaults
    const { data: models } = await supabase
      .from("impact_models").select("*").eq("workspace_id", workspaceId);
    const weights = (models && models.length > 0)
      ? models.map((m: any) => ({ dimension: m.dimension, weight: Number(m.weight) }))
      : DEFAULT_WEIGHTS.default;

    // Get unprocessed signals (last 24h without evaluations)
    const { data: signals } = await supabase
      .from("catalog_decision_signals").select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(100);

    const evaluations: any[] = [];
    for (const signal of (signals || [])) {
      const dimensions = SIGNAL_DIMENSION_MAP[signal.signal_type] || ["catalog_quality"];
      for (const dim of dimensions) {
        const w = weights.find((wt: any) => wt.dimension === dim);
        const weight = w ? Number(w.weight) : 0.1;
        const impactScore = (signal.severity * weight * signal.confidence) / 100;
        evaluations.push({
          workspace_id: workspaceId, entity_type: signal.entity_type, entity_id: signal.entity_id,
          signal_id: signal.id, impact_dimension: dim, impact_score: Math.round(impactScore * 100) / 100,
          confidence: signal.confidence, metadata: { signal_type: signal.signal_type, weight },
        });
      }
    }

    if (evaluations.length) {
      const { error } = await supabase.from("catalog_impact_evaluations").insert(evaluations);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ evaluated: evaluations.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
