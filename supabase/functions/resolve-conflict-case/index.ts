import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { conflict_case_id, resolution_source, resolution_action, after_state } = await req.json();
    if (!conflict_case_id) throw new Error("conflict_case_id required");

    const { data: conflict } = await supabase
      .from("conflict_cases")
      .select("*")
      .eq("id", conflict_case_id)
      .single();

    if (!conflict) throw new Error("Conflict case not found");

    await supabase.from("conflict_cases").update({
      status: resolution_source === "human" ? "human_resolved" : "auto_resolved",
      resolved_at: new Date().toISOString(),
    }).eq("id", conflict_case_id);

    await supabase.from("resolution_history").insert({
      conflict_case_id,
      resolution_source: resolution_source || "system",
      resolution_action: resolution_action || "Manually resolved",
      before_state: { status: conflict.status, severity: conflict.severity },
      after_state: after_state || {},
    });

    return new Response(JSON.stringify({ resolved: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
