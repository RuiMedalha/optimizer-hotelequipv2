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

    const { workspaceId, triggerSource, payload } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    // Classify run type based on trigger source
    let runType: "supplier_import" | "catalog_update" | "channel_sync" = "catalog_update";
    const src = (triggerSource || "").toLowerCase();
    if (src.includes("supplier") || src.includes("scrape") || src.includes("pdf") || src.includes("upload")) {
      runType = "supplier_import";
    } else if (src.includes("channel") || src.includes("woo") || src.includes("publish")) {
      runType = "channel_sync";
    }

    // Create run
    const { data: run, error: runErr } = await supabase
      .from("orchestration_runs")
      .insert({
        workspace_id: workspaceId,
        run_type: runType,
        status: "pending",
        trigger_source: triggerSource || "manual",
        payload: payload || {},
      })
      .select()
      .single();

    if (runErr) throw runErr;

    // Log decision
    await supabase.from("execution_decisions").insert({
      run_id: run.id,
      decision_type: "classify_run",
      decision_reason: `Classified as ${runType} from trigger: ${triggerSource}`,
      confidence: 0.85,
    });

    // Route to pipeline
    const pipelineUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/route-ingestion-pipeline`;
    await fetch(pipelineUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ runId: run.id, workspaceId, runType, payload }),
    });

    return new Response(JSON.stringify({ success: true, runId: run.id, runType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
