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

    const { workspace_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    const [
      { count: totalProducts },
      { count: approvedProducts },
      { count: draftProducts },
      { count: activeIngestions },
      { count: publishedPayloads },
      { count: totalAlerts },
    ] = await Promise.all([
      supabase.from("products").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id),
      supabase.from("products").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("status", "approved"),
      supabase.from("products").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("status", "draft"),
      supabase.from("ingestion_jobs").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).in("status", ["running", "pending"]),
      supabase.from("channel_payloads").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("payload_status", "published"),
      supabase.from("control_tower_alerts").select("*", { count: "exact", head: true }).eq("workspace_id", workspace_id).eq("status", "open"),
    ]);

    const summary = {
      total_products: totalProducts || 0,
      approved_products: approvedProducts || 0,
      draft_products: draftProducts || 0,
      active_ingestions: activeIngestions || 0,
      published_payloads: publishedPayloads || 0,
      open_alerts: totalAlerts || 0,
      health_score: Math.round(
        ((approvedProducts || 0) / Math.max(totalProducts || 1, 1)) * 100
      ),
    };

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
