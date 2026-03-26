import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, workflow_id, supplier_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get workflow config
    const { data: wf } = await supabase.from("catalog_workflows").select("*").eq("id", workflow_id).single();
    if (!wf) throw new Error("Workflow not found");

    // Create run
    const { data: run, error: runErr } = await supabase.from("catalog_workflow_runs").insert({
      workspace_id, workflow_id, supplier_id: supplier_id || null,
      trigger_source: "manual", status: "running", started_at: new Date().toISOString(),
    }).select().single();
    if (runErr) throw runErr;

    // Create default steps based on workflow type
    const stepTemplates: Record<string, Array<{ name: string; type: string }>> = {
      supplier_import: [
        { name: "Intake", type: "intake" }, { name: "Classification", type: "classification" },
        { name: "Matching", type: "matching" }, { name: "Grouping", type: "grouping" },
        { name: "Canonical Assembly", type: "canonical_assembly" }, { name: "Validation", type: "validation" },
        { name: "Review", type: "review" },
      ],
      full_catalog_cycle: [
        { name: "Intake", type: "intake" }, { name: "Classification", type: "classification" },
        { name: "Matching", type: "matching" }, { name: "Grouping", type: "grouping" },
        { name: "Canonical Assembly", type: "canonical_assembly" }, { name: "Validation", type: "validation" },
        { name: "Review", type: "review" }, { name: "Asset Processing", type: "asset_processing" },
        { name: "Payload Build", type: "payload_build" }, { name: "Publish", type: "publish" },
        { name: "Sync", type: "sync" }, { name: "Monitoring", type: "monitoring" },
      ],
      catalog_refresh: [
        { name: "Intake", type: "intake" }, { name: "Matching", type: "matching" },
        { name: "Validation", type: "validation" }, { name: "Payload Build", type: "payload_build" },
        { name: "Publish", type: "publish" },
      ],
      price_update: [
        { name: "Intake", type: "intake" }, { name: "Validation", type: "validation" },
        { name: "Payload Build", type: "payload_build" }, { name: "Publish", type: "publish" },
      ],
      channel_republish: [
        { name: "Payload Build", type: "payload_build" }, { name: "Publish", type: "publish" },
        { name: "Sync", type: "sync" },
      ],
      marketplace_export: [
        { name: "Validation", type: "validation" }, { name: "Asset Processing", type: "asset_processing" },
        { name: "Payload Build", type: "payload_build" }, { name: "Publish", type: "publish" },
      ],
    };

    const steps = (stepTemplates[wf.workflow_type] || stepTemplates.full_catalog_cycle).map((s, i) => ({
      workflow_run_id: run.id, step_order: i + 1, step_name: s.name, step_type: s.type, status: "queued",
    }));

    await supabase.from("catalog_workflow_steps").insert(steps);

    return new Response(JSON.stringify({ run_id: run.id, steps_created: steps.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
