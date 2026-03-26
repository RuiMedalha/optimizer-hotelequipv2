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

    const body = await req.json();
    const { workspaceId, sourceId, data } = body;

    if (!workspaceId || !data || !Array.isArray(data)) {
      throw new Error("workspaceId and data[] required");
    }

    // Load source config if sourceId provided
    let fieldMappings = {};
    let mergeStrategy = "merge";
    let dupFields = ["sku"];
    let groupingConfig = {};

    if (sourceId) {
      const { data: source } = await supabase
        .from("ingestion_sources")
        .select("*")
        .eq("id", sourceId)
        .single();

      if (source) {
        fieldMappings = source.field_mappings || {};
        mergeStrategy = source.merge_strategy || "merge";
        dupFields = source.duplicate_detection_fields || ["sku"];
        groupingConfig = source.grouping_config || {};

        // Update last_run_at
        await supabase.from("ingestion_sources").update({ last_run_at: new Date().toISOString() }).eq("id", sourceId);
      }
    }

    // Forward to parse-ingestion internally
    const parseUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/parse-ingestion`;
    const resp = await fetch(parseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        workspaceId,
        sourceId,
        data,
        sourceType: "webhook",
        fieldMappings,
        mergeStrategy,
        duplicateDetectionFields: dupFields,
        groupingConfig,
        mode: "live",
      }),
    });

    const result = await resp.json();

    if (!result.success) throw new Error(result.error);

    // If live mode, execute the job
    if (result.jobId) {
      const runUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/run-ingestion-job`;
      const runResp = await fetch(runUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ jobId: result.jobId }),
      });
      const runResult = await runResp.json();
      return new Response(JSON.stringify({ success: true, ...runResult }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
