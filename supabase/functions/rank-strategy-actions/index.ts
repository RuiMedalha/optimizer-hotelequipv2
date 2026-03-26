import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, plan_id } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: actions } = await supabase
      .from("strategy_actions")
      .select("*")
      .eq("plan_id", plan_id)
      .eq("workspace_id", workspace_id);

    if (!actions) throw new Error("No actions found");

    // Score: revenue * 0.5 + conversion * 0.3 + margin * 0.2
    const ranked = actions.map(a => ({
      id: a.id,
      score: (a.expected_revenue || 0) * 0.5 + (a.expected_conversion || 0) * 100 * 0.3 + (a.expected_margin || 0) * 0.2,
    })).sort((a, b) => b.score - a.score);

    for (let i = 0; i < ranked.length; i++) {
      await supabase.from("strategy_actions").update({ priority_score: ranked[i].score }).eq("id", ranked[i].id);
    }

    return new Response(JSON.stringify({ ranked_count: ranked.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
