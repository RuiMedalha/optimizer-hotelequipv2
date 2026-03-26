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

    // Aggregate evaluations by entity
    const { data: evals } = await supabase
      .from("catalog_impact_evaluations").select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(200);

    // Group by entity_id
    const entityMap: Record<string, any[]> = {};
    for (const ev of (evals || [])) {
      const key = `${ev.entity_type}:${ev.entity_id}`;
      if (!entityMap[key]) entityMap[key] = [];
      entityMap[key].push(ev);
    }

    const decisions: any[] = [];
    const explanations: any[] = [];

    for (const [key, evGroup] of Object.entries(entityMap)) {
      const [entityType, entityId] = key.split(":");
      const totalImpact = evGroup.reduce((s: number, e: any) => s + Number(e.impact_score), 0);
      const avgConfidence = Math.round(evGroup.reduce((s: number, e: any) => s + e.confidence, 0) / evGroup.length);

      // Calculate priority score with frequency bonus
      const frequencyBonus = Math.min(evGroup.length * 5, 30);
      const priorityScore = Math.round((totalImpact + frequencyBonus) * 100) / 100;

      const priorityLevel = priorityScore >= 50 ? "critical" : priorityScore >= 30 ? "high" : priorityScore >= 15 ? "medium" : "low";

      // Determine decision type from dominant signal
      const signalTypes = evGroup.map((e: any) => e.metadata?.signal_type).filter(Boolean);
      const dominantType = signalTypes.sort((a: string, b: string) =>
        signalTypes.filter((v: string) => v === b).length - signalTypes.filter((v: string) => v === a).length
      )[0] || "optimize";

      const decisionTypeMap: Record<string, string> = {
        quality_issue: "fix_quality", seo_opportunity: "optimize_seo",
        channel_rejection: "fix_channel_compliance", bundle_opportunity: "create_bundle",
        data_inconsistency: "fix_data", pricing_opportunity: "optimize_pricing",
        feed_error: "fix_feed", schema_mismatch: "fix_schema",
      };

      const decision = {
        workspace_id: workspaceId, entity_type: entityType, entity_id: entityId,
        decision_type: decisionTypeMap[dominantType] || "optimize",
        priority_score: priorityScore, impact_score: totalImpact,
        confidence: avgConfidence, priority_level: priorityLevel, status: "pending",
        decision_context: {
          signal_count: evGroup.length,
          signal_types: [...new Set(signalTypes)],
          dimensions: [...new Set(evGroup.map((e: any) => e.impact_dimension))],
        },
      };

      decisions.push(decision);
    }

    if (decisions.length) {
      const { data: inserted, error } = await supabase.from("catalog_decisions").insert(decisions).select("id");
      if (error) throw error;

      // Generate explanations
      for (let i = 0; i < (inserted || []).length; i++) {
        const d = decisions[i];
        explanations.push({
          decision_id: inserted![i].id,
          explanation: {
            signals_used: d.decision_context.signal_types,
            impact_dimensions: d.decision_context.dimensions,
            total_impact: d.impact_score,
            frequency: d.decision_context.signal_count,
            reasoning: `Detected ${d.decision_context.signal_count} signal(s) of types [${d.decision_context.signal_types.join(", ")}] affecting ${d.decision_context.dimensions.join(", ")}. Total impact: ${d.impact_score}. Recommended action: ${d.decision_type}.`,
          },
          confidence: d.confidence,
        });
      }

      if (explanations.length) {
        await supabase.from("decision_explanations").insert(explanations);
      }
    }

    return new Response(JSON.stringify({ decisions: decisions.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
