import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get all active workspaces with products
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id, name");

    if (!workspaces?.length) {
      return new Response(JSON.stringify({ message: "No workspaces found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const ws of workspaces) {
      // Check if workspace has products
      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id);

      if (!count || count === 0) continue;

      // Check last pipeline run - skip if ran within last 6 days
      const { data: lastRun } = await supabase
        .from("agent_runs")
        .select("created_at")
        .eq("workspace_id", ws.id)
        .eq("agent_name", "intelligence_pipeline")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastRun) {
        const daysSince = (Date.now() - new Date(lastRun.created_at!).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 6) {
          results.push({ workspace: ws.name, skipped: true, reason: `Last run ${daysSince.toFixed(1)} days ago` });
          continue;
        }
      }

      try {
        // Run the intelligence pipeline
        const pipelineRes = await supabase.functions.invoke("run-intelligence-pipeline", {
          body: { workspace_id: ws.id },
        });

        // Send Telegram alert if configured
        try {
          await supabase.functions.invoke("send-intelligence-alert", {
            body: { workspace_id: ws.id },
          });
        } catch (alertErr: any) {
          console.log(`[Scheduler] Telegram alert skipped for ${ws.name}: ${alertErr.message}`);
        }

        results.push({ workspace: ws.name, success: true, data: pipelineRes.data });
      } catch (err: any) {
        results.push({ workspace: ws.name, success: false, error: (err as Error).message });
      }
    }

    return new Response(JSON.stringify({ scheduled_at: new Date().toISOString(), results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
