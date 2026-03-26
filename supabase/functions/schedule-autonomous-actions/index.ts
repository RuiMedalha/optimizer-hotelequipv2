import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get approved actions ready to schedule
    const { data: actions } = await supabase
      .from("autonomous_actions")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("status", "approved")
      .order("expected_revenue", { ascending: false });

    let scheduled = 0;
    for (const action of (actions || [])) {
      const scheduleAt = action.scheduled_at || new Date(Date.now() + 60000).toISOString();
      await supabase.from("autonomous_actions").update({
        status: "scheduled",
        scheduled_at: scheduleAt,
      }).eq("id", action.id);
      scheduled++;
    }

    // Auto-execute fully_autonomous pending actions
    const { data: autoActions } = await supabase
      .from("autonomous_actions")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("execution_mode", "fully_autonomous")
      .eq("status", "pending")
      .order("expected_revenue", { ascending: false })
      .limit(10);

    let autoExecuted = 0;
    for (const action of (autoActions || [])) {
      await supabase.from("autonomous_actions").update({ status: "approved" }).eq("id", action.id);
      autoExecuted++;
    }

    return new Response(JSON.stringify({ scheduled, auto_approved: autoExecuted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
