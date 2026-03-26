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

    const { workspace_id, supplier_name, supplier_code, base_url, search_url_template, website_language, default_currency, country_code } = await req.json();

    if (!workspace_id || !supplier_name) {
      return new Response(JSON.stringify({ error: "workspace_id and supplier_name required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check if supplier already exists
    const { data: existing } = await supabase
      .from("supplier_profiles")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("supplier_name", supplier_name)
      .maybeSingle();

    let supplier;
    if (existing) {
      const { data, error } = await supabase
        .from("supplier_profiles")
        .update({ base_url, search_url_template, website_language, default_currency, country_code, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      supplier = data;
    } else {
      const { data, error } = await supabase
        .from("supplier_profiles")
        .insert({ workspace_id, supplier_name, supplier_code, base_url, search_url_template, website_language: website_language || "pt", default_currency: default_currency || "EUR", country_code: country_code || "PT" })
        .select()
        .single();
      if (error) throw error;
      supplier = data;

      // Seed default matching rules
      const defaultMatching = [
        { supplier_id: supplier.id, rule_name: "SKU Exact", match_type: "sku_exact", rule_weight: 1.0 },
        { supplier_id: supplier.id, rule_name: "Supplier Ref", match_type: "supplier_ref", rule_weight: 0.9 },
        { supplier_id: supplier.id, rule_name: "Title Similarity", match_type: "title_similarity", rule_weight: 0.6 },
      ];
      await supabase.from("supplier_matching_rules").insert(defaultMatching);

      // Seed default grouping rules
      const defaultGrouping = [
        { supplier_id: supplier.id, grouping_type: "variation", discriminator_fields: ["cor", "tamanho", "capacidade"], confidence_threshold: 0.7 },
        { supplier_id: supplier.id, grouping_type: "accessory", discriminator_fields: [], confidence_threshold: 0.8 },
        { supplier_id: supplier.id, grouping_type: "pack", discriminator_fields: [], confidence_threshold: 0.85 },
      ];
      await supabase.from("supplier_grouping_rules").insert(defaultGrouping);

      // Seed taxonomy profile
      await supabase.from("supplier_taxonomy_profiles").insert({ supplier_id: supplier.id, taxonomy_mode: "hybrid" });
    }

    return new Response(JSON.stringify({ supplier }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
