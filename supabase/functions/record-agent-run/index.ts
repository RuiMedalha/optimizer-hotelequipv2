import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { workspace_id, agent_id, agent_name, run_id, agent_version, prompt_version_id,
      status, input_payload, output_payload, confidence_score, cost_estimate, latency_ms,
      fallback_used, fallback_reason, steps } = body;

    if (!workspace_id || !agent_name) throw new Error("workspace_id and agent_name required");

    const { data: run, error } = await supabase.from("agent_runs").insert({
      workspace_id, run_id: run_id || null, agent_id: agent_id || null,
      agent_name, agent_version: agent_version || null,
      prompt_version_id: prompt_version_id || null,
      status: status || "completed",
      input_payload: input_payload || {}, output_payload: output_payload || {},
      confidence_score, cost_estimate, latency_ms,
      fallback_used: fallback_used || false, fallback_reason: fallback_reason || null,
      completed_at: status === "completed" || status === "fallback_completed" ? new Date().toISOString() : null,
    }).select().single();
    if (error) throw error;

    if (steps?.length) {
      for (const s of steps) {
        await supabase.from("agent_run_steps").insert({
          agent_run_id: run.id, step_name: s.step_name, step_order: s.step_order || 0,
          status: s.status || "completed", input_payload: s.input_payload || {},
          output_payload: s.output_payload || {}, error_payload: s.error_payload || null,
          latency_ms: s.latency_ms, cost_estimate: s.cost_estimate,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, agent_run: run }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
