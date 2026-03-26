import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, supplier_id, wizard_data } = await req.json();
    if (!workspace_id || !supplier_id) throw new Error("workspace_id and supplier_id required");

    const config = {
      base_url: wizard_data?.base_url || null,
      search_method: wizard_data?.search_method || "manual",
      file_types: wizard_data?.file_types || [],
      price_source: wizard_data?.price_source || "excel",
      spec_source: wizard_data?.spec_source || "pdf",
      uses_variations: wizard_data?.uses_variations || false,
      uses_packs: wizard_data?.uses_packs || false,
      family_naming: wizard_data?.family_naming || null,
    };

    // Create connector setup
    const { data: setup, error: e1 } = await supabase.from("supplier_connector_setups").insert({
      workspace_id, supplier_id, setup_status: "configuring", setup_config: config,
    }).select().single();
    if (e1) throw e1;

    // Create default lookup strategy
    const { error: e2 } = await supabase.from("supplier_lookup_strategies").insert({
      supplier_id,
      strategy_name: "Default Lookup",
      lookup_order: ["sku", "supplier_ref", "ean", "title"],
      search_url_template: wizard_data?.base_url ? `${wizard_data.base_url}/search?q={query}` : null,
    });
    if (e2) throw e2;

    return new Response(JSON.stringify({ success: true, setup }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
