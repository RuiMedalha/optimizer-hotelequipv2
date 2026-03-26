import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, channel_id, canonical_product_id, channel_product_id, snapshot_type, snapshot_payload } = await req.json();
    if (!workspace_id || !channel_id || !canonical_product_id) throw new Error("workspace_id, channel_id, canonical_product_id required");

    const { data, error } = await supabase.from("channel_sync_snapshots").insert({
      workspace_id,
      channel_id,
      canonical_product_id,
      channel_product_id,
      snapshot_type: snapshot_type || "pre_publish",
      snapshot_payload: snapshot_payload || {},
    }).select().single();

    if (error) throw error;

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
