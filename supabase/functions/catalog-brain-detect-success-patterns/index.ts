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

    // Get positive performance history
    const { data: history } = await supabase
      .from("decision_performance_history").select("*")
      .eq("workspace_id", workspaceId).eq("learning_outcome", "positive")
      .order("actual_impact", { ascending: false }).limit(50);

    const successPatterns: Record<string, { count: number; avgImpact: number; impacts: number[] }> = {};

    for (const h of (history || [])) {
      const type = h.metadata?.decision_type || "unknown";
      if (!successPatterns[type]) successPatterns[type] = { count: 0, avgImpact: 0, impacts: [] };
      successPatterns[type].count++;
      successPatterns[type].impacts.push(Number(h.actual_impact));
    }

    const patterns = [];
    for (const [type, data] of Object.entries(successPatterns)) {
      if (data.count >= 2) {
        data.avgImpact = data.impacts.reduce((a, b) => a + b, 0) / data.count;
        patterns.push({
          decision_type: type,
          count: data.count,
          avg_impact: Math.round(data.avgImpact * 100) / 100,
          reliability: Math.min(95, 50 + data.count * 10),
        });
      }
    }

    // Store patterns as learning signals
    for (const p of patterns) {
      await supabase.from("catalog_learning_signals").insert({
        workspace_id: workspaceId,
        signal_type: "performance_improvement",
        feedback_type: "system_observation",
        signal_strength: p.avg_impact,
        metadata: p,
        source: "success_pattern_detection",
      });
    }

    return new Response(JSON.stringify({ patterns }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
