import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
          .select("id")
          .eq("workspace_id", staging.workspace_id)
          .eq("sku", sku)
          .maybeSingle();
        
        if (existingProd) {
          effectiveProductId = existingProd.id;
          await supabase.from("sync_staging").update({ existing_product_id: effectiveProductId }).eq("id", id);
        }
      }

      const is_discontinued = rawData.is_discontinued === true || staging.change_type === 'discontinued';

      // BUSCAR CONFIGURAÇÃO DO JOB (Mapeado corretamente do campo ingestion_job_id)
      const { data: job } = await supabase
        .from("ingestion_jobs")
        .select("config, id")
        .eq("id", staging.ingestion_job_id)
        .single();

      const jobConfig = job?.config || {};
      const defaultBrand = jobConfig.defaultBrand || null;
      const skuPrefix = jobConfig.skuPrefix || "";
      const useSkuAsModel = jobConfig.autoModelFromSku === true;

      // Calcular Modelo: se configurado para usar SKU, remove o prefixo. 
      // Caso contrário, usa o modelo do fornecedor ou o SKU original (sku_supplier).
      let calculatedModel = rawData.model || staging.sku_supplier || sku;
      if (useSkuAsModel && skuPrefix && String(sku).startsWith(skuPrefix)) {
        calculatedModel = String(sku).slice(skuPrefix.length);
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
            brand: defaultBrand,
            model: calculatedModel,
            supplier_title: cleanSupplierValue(rawData.original_title ?? rawData.supplier_title ?? rawData.title),
            original_title: cleanSupplierValue(rawData.original_title ?? rawData.supplier_title ?? rawData.title),
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

        const cleanData: Record<string, any> = {};
        
        // Mapear preços
        const price = cleanSupplierValue(rawData.original_price ?? rawData.price ?? rawData.Preço ?? rawData.Publico);
        if (price !== undefined) cleanData.original_price = price;

        // Limpeza geral de colunas
        Object.keys(rawData).forEach(key => {
          // Não copiar brand e model do rawData, pois são controlados pelo Job
          if (productColumns.includes(key) && !['image_urls', 'original_title', 'original_description', 'brand', 'model'].includes(key)) {
            const val = cleanSupplierValue(rawData[key]);
            if (val !== undefined) cleanData[key] = val;
          }
        });

        // REGRAS DE TÍTULO E DESCRIÇÃO: Preencher ambos (original e supplier) para novos produtos
        const sTitle = cleanSupplierValue(rawData.original_title ?? rawData.supplier_title ?? rawData.title);
        const sDesc = cleanSupplierValue(rawData.original_description ?? rawData.supplier_description ?? rawData.description);
        
        if (sTitle !== undefined) {
          cleanData.supplier_title = sTitle;
          cleanData.original_title = sTitle;
        }
        if (sDesc !== undefined) {
          cleanData.supplier_description = sDesc;
          cleanData.original_description = sDesc;
        }

        // Forçar Marca e Modelo do Job
        cleanData.brand = defaultBrand;
        cleanData.model = calculatedModel;

        // TRATAMENTO DE EAN (Extrair de attributes se necessário)
        const ean = cleanSupplierValue(rawData.ean ?? rawData.EAN);
        if (ean) {
          const attributes = Array.isArray(cleanData.attributes) ? cleanData.attributes : [];
          const eanIndex = attributes.findIndex((a: any) => a.name?.toLowerCase() === 'ean');
          if (eanIndex > -1) {
            attributes[eanIndex].value = ean;
          } else {
            attributes.push({ name: 'EAN', value: ean });
          }
          cleanData.attributes = attributes;
        }

        // REORDENAÇÃO DE IMAGENS
        const deltaImgs = Array.isArray(rawData.image_urls) ? rawData.image_urls : (rawData.image_urls ? [rawData.image_urls] : []);
        const siteImgs = Array.isArray(staging.site_data?.image_urls) ? staging.site_data.image_urls : (staging.site_data?.image_urls ? [staging.site_data.image_urls] : []);

        if (deltaImgs.length > 0) {
          const combinedImgs = [...new Set([...deltaImgs, ...siteImgs])];
          cleanData.image_urls = combinedImgs;
        } else if (siteImgs.length > 0) {
          cleanData.image_urls = siteImgs;
        }

        // REGRAS DE MARCA E MODELO
        if (effectiveProductId) {
          const { data: existingProd } = await supabase
            .from("products")
            .select("brand, model")
            .eq("id", effectiveProductId)
            .single();
          
          if (!existingProd?.brand && defaultBrand) {
            cleanData.brand = defaultBrand;
          }

          if (!existingProd?.model) {
            cleanData.model = calculatedModel;
          }

          const { error: updateErr } = await supabase
            .from("products")
            .update({ ...cleanData, updated_at: new Date().toISOString() })
            .eq("id", effectiveProductId);
          if (updateErr) throw updateErr;
        } else {
          const { data: ws } = await supabase.from("workspaces").select("user_id").eq("id", staging.workspace_id).single();
          if (!ws?.user_id) throw new Error("Workspace owner not found");

          const insertData = {
            ...cleanData,
            sku: sku,
            workspace_id: staging.workspace_id,
            user_id: ws.user_id,
            status: 'pending',
            workflow_state: 'draft',
            origin: 'supplier',
            brand: defaultBrand,
            model: calculatedModel,
            is_discontinued: false
          };

          const { error: insertErr } = await supabase.from("products").insert(insertData);
          if (insertErr) throw insertErr;
        }
      }

      await supabase.from("sync_staging").update({ status: 'approved', updated_at: new Date().toISOString() }).eq("id", id);
      return new Response(JSON.stringify({ success: true, action: 'approved' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error("Invalid action");
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});