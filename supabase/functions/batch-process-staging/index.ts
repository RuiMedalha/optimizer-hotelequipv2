import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizeSKU = (sku: string): string => {
  if (!sku) return "";
  let normalized = sku.trim().toUpperCase();
  normalized = normalized.replace(/[/\\]/g, "-");
  normalized = normalized.replace(/\s+/g, "");
  normalized = normalized.replace(/-+/g, "-");
  normalized = normalized.replace(/^-|-$/g, "");
  return normalized || "0";
};

const cleanSupplierValue = (val: any) => {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') {
    const sVal = val.trim();
    if (sVal === "" || sVal === "-" || sVal === "—") return undefined;
    return sVal;
  }
  return val;
};

const CONTENT_FIELDS = [
  'original_title', 'supplier_title', 'original_description', 'supplier_description',
  'short_description', 'supplier_short_description', 'category', 'brand', 'model',
  'ean', 'technical_specs', 'attributes', 'product_type', 'meta_title', 
  'meta_description', 'seo_slug', 'tags', 'image_urls'
];

const buildUpdatePayload = (rawData: any, existingProduct: any = {}) => {
  const payload: any = {};
  
  CONTENT_FIELDS.forEach(field => {
    let value = cleanSupplierValue(rawData[field]);
    
    // Normalize image_urls and tags to array
    if ((field === 'image_urls' || field === 'tags') && value) {
      if (typeof value === 'string') {
        if (value.includes(',')) {
          value = value.split(',').map((v: string) => v.trim()).filter(Boolean);
        } else {
          value = [value.trim()];
        }
      } else if (!Array.isArray(value)) {
        value = [value];
      }
    }
    
    // attributes must be structured JSON
    if (field === 'attributes' && value) {
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          // Only use it if it's an object (including arrays)
          if (parsed !== null && typeof parsed === 'object') {
            value = parsed;
          } else {
            // Not a valid object/array, skip
            value = undefined;
          }
        } catch (e) {
          // Parse failed, skip attributes to avoid saving display strings
          value = undefined;
        }
      } else if (typeof value !== 'object' || value === null) {
        // Not a string and not an object, skip
        value = undefined;
      }
    }

    if (value !== undefined) {
      payload[field] = value;
    }
  });

  return payload;
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { changeType, action, workspaceId, selectedIds } = await req.json();
    if (!action || !workspaceId) throw new Error("Missing parameters");

    let fetchQuery = supabase
      .from("sync_staging")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "flagged"]);

    if (selectedIds && Array.isArray(selectedIds) && selectedIds.length > 0) {
      fetchQuery = fetchQuery.in("id", selectedIds);
    } else if (changeType) {
      fetchQuery = fetchQuery.eq("change_type", changeType);
    } else {
      throw new Error("Missing changeType or selectedIds");
    }

    const { data: stagingRecords, error: fetchErr } = await fetchQuery.limit(500);

    if (fetchErr) throw fetchErr;
    if (!stagingRecords || stagingRecords.length === 0) {
      return new Response(JSON.stringify({ success: true, count: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let processedCount = 0;
    const { data: ws } = await supabase.from("workspaces").select("user_id").eq("id", workspaceId).single();

    const uniqueJobIds = [...new Set(stagingRecords.map((s: any) => s.ingestion_job_id).filter(Boolean))];
    const { data: jobsData } = await supabase
      .from("ingestion_jobs")
      .select("id, config")
      .in("id", uniqueJobIds);
    const jobConfigMap = new Map((jobsData || []).map((j: any) => [j.id, j.config || {}]));

    for (const staging of stagingRecords) {
      try {
        const rawData = staging.proposed_changes || staging.supplier_data || {};
        
        // REGRA 3: Validar SKU
        const sku = cleanSupplierValue(rawData.sku || staging.sku_supplier);
        if (!sku) {
          await supabase.from("sync_staging").update({ status: 'error', review_notes: 'SKU em falta (Regra 3)' }).eq("id", staging.id);
          continue;
        }

        const jobConfig = jobConfigMap.get(staging.ingestion_job_id) || {};
        const defaultBrand = jobConfig.defaultBrand || null;
        const skuPrefix = jobConfig.skuPrefix || "";
        const skuSuffix = jobConfig.skuSuffix || "";

        // Resolução do ID do produto
        let effectiveProductId = staging.existing_product_id;
        let existingProductData = null;
        
        if (!effectiveProductId) {
          const normalizedSkuSupplier = normalizeSKU(sku);
          const variantsToTry = [
            sku,
            normalizedSkuSupplier
          ];
          if (skuPrefix) variantsToTry.push(skuPrefix + normalizedSkuSupplier);
          if (skuSuffix) variantsToTry.push(normalizedSkuSupplier + skuSuffix);
          if (skuPrefix && skuSuffix) variantsToTry.push(skuPrefix + normalizedSkuSupplier + skuSuffix);

          const { data: prods } = await supabase
            .from("products")
            .select("id, sku, brand, model, attributes, original_title, original_description, original_price")
            .eq("workspace_id", workspaceId)
            .in("sku", variantsToTry);
          
          if (prods && prods.length > 0) {
            const bestMatch = prods.find(p => p.sku === sku) || prods[0];
            effectiveProductId = bestMatch.id;
            existingProductData = bestMatch;
          }
        } else {
           const { data: p } = await supabase
            .from("products")
            .select("id, sku, brand, model, attributes, original_title, original_description, original_price")
            .eq("id", effectiveProductId)
            .single();
          existingProductData = p;
        }

        if (action === 'draft_discontinued') {
          if (effectiveProductId) {
            await supabase.from("products").update({
              is_discontinued: true,
              stock: 0,
              workflow_state: 'draft',
              updated_at: new Date().toISOString()
            }).eq("id", effectiveProductId);
          } else if (ws?.user_id) {
            await supabase.from("products").insert({
              sku: sku,
              workspace_id: workspaceId,
              user_id: ws.user_id,
              workflow_state: 'draft',
              is_discontinued: true,
              stock: 0,
              original_title: cleanSupplierValue(rawData.original_title) || sku,
              origin: 'supplier'
            });
          }
          
          await supabase.from("sync_staging").delete().eq("id", staging.id);
          processedCount++;
        }
        else if (action === 'create_drafts' && ws?.user_id) {
          const sTitle = cleanSupplierValue(rawData.original_title ?? rawData.supplier_title ?? rawData.title);
          const price = cleanSupplierValue(rawData.original_price ?? rawData.price ?? rawData.Preço ?? rawData.Publico);
          const woocommerceId = rawData.woocommerce_id ? parseInt(String(rawData.woocommerce_id), 10) : null;

          if (!sTitle && !existingProductData?.original_title) {
            await supabase.from("sync_staging").update({ status: 'error', review_notes: 'Título em falta' }).eq("id", staging.id);
            continue;
          }

          const contentPayload = buildUpdatePayload(rawData, existingProductData || {});

          if (effectiveProductId && existingProductData) {
            await supabase.from("products").update({
              ...contentPayload,
              original_price: price || existingProductData.original_price,
              ...(woocommerceId && woocommerceId > 0 && { woocommerce_id: woocommerceId }),
              workflow_state: 'draft',
              updated_at: new Date().toISOString()
            }).eq("id", effectiveProductId);
          } else {
            const productToInsert = {
              sku: sku,
              workspace_id: workspaceId,
              user_id: ws.user_id,
              workflow_state: 'draft',
              status: 'pending',
              origin: 'supplier',
              original_price: price,
              ...(woocommerceId && woocommerceId > 0 && { woocommerce_id: woocommerceId }),
              is_discontinued: false,
              ...contentPayload
            };
            await supabase.from("products").insert(productToInsert);
          }

          await supabase.from("sync_staging").delete().eq("id", staging.id);
          processedCount++;
        }
        else if (action === 'review_visual' && (changeType === 'field_update' || changeType === 'multiple_changes') && effectiveProductId) {
          const contentPayload = buildUpdatePayload(rawData, existingProductData || {});
          
          await supabase.from("products").update({
            ...contentPayload,
            workflow_state: 'draft',
            updated_at: new Date().toISOString()
          }).eq("id", effectiveProductId);

          await supabase.from("sync_staging").delete().eq("id", staging.id);
          processedCount++;
        }
        else if ((action === 'approve_prices' || action === 'approve_prices_only') && effectiveProductId) {
          const newPrice = cleanSupplierValue(rawData.price || rawData.original_price || rawData.Preço || rawData.Publico);
          if (newPrice !== undefined) {
             await supabase.from("products").update({
              original_price: newPrice,
              updated_at: new Date().toISOString()
            }).eq("id", effectiveProductId);
          }
          await supabase.from("sync_staging").delete().eq("id", staging.id);
          processedCount++;
        }
        else if (action === 'approve_all' && effectiveProductId) {
          // Combine visual review + price approval
          const contentPayload = buildUpdatePayload(rawData, existingProductData || {});
          const newPrice = cleanSupplierValue(rawData.price || rawData.original_price || rawData.Preço || rawData.Publico);
          
          await supabase.from("products").update({
            ...contentPayload,
            original_price: newPrice !== undefined ? newPrice : (existingProductData?.original_price),
            workflow_state: 'draft',
            updated_at: new Date().toISOString()
          }).eq("id", effectiveProductId);

          await supabase.from("sync_staging").delete().eq("id", staging.id);
          processedCount++;
        }
      } catch (err) {
        console.error(`Error processing staging ${staging.id}:`, err);
      }
    }

    let remainingQuery = supabase
      .from("sync_staging")
      .select("*", { count: 'exact', head: true })
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "flagged"]);

    if (selectedIds && Array.isArray(selectedIds) && selectedIds.length > 0) {
      // If we processed some selected IDs, we need to check how many of THOSE are left (though usually we process all 500)
      remainingQuery = remainingQuery.in("id", selectedIds);
    } else if (changeType) {
      remainingQuery = remainingQuery.eq("change_type", changeType);
    }

    const { count: remainingCount } = await remainingQuery;

    return new Response(JSON.stringify({ 
      success: true, 
      count: processedCount,
      remaining: remainingCount || 0
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });


  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});