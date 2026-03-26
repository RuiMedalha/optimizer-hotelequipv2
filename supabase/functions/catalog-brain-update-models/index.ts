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

    // Update all learning models
    const modelTypes = [
      "impact_weight_adjustment",
      "decision_pattern_learning",
      "supplier_pattern_learning",
      "channel_behavior_learning",
    ];

    for (const modelType of modelTypes) {
      // Get relevant reinforcement data
      const { data: memories } = await supabase
        .from("catalog_reinforcement_memory").select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);

      const relevant = (memories || []).filter((m: any) => {
        if (modelType === "decision_pattern_learning") return true;
        if (modelType === "supplier_pattern_learning") return m.decision_type === "supplier_pattern";
        if (modelType === "channel_behavior_learning") return m.decision_type?.includes("channel") || m.decision_type?.includes("feed");
        return true;
      });

      if (relevant.length < 3) continue;

      const avgReward = relevant.reduce((s: number, m: any) => s + Number(m.reward), 0) / relevant.length;
      const avgConfidence = Math.round(relevant.reduce((s: number, m: any) => s + (m.confidence || 50), 0) / relevant.length);

      await supabase.from("catalog_learning_models").upsert({
        workspace_id: workspaceId,
        model_type: modelType,
        model_parameters: {
          avg_reward: avgReward,
          sample_size: relevant.length,
          avg_confidence: avgConfidence,
          top_actions: [...new Set(relevant.map((m: any) => m.action_taken))].slice(0, 5),
        },
        last_trained_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,model_type" });
    }

    return new Response(JSON.stringify({ models_updated: modelTypes.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
