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

    const { changeType, action, workspaceId } = await req.json();
    if (!changeType || !action || !workspaceId) throw new Error("Missing parameters");

    const { data: stagingRecords, error: fetchErr } = await supabase
      .from("sync_staging")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("change_type", changeType)
      .in("status", ["pending", "flagged"])
      .limit(500); // Batch smaller for safety

    if (fetchErr) throw fetchErr;
    if (!stagingRecords || stagingRecords.length === 0) {
      return new Response(JSON.stringify({ success: true, count: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let processedCount = 0;
    const { data: ws } = await supabase.from("workspaces").select("user_id").eq("id", workspaceId).single();

    for (const staging of stagingRecords) {
      try {
        const rawData = staging.proposed_changes || staging.supplier_data || {};
        
        // REGRA 3: Validar SKU
        const sku = cleanSupplierValue(rawData.sku || staging.sku_supplier);
        if (!sku) {
          await supabase.from("sync_staging").update({ status: 'error', review_notes: 'SKU em falta (Regra 3)' }).eq("id", staging.id);
          continue;
        }

        // BUSCAR CONFIGURAÇÃO DO JOB (Bug 2)
        const { data: job } = await supabase
          .from("ingestion_jobs")
          .select("config, id")
          .eq("id", staging.ingestion_job_id)
          .single();

        const jobConfig = job?.config || {};
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
              status: 'discontinued',
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
              status: 'discontinued',
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
          // BUSCAR CONFIGURAÇÃO DO JOB
          const { data: job } = await supabase
            .from("ingestion_jobs")
            .select("config, id")
            .eq("id", staging.ingestion_job_id)
            .single();

          const jobConfig = job?.config || {};
          const defaultBrand = jobConfig.defaultBrand || null;
          
          const sTitle = cleanSupplierValue(rawData.original_title ?? rawData.supplier_title ?? rawData.title);
          const sDesc = cleanSupplierValue(rawData.original_description ?? rawData.supplier_description ?? rawData.description);
          const price = cleanSupplierValue(rawData.original_price ?? rawData.price ?? rawData.Preço ?? rawData.Publico);

          // Validação básica
          if (!sTitle && !existingProductData?.original_title) {
            await supabase.from("sync_staging").update({ status: 'error', review_notes: 'Título em falta' }).eq("id", staging.id);
            continue;
          }

          if (effectiveProductId && existingProductData) {
            // UPDATE com MERGE
            await supabase.from("products").update({
              brand: rawData.brand || defaultBrand || existingProductData.brand,
              model: rawData.model || staging.sku_supplier || existingProductData.model,
              attributes: rawData.attributes || existingProductData.attributes,
              original_title: sTitle || existingProductData.original_title,
              original_description: sDesc || existingProductData.original_description,
              original_price: price || existingProductData.original_price,
              updated_at: new Date().toISOString()
            }).eq("id", effectiveProductId);
          } else {
            // INSERT novo
            const productToInsert = {
              sku: sku,
              workspace_id: workspaceId,
              user_id: ws.user_id,
              workflow_state: 'draft',
              status: 'pending',
              origin: 'supplier',
              brand: rawData.brand || defaultBrand,
              model: rawData.model || staging.sku_supplier || sku,
              supplier_title: sTitle,
              original_title: sTitle,
              original_description: sDesc,
              original_price: price,
              is_discontinued: false
            };
            await supabase.from("products").insert(productToInsert);
          }

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
      } catch (err) {
        console.error(`Error processing staging ${staging.id}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, count: processedCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});