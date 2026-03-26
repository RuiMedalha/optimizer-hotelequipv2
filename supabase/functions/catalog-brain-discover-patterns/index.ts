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

    const patterns: any[] = [];

    // Discover supplier patterns from extraction memory
    const { data: extractions } = await supabase
      .from("extraction_case_signatures").select("*")
      .eq("workspace_id", workspaceId).limit(100);
    
    const supplierFields: Record<string, Record<string, number>> = {};
    for (const e of (extractions || [])) {
      const output = e.resolved_output || {};
      for (const [field, value] of Object.entries(output)) {
        if (!supplierFields[field]) supplierFields[field] = {};
        const valStr = String(value).substring(0, 50);
        supplierFields[field][valStr] = (supplierFields[field][valStr] || 0) + 1;
      }
    }
    for (const [field, values] of Object.entries(supplierFields)) {
      const topValues = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (topValues[0] && topValues[0][1] >= 3) {
        patterns.push({
          workspace_id: workspaceId,
          decision_type: "supplier_pattern",
          context_features: { field, top_values: topValues.map(([v, c]) => ({ value: v, count: c })) },
          action_taken: "auto_map_field",
          reward: topValues[0][1],
          confidence: Math.min(95, 50 + topValues[0][1] * 5),
        });
      }
    }

    // Discover successful decision patterns from reinforcement memory
    const { data: memories } = await supabase
      .from("catalog_reinforcement_memory").select("*")
      .eq("workspace_id", workspaceId).order("reward", { ascending: false }).limit(50);

    const decisionTypeSuccess: Record<string, { rewards: number[]; count: number }> = {};
    for (const m of (memories || [])) {
      if (!decisionTypeSuccess[m.decision_type]) decisionTypeSuccess[m.decision_type] = { rewards: [], count: 0 };
      decisionTypeSuccess[m.decision_type].rewards.push(Number(m.reward));
      decisionTypeSuccess[m.decision_type].count++;
    }

    for (const [type, data] of Object.entries(decisionTypeSuccess)) {
      if (data.count >= 3) {
        const avgReward = data.rewards.reduce((a, b) => a + b, 0) / data.count;
        if (avgReward > 0) {
          // Store as learning signal
          await supabase.from("catalog_learning_signals").insert({
            workspace_id: workspaceId,
            signal_type: "performance_improvement",
            feedback_type: "system_observation",
            signal_strength: avgReward,
            metadata: { decision_type: type, avg_reward: avgReward, sample_size: data.count },
            source: "pattern_discovery",
          });
        }
      }
    }

    // Store patterns
    if (patterns.length) {
      await supabase.from("catalog_reinforcement_memory").insert(patterns);
    }

    return new Response(JSON.stringify({ patterns_found: patterns.length, decision_types_analyzed: Object.keys(decisionTypeSuccess).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
