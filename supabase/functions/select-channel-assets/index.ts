import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { channel_payload_id, canonical_product_id, channel_id } = await req.json();
    if (!channel_payload_id || !canonical_product_id) throw new Error("channel_payload_id and canonical_product_id required");

    // Get canonical product assets
    const { data: canonicalAssets } = await supabase
      .from("canonical_product_assets")
      .select("*")
      .eq("canonical_product_id", canonical_product_id)
      .order("sort_order", { ascending: true });

    // Get channel asset rules
    const { data: assetRules } = await supabase
      .from("channel_asset_rules")
      .select("*")
      .eq("channel_id", channel_id);

    const maxImages = (assetRules || [])[0]?.max_images || 10;
    const selected = (canonicalAssets || []).slice(0, maxImages);

    // Insert payload assets
    for (let i = 0; i < selected.length; i++) {
      await supabase.from("channel_payload_assets").insert({
        channel_payload_id,
        asset_id: selected[i].asset_id,
        usage_context: selected[i].usage_context || "gallery",
        sort_order: i,
        channel_asset_status: "selected",
      });
    }

    return new Response(JSON.stringify({ selected_count: selected.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
