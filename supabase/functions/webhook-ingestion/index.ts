import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { workspaceId, sourceId, data } = body;

    if (!workspaceId || !data || !Array.isArray(data)) {
      return new Response(JSON.stringify({ success: false, error: "workspaceId and data[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Authentication: require either valid user JWT (workspace member) OR webhook secret ----
    const authHeader = req.headers.get("Authorization");
    const webhookSecret = req.headers.get("x-webhook-secret");
    let authorized = false;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: claims } = await userClient.auth.getClaims(token);
      if (claims?.claims?.sub) {
        const { data: member } = await adminClient
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", workspaceId)
          .eq("user_id", claims.claims.sub)
          .eq("status", "active")
          .maybeSingle();
        if (member) authorized = true;
      }
    }

    // Source-level webhook secret (for external systems calling this endpoint)
    if (!authorized && sourceId && webhookSecret) {
      const { data: source } = await adminClient
        .from("ingestion_sources")
        .select("workspace_id, webhook_secret")
        .eq("id", sourceId)
        .maybeSingle();
      if (
        source &&
        source.workspace_id === workspaceId &&
        source.webhook_secret &&
        source.webhook_secret === webhookSecret
      ) {
        authorized = true;
      }
    }

    if (!authorized) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load source config if sourceId provided
    let fieldMappings = {};
    let mergeStrategy = "merge";
    let dupFields = ["sku"];
    let groupingConfig = {};

    if (sourceId) {
      const { data: source } = await adminClient
        .from("ingestion_sources")
        .select("*")
        .eq("id", sourceId)
        .eq("workspace_id", workspaceId)
        .single();

      if (source) {
        fieldMappings = source.field_mappings || {};
        mergeStrategy = source.merge_strategy || "merge";
        dupFields = source.duplicate_detection_fields || ["sku"];
        groupingConfig = source.grouping_config || {};

        await adminClient.from("ingestion_sources").update({ last_run_at: new Date().toISOString() }).eq("id", sourceId);
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
    console.error("webhook-ingestion error:", e);
    return new Response(JSON.stringify({ success: false, error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
