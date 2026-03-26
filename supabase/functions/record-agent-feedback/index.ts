import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { agent_run_id, feedback_type, feedback_score, feedback_payload, provided_by } = await req.json();
    if (!agent_run_id || !feedback_type) throw new Error("agent_run_id and feedback_type required");

    const { data, error } = await supabase.from("agent_run_feedback").insert({
      agent_run_id, feedback_type, feedback_score: feedback_score || null,
      feedback_payload: feedback_payload || {}, provided_by: provided_by || null,
    }).select().single();
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, feedback: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
