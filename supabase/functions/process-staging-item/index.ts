import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizeSKU = (sku: string): string => {
  if (!sku) return "";
  let normalized = sku.trim().toUpperCase();
  // Replace slashes with hyphens
  normalized = normalized.replace(/[/\\]/g, "-");
  // Collapse multiple hyphens
  normalized = normalized.replace(/-+/g, "-");
  // Remove leading zeros from numeric-only segments
  normalized = normalized.split('-').map(part => {
    if (/^\d+$/.test(part)) {
      const stripped = part.replace(/^0+/, "");
      return stripped === "" ? "0" : stripped;
    }
    return part;
  }).join('-');
  
  return normalized || "0";
};

// Helper function to clean data according to Rule 2
const cleanSupplierValue = (val: any) => {
  if (val === null || val === undefined) return undefined;
  const sVal = String(val).trim();
  if (sVal === "" || sVal === "-" || sVal === "—") return undefined;
  return val;
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

    const { data: staging, error: stagingErr } = await supabase
      .from("sync_staging")
      .select("*")
      .eq("id", id)
      .single();

    if (stagingErr || !staging) throw new Error("Staging record not found");

    if (action === 'reject') {
      await supabase.from("sync_staging").update({ status: 'rejected', updated_at: new Date().toISOString() }).eq("id", id);
      return new Response(JSON.stringify({ success: true, action: 'rejected' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'approve') {
      const rawData = approvedData || staging.proposed_changes || staging.supplier_data || {};
      
      // REGRA 3: Validar SKU
      const sku = cleanSupplierValue(rawData.sku || staging.sku_supplier);
      if (!sku) {
        await supabase.from("sync_staging").update({ 
          status: 'error', 
          review_notes: 'SKU em falta ou inválido (Regra 3)',
          updated_at: new Date().toISOString() 
        }).eq("id", id);
        throw new Error("SKU em falta");
      }

      // Tentar encontrar o ID do produto se estiver em falta no staging
      let effectiveProductId = staging.existing_product_id;
      if (!effectiveProductId) {
        const { data: existingProd } = await supabase
          .from("products")
          .select("id, brand, model, attributes, original_title, original_description, original_price")
          .eq("workspace_id", staging.workspace_id)
          .eq("sku", sku)
          .maybeSingle();
        
        if (existingProd) {
          effectiveProductId = existingProd.id;
          // Não atualizamos o staging aqui porque vamos deletá-lo no final
        }
      }

      const is_discontinued = rawData.is_discontinued === true || staging.change_type === 'discontinued';

      // BUSCAR CONFIGURAÇÃO DO JOB
      const { data: job } = await supabase
        .from("ingestion_jobs")
        .select("config, id")
        .eq("id", staging.ingestion_job_id)
        .single();

      const jobConfig = job?.config || {};
      const defaultBrand = jobConfig.defaultBrand || null;
      const skuPrefix = jobConfig.skuPrefix || "";
      const useSkuAsModel = jobConfig.autoModelFromSku === true;

      let calculatedModel = rawData.model || staging.sku_supplier || sku;
      if (useSkuAsModel && skuPrefix && String(sku).startsWith(skuPrefix)) {
        calculatedModel = String(sku).slice(skuPrefix.length);
      }

      // VALIDAÇÃO DE CAMPOS CRÍTICOS (conforme solicitado pelo usuário)
      const { data: existingProductData } = effectiveProductId ? 
        await supabase.from("products").select("*").eq("id", effectiveProductId).single() : { data: null };

      const missingFields = [];
      if (!sku) missingFields.push('SKU');
      if (!defaultBrand && !rawData.brand && !existingProductData?.brand) missingFields.push('Marca');
      
      const sTitle = cleanSupplierValue(rawData.original_title ?? rawData.supplier_title ?? rawData.title);
      if (!sTitle && !existingProductData?.original_title) missingFields.push('Título');

      if (missingFields.length > 0) {
        const errorMsg = `Não é possível importar produto - campos em falta: ${missingFields.join(', ')}`;
        await supabase.from("sync_staging").update({ 
          status: 'error', 
          review_notes: errorMsg,
          updated_at: new Date().toISOString() 
        }).eq("id", id);
        throw new Error(errorMsg);
      }

      if (is_discontinued) {
        if (effectiveProductId) {
          const { error: updateErr } = await supabase
            .from("products")
            .update({ 
              is_discontinued: true,
              stock: 0,
              workflow_state: 'draft',
              updated_at: new Date().toISOString() 
            })
            .eq("id", effectiveProductId);
          
          if (updateErr) throw updateErr;
        } else {
          const { data: ws } = await supabase.from("workspaces").select("user_id").eq("id", staging.workspace_id).single();
          if (!ws?.user_id) throw new Error("Workspace owner not found");

          const insertData = {
            sku: sku,
            workspace_id: staging.workspace_id,
            user_id: ws.user_id,
            status: 'pending',
            workflow_state: 'draft',
            is_discontinued: true,
            stock: 0,
            origin: 'supplier',
            brand: rawData.brand || defaultBrand,
            model: calculatedModel,
            supplier_title: sTitle,
            original_title: sTitle,
            supplier_description: cleanSupplierValue(rawData.original_description ?? rawData.supplier_description ?? rawData.description),
            original_description: cleanSupplierValue(rawData.original_description ?? rawData.supplier_description ?? rawData.description)
          };

          const { error: insertErr } = await supabase.from("products").insert(insertData);
          if (insertErr) throw insertErr;
        }
      } else {
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
          'supplier_title', 'supplier_description', 'supplier_short_description', 'model', 'attributes'
        ];

        const mergeData: Record<string, any> = {};
        
        // Mapear preços
        const price = cleanSupplierValue(rawData.original_price ?? rawData.price ?? rawData.Preço ?? rawData.Publico);
        if (price !== undefined) mergeData.original_price = price;

        // Limpeza e mapeamento geral
        Object.keys(rawData).forEach(key => {
          if (productColumns.includes(key) && !['image_urls', 'original_title', 'original_description', 'brand', 'model'].includes(key)) {
            const val = cleanSupplierValue(rawData[key]);
            if (val !== undefined) mergeData[key] = val;
          }
        });

        const sDesc = cleanSupplierValue(rawData.original_description ?? rawData.supplier_description ?? rawData.description);
        
        if (sTitle !== undefined) {
          mergeData.supplier_title = sTitle;
          mergeData.original_title = sTitle;
        }
        if (sDesc !== undefined) {
          mergeData.supplier_description = sDesc;
          mergeData.original_description = sDesc;
        }

        // REORDENAÇÃO DE IMAGENS
        const deltaImgs = Array.isArray(rawData.image_urls) ? rawData.image_urls : (rawData.image_urls ? [rawData.image_urls] : []);
        const siteImgs = Array.isArray(staging.site_data?.image_urls) ? staging.site_data.image_urls : (staging.site_data?.image_urls ? [staging.site_data.image_urls] : []);

        if (deltaImgs.length > 0) {
          const combinedImgs = [...new Set([...deltaImgs, ...siteImgs])];
          mergeData.image_urls = combinedImgs;
        } else if (siteImgs.length > 0) {
          mergeData.image_urls = siteImgs;
        }

        if (effectiveProductId && existingProductData) {
          // Lógica de MERGE: preservar campos existentes se os novos forem vazios
          const finalUpdateData = {
            brand: rawData.brand || defaultBrand || existingProductData.brand,
            model: calculatedModel || existingProductData.model,
            attributes: rawData.attributes || existingProductData.attributes,
            original_title: sTitle || existingProductData.original_title,
            original_description: sDesc || existingProductData.original_description,
            original_price: price || existingProductData.original_price,
            image_urls: mergeData.image_urls || existingProductData.image_urls,
            updated_at: new Date().toISOString()
          };

          // Adicionar outros campos que foram mapeados mas não estão no merge básico
          Object.keys(mergeData).forEach(key => {
            if (mergeData[key] !== undefined && finalUpdateData[key] === undefined) {
              finalUpdateData[key] = mergeData[key];
            }
          });

          const { error: updateErr } = await supabase
            .from("products")
            .update(finalUpdateData)
            .eq("id", effectiveProductId);
          if (updateErr) throw updateErr;
          
          console.log(`[reconciliation] Updated existing product ${sku}`);
        } else {
          const { data: ws } = await supabase.from("workspaces").select("user_id").eq("id", staging.workspace_id).single();
          if (!ws?.user_id) throw new Error("Workspace owner not found");

          const insertData = {
            ...mergeData,
            sku: sku,
            workspace_id: staging.workspace_id,
            user_id: ws.user_id,
            status: 'pending',
            workflow_state: 'draft',
            origin: 'supplier',
            brand: rawData.brand || defaultBrand,
            model: calculatedModel,
            is_discontinued: false
          };

          const { error: insertErr } = await supabase.from("products").insert(insertData);
          if (insertErr) throw insertErr;
          
          console.log(`[reconciliation] Created new product ${sku}`);
        }
      }

      // LIMPEZA: Remover do staging após sucesso
      const { error: deleteErr } = await supabase.from("sync_staging").delete().eq("id", id);
      if (deleteErr) {
        console.error("Erro ao remover do staging:", deleteErr);
        // Se falhar o delete, marcamos como aprovado para evitar loops, mas o produto já foi importado
        await supabase.from("sync_staging").update({ status: 'approved', updated_at: new Date().toISOString() }).eq("id", id);
      }
      
      return new Response(JSON.stringify({ success: true, action: 'approved' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error("Invalid action");
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});