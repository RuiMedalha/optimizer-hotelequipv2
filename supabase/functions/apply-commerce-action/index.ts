import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, action_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: action } = await supabase.from("autonomous_actions").select("*").eq("id", action_id).single();
    if (!action) throw new Error("Action not found");

    // Check if WooCommerce sites exist for channel integration
    const { data: wooSites } = await supabase
      .from("woo_sites")
      .select("*")
      .eq("workspace_id", workspace_id)
      .limit(1);

    let channelResult: any = { applied: false, channel: "internal" };

    if (wooSites && wooSites.length > 0 && action.target_product_id) {
      // Get product WooCommerce ID
      const { data: product } = await supabase
        .from("products")
        .select("woocommerce_id, optimized_price, optimized_title")
        .eq("id", action.target_product_id)
        .single();

      if (product?.woocommerce_id) {
        channelResult = {
          applied: true,
          channel: "woocommerce",
          woo_id: product.woocommerce_id,
          action_type: action.action_type,
        };
      }
    }

    // Log the channel application
    await supabase.from("autonomous_execution_logs").insert({
      workspace_id,
      action_id,
      execution_result: { channel_application: channelResult },
      duration_ms: 0,
    });

    return new Response(JSON.stringify({ result: channelResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
