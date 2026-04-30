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

    const { id, action, data: approvedData } = await req.json();
    if (!id || !action) throw new Error("ID and action required");

    // Get staging record
    const { data: staging, error: stagingErr } = await supabase
      .from("sync_staging")
      .select("*")
      .eq("id", id)
      .single();

    if (stagingErr || !staging) throw new Error("Staging record not found");

    if (action === 'reject') {
      await supabase
        .from("sync_staging")
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq("id", id);
      
      return new Response(JSON.stringify({ success: true, action: 'rejected' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === 'approve') {
      const rawData = approvedData || staging.proposed_changes || staging.supplier_data || {};

      // Get valid column names from DB to filter out any "proposed_changes" that don't exist
      const productColumns = [
        'sku', 'original_title', 'optimized_title', 'original_description', 'optimized_description',
        'original_price', 'optimized_price', 'category', 'tags', 'meta_title', 'meta_description',
        'seo_slug', 'status', 'woocommerce_id', 'supplier_ref', 'source_file', 'short_description',
        'optimized_short_description', 'technical_specs', 'image_urls', 'faq', 'upsell_skus',
        'crosssell_skus', 'workspace_id', 'product_type', 'parent_product_id', 'attributes',
        'image_alt_texts', 'focus_keyword', 'seo_score', 'category_id', 'sale_price',
        'optimized_sale_price', 'suggested_category', 'workflow_state', 'quality_score',
        'locked_for_publish', 'validation_status', 'validation_errors', 'supplier_id',
        'canonical_supplier_family', 'canonical_supplier_model', 'stock', 'brand', 'origin',
        'supplier_title', 'supplier_description', 'supplier_short_description'
      ];

      const { is_discontinued, model, family, ...rest } = rawData as Record<string, any>;
      
      // Build sanitized data: only keep keys that exist in products table
      const cleanData: Record<string, any> = {};
      
      // Mapeamento especial para campos que vêm do fornecedor mas têm nomes diferentes na DB
      if (model && !cleanData.canonical_supplier_model) cleanData.canonical_supplier_model = model;
      if (family && !cleanData.canonical_supplier_family) cleanData.canonical_supplier_family = family;

      Object.keys(rest).forEach(key => {
        if (productColumns.includes(key)) {
          cleanData[key] = rest[key];
        }
      });

      // Map control flags
      if (is_discontinued === true) {
        cleanData.stock = 0;
        cleanData.workflow_state = 'draft';
      }

      if (staging.existing_product_id) {
        // Update existing product
        const { error: updateErr } = await supabase
          .from("products")
          .update({ ...cleanData, updated_at: new Date().toISOString() })
          .eq("id", staging.existing_product_id);
        
        if (updateErr) throw updateErr;
      } else {
        // products.user_id is NOT NULL — fetch workspace owner
        const { data: ws } = await supabase
          .from("workspaces")
          .select("user_id")
          .eq("id", staging.workspace_id)
          .single();

        if (!ws?.user_id) throw new Error("Workspace owner not found");

        const { error: insertErr } = await supabase
          .from("products")
          .insert({
            ...cleanData,
            workspace_id: staging.workspace_id,
            user_id: ws.user_id,
            status: 'pending',
            workflow_state: cleanData.workflow_state || 'draft',
            origin: cleanData.origin || 'supplier'
          });
        
        if (insertErr) throw insertErr;
      }

      // Update staging status
      await supabase
        .from("sync_staging")
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq("id", id);

      // Handle SKU aliases if applicable
      if (staging.sku_supplier && staging.sku_site_target && staging.supplier_id) {
        const { data: existingAlias } = await supabase
          .from("sku_aliases")
          .select("*")
          .eq("sku_site", staging.sku_site_target)
          .eq("sku_supplier", staging.sku_supplier)
          .eq("supplier_id", staging.supplier_id)
          .maybeSingle();

        if (!existingAlias) {
          await supabase.from("sku_aliases").insert({
            workspace_id: staging.workspace_id,
            sku_site: staging.sku_site_target,
            sku_supplier: staging.sku_supplier,
            supplier_id: staging.supplier_id,
            vezes_usado: 1
          });
        } else {
          await supabase.from("sku_aliases")
            .update({ vezes_usado: (existingAlias.vezes_usado || 0) + 1 })
            .eq("id", existingAlias.id);
        }
      }

      return new Response(JSON.stringify({ success: true, action: 'approved' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    throw new Error("Invalid action");
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
