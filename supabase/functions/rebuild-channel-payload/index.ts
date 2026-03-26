import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, channel_id, canonical_product_id } = await req.json();
    if (!workspace_id || !channel_id || !canonical_product_id) throw new Error("workspace_id, channel_id, canonical_product_id required");

    // Delete old payload fields/assets/logs first
    const { data: existing } = await supabase
      .from("channel_payloads")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("channel_id", channel_id)
      .eq("canonical_product_id", canonical_product_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      const oldId = existing[0].id;
      await supabase.from("channel_payload_fields").delete().eq("channel_payload_id", oldId);
      await supabase.from("channel_payload_assets").delete().eq("channel_payload_id", oldId);
      await supabase.from("channel_payload_logs").delete().eq("channel_payload_id", oldId);
      await supabase.from("channel_payloads").delete().eq("id", oldId);
    }

    // Call build-channel-payload
    const { data, error } = await supabase.functions.invoke("build-channel-payload", {
      body: { workspace_id, channel_id, canonical_product_id },
    });

    if (error) throw error;

    return new Response(JSON.stringify({ rebuilt: true, payload: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
