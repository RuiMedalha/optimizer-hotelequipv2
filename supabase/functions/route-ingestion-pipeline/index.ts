import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PIPELINES: Record<string, string[]> = {
  pdf_catalog: ["extract_pdf", "map_products", "validate", "enrich", "review"],
  excel_pricing: ["parse_file", "map_columns", "detect_duplicates", "merge", "validate"],
  xml_feed: ["parse_xml", "map_fields", "detect_duplicates", "merge", "validate"],
  woocommerce_export: ["import_woo", "reconcile", "validate", "sync_back"],
  supplier_scrape: ["scrape", "normalize", "map_products", "validate", "enrich"],
  default: ["parse", "validate", "enrich", "review"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { runId, workspaceId, runType, payload } = await req.json();
    if (!runId) throw new Error("runId required");

    // Determine pipeline based on payload hints
    let pipelineKey = "default";
    const fileType = (payload?.fileType || payload?.sourceType || "").toLowerCase();
    if (fileType.includes("pdf")) pipelineKey = "pdf_catalog";
    else if (fileType.includes("xls") || fileType.includes("csv")) pipelineKey = "excel_pricing";
    else if (fileType.includes("xml")) pipelineKey = "xml_feed";
    else if (fileType.includes("woo")) pipelineKey = "woocommerce_export";
    else if (fileType.includes("scrape")) pipelineKey = "supplier_scrape";

    const steps = PIPELINES[pipelineKey] || PIPELINES.default;

    // Create steps
    const stepRows = steps.map((s, i) => ({
      run_id: runId,
      step_type: s,
      step_order: i + 1,
      status: "pending" as const,
    }));

    const { error: stepsErr } = await supabase.from("orchestration_steps").insert(stepRows);
    if (stepsErr) throw stepsErr;

    // Log decision
    await supabase.from("execution_decisions").insert({
      run_id: runId,
      decision_type: "route_pipeline",
      decision_reason: `Selected pipeline: ${pipelineKey} with ${steps.length} steps`,
      confidence: 0.9,
    });

    // Update run to running
    await supabase.from("orchestration_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", runId);

    return new Response(JSON.stringify({ success: true, pipeline: pipelineKey, steps }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
