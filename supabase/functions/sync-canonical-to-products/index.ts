import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { canonical_product_id, product_id } = await req.json();

    if (!canonical_product_id) {
      return new Response(JSON.stringify({ error: "canonical_product_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch canonical fields
    const { data: fields } = await supabase.from("canonical_product_fields").select("field_name, normalized_value, field_value").eq("canonical_product_id", canonical_product_id);

    const fieldMap: Record<string, any> = {};
    for (const f of fields || []) {
      const val = f.normalized_value?.v ?? f.field_value?.v ?? null;
      if (val != null) fieldMap[f.field_name] = val;
    }

    // Map canonical fields to products columns
    const productUpdate: Record<string, any> = { canonical_product_id, updated_at: new Date().toISOString() };
    if (fieldMap.title) productUpdate.optimized_title = fieldMap.title;
    if (fieldMap.description) productUpdate.optimized_description = fieldMap.description;
    if (fieldMap.short_description) productUpdate.optimized_short_description = fieldMap.short_description;
    if (fieldMap.meta_title) productUpdate.meta_title = fieldMap.meta_title;
    if (fieldMap.meta_description) productUpdate.meta_description = fieldMap.meta_description;
    if (fieldMap.seo_slug) productUpdate.seo_slug = fieldMap.seo_slug;
    if (fieldMap.original_price) productUpdate.optimized_price = fieldMap.original_price;
    if (fieldMap.sale_price) productUpdate.optimized_sale_price = fieldMap.sale_price;
    if (fieldMap.category) productUpdate.suggested_category = fieldMap.category;
    if (fieldMap.product_type) productUpdate.product_type = fieldMap.product_type;

    let targetId = product_id;
    if (!targetId) {
      // Find linked product
      const { data: linked } = await supabase.from("products").select("id").eq("canonical_product_id", canonical_product_id).limit(1).maybeSingle();
      targetId = linked?.id;
    }

    if (targetId) {
      const { error } = await supabase.from("products").update(productUpdate).eq("id", targetId);
      if (error) throw error;
    }

    await supabase.from("canonical_assembly_logs").insert({
      canonical_product_id,
      assembly_step: "sync_to_products",
      status: "completed",
      output_summary: { product_id: targetId, fields_synced: Object.keys(productUpdate).length },
    });

    return new Response(JSON.stringify({ synced: true, product_id: targetId, fields: Object.keys(productUpdate).length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
