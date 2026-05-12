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

const formatAttributeValue = (val: any): string => {
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && val.value !== undefined) {
    const unit = val.unit ? ` ${val.unit}` : "";
    return `${val.value}${unit}`;
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { jobId } = await req.json();
    if (!jobId) throw new Error("jobId required");

    // Load job
    const { data: job, error: jobErr } = await supabase
      .from("ingestion_jobs")
      .select("*, workspace_id, merge_strategy, role, supplier_id")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) throw new Error("Job not found");

    const workspaceId = job.workspace_id;
    
    // Update status to importing if it's the first run
    // Update status to importing and reset items if it's a new run or re-run
    if (job.status !== "importing") {
      console.log(`[run-ingestion-job] Resetting job ${jobId} for fresh run...`);
      
      // If it was a supplier delta job, clean up previous staging records to avoid duplicates
      if (job.role === 'supplier_delta') {
        const { error: deleteStagingErr } = await supabase
          .from("sync_staging")
          .delete()
          .eq("ingestion_job_id", jobId);
        
        if (deleteStagingErr) console.error("Error cleaning up old staging records:", deleteStagingErr);
      }

      // Reset items to 'mapped' so they can be re-processed
      const { error: resetErr } = await supabase.from("ingestion_job_items")
        .update({ 
          status: "mapped", 
          error_message: null 
        })
        .eq("job_id", jobId);
      
      if (resetErr) console.error("Error resetting job items:", resetErr);

      await supabase.from("ingestion_jobs").update({
        status: "importing",
        mode: "live",
        started_at: new Date().toISOString(),
        // Reset counters for a fresh start
        imported_rows: 0,
        updated_rows: 0,
        skipped_rows: 0,
        failed_rows: 0,
        results: { imported: 0, updated: 0, skipped: 0, failed: 0 }
      }).eq("id", jobId);
    }

    // Fetch items with status 'mapped' (not yet processed)
    // We process in batches of 100 per invocation to improve throughput
    const INVOCATION_BATCH_SIZE = 100;
    
    const { data: pendingItems, error: itemsErr } = await supabase
      .from("ingestion_job_items")
      .select("*")
      .eq("job_id", jobId)
      .eq("status", "mapped")
      .limit(INVOCATION_BATCH_SIZE);

    if (itemsErr) throw itemsErr;

    if (!pendingItems || pendingItems.length === 0) {
      // If no more items to process, mark job as done
      await supabase.from("ingestion_jobs").update({
        status: "done",
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
      
      return new Response(JSON.stringify({
        success: true,
        jobId,
        finished: true,
        processed: 0
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const allItems = pendingItems;

    // Field map is used ONLY when mapped_data is missing (fallback to source_data)
    const fieldMap: Record<string, string> = {
      original_title: "original_title",
      title: "original_title",
      original_description: "original_description",
      description: "original_description",
      short_description: "short_description",
      sku: "sku",
      category: "category",
      brand: "brand",
      marca: "brand",
      model: "model",
      modelo: "model",
      ean: "ean",
      woocommerce_id: "woocommerce_id",
      original_price: "original_price",
      price: "original_price",
      sale_price: "sale_price",
      stock: "stock",
      image_urls: "image_urls",
      tags: "tags",
      meta_title: "meta_title",
      meta_description: "meta_description",
      seo_slug: "seo_slug",
      supplier_ref: "supplier_ref",
      technical_specs: "technical_specs",
      product_type: "product_type",
    };

    // Standard schema keys that should NOT go into attributes
    const schemaKeys = new Set([
      "sku", "original_title", "optimized_title", "original_description", "optimized_description",
      "original_price", "optimized_price", "sale_price", "optimized_sale_price",
      "category", "brand", "model", "tags", "meta_title", "meta_description", "seo_slug",
      "short_description", "optimized_short_description", "technical_specs",
      "image_urls", "product_type", "stock", "supplier_ref", "ean", "woocommerce_id", "attributes"
    ]);

    function buildProductData(mapped: Record<string, any>, isRawData = false): Record<string, any> {
      const productData: Record<string, any> = {};
      const extras: Record<string, any> = {};

      if (isRawData) {
        // Fallback mode: apply fieldMap to raw headers
        for (const [src, dst] of Object.entries(fieldMap)) {
          if (mapped[src] !== undefined && mapped[src] !== null && mapped[src] !== "") {
            productData[dst] = mapped[src];
          }
        }
        // Everything else to extras
        for (const [k, v] of Object.entries(mapped)) {
          if (!fieldMap[k] && v !== undefined && v !== null && v !== "") {
            extras[k] = v;
          }
        }
      } else {
        // Normal mode: mapped already has target keys
        for (const [k, v] of Object.entries(mapped)) {
          if (v === undefined || v === null || v === "") continue;
          
          if (schemaKeys.has(k)) {
            productData[k] = v;
          } else {
            extras[k] = v;
          }
        }
      }

      // Format special fields
      if (productData.image_urls && typeof productData.image_urls === "string") {
        productData.image_urls = productData.image_urls.split(",").map((s: string) => s.trim()).filter(Boolean);
      }
      if (productData.tags && typeof productData.tags === "string") {
        productData.tags = productData.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
      }

      // Price parsing
      const parsePrice = (val: any) => {
        if (typeof val === "number") return val;
        const cleanVal = String(val).replace(/[^\d,.-]/g, "").trim();
        const parsed = parseFloat(cleanVal.replace(",", "."));
        return isNaN(parsed) ? null : parsed;
      };

      if (productData.original_price !== undefined) productData.original_price = parsePrice(productData.original_price);
      if (productData.sale_price !== undefined) productData.sale_price = parsePrice(productData.sale_price);
      if (productData.stock !== undefined) productData.stock = parseInt(String(productData.stock).replace(/\D/g, ""), 10) || 0;

      if (productData.woocommerce_id !== undefined) {
        const wooId = parseInt(String(productData.woocommerce_id), 10);
        productData.woocommerce_id = isNaN(wooId) || wooId <= 0 ? null : wooId;
      }

      // Fallbacks for title/description if missing
      if (!productData.original_title) {
        productData.original_title = mapped.name || mapped.label || mapped.titulo || mapped.titulo_original;
      }
      if (!productData.original_description) {
        productData.original_description = mapped.body_html || mapped.description_long || mapped.descricao || mapped.descricao_original;
      }

      // Merge extras into attributes
      if (Object.keys(extras).length > 0) {
        productData.attributes = { ...(productData.attributes || {}), ...extras };
      }

      return productData;
    }

    function mergeProductData(base: Record<string, any>, overlay: Record<string, any>): Record<string, any> {
      const result = { ...base };
      for (const [key, val] of Object.entries(overlay)) {
        if (val === undefined || val === null || val === "") continue;
        
        // Se o valor existe na proposta, ele deve SOBREPOR o valor atual
        // para garantir que re-mapeamentos manuais funcionem.
        // Anteriormente, só preenchia se estivesse vazio.
        const existing = result[key];
        
        if (Array.isArray(existing) && Array.isArray(val)) {
          result[key] = [...new Set([...existing, ...val])];
        } else if (typeof existing === "object" && typeof val === "object" && !Array.isArray(existing)) {
          result[key] = { ...existing, ...val };
        } else {
          // Tipos primitivos (string, number): o novo valor substitui o antigo
          result[key] = val;
        }
      }
      return result;
    }

    // Process all items in batches of 5 for better throughput and lower resource usage
    const BATCH_SIZE = 5;
    let imported = 0, updated = 0, skipped = 0, failed = 0;

    // First, group by SKU
    const skuGroups = new Map<string, any[]>();
    const noSkuItems: any[] = [];

    for (const item of allItems) {
      if (item.action === "skip" || item.action === "duplicate") {
        skipped++;
        continue;
      }
      const mapped = item.mapped_data || item.source_data || {};
      const sku = (mapped.sku || "").toString().trim().toUpperCase();
      if (sku) {
        if (!skuGroups.has(sku)) skuGroups.set(sku, []);
        skuGroups.get(sku)!.push(item);
      } else {
        noSkuItems.push(item);
      }
    }

    const skuEntries = Array.from(skuGroups.entries());
    
    const allSkus = Array.from(skuGroups.keys());
    // Use an RPC or a sophisticated query to handle case-insensitive matching for the whole batch
    // For simplicity and safety with 50 items, we'll fetch products where SKU is in the list
    // Fetch ALL products in the workspace for matching to handle variants and normalized SKUs
    // Using cache to avoid repeating this for every batch invocation if possible, 
    // but for now, ensuring we get a broader set for matching.
    const existingProductsList: any[] = [];
    let allWorkspaceProducts: any[] = [];
    let hasMoreProducts = true;
    let productOffset = 0;
    const PRODUCT_PAGE_SIZE = 1000;

    while (hasMoreProducts) {
      const { data: productPage, error: prodErr } = await supabase
        .from("products")
        .select("id, sku, ean, woocommerce_id, model, brand, original_title")
        .eq("workspace_id", workspaceId)
        .range(productOffset, productOffset + PRODUCT_PAGE_SIZE - 1);
      if (prodErr) throw prodErr;
      if (productPage && productPage.length > 0) {
        allWorkspaceProducts = [...allWorkspaceProducts, ...productPage];
        productOffset += PRODUCT_PAGE_SIZE;
        if (productPage.length < PRODUCT_PAGE_SIZE) hasMoreProducts = false;
      } else {
        hasMoreProducts = false;
      }
    }
    if (allWorkspaceProducts.length > 0) existingProductsList.push(...allWorkspaceProducts);

    const existingProductsMap = new Map<string, any>();
    const normalizedProductsMap = new Map<string, any>();
    
    existingProductsList?.forEach(p => {
      if (p.sku) {
        const upSku = p.sku.toUpperCase();
        existingProductsMap.set(upSku, p);
        normalizedProductsMap.set(normalizeSKU(upSku), p);
      }
    });

    const eanProductMap = new Map<string, any>();
    existingProductsList.forEach(p => {
      if (p.ean && String(p.ean).trim()) {
        eanProductMap.set(String(p.ean).trim(), p);
      }
    });

    // To handle case-insensitivity for those not found by exact match:
    // If we have many missing, we could do more, but for now this is much better than before.

    const itemsToUpdateStatus: { id: string, status: string, product_id?: string, error_message?: string }[] = [];

    // ─── Supplier Delta Mode ───
    const isSupplierDelta = job.role === 'supplier_delta';
    let aliasMap = new Map<string, string>();
    
    if (isSupplierDelta && job.supplier_id) {
      const { data: aliases } = await supabase
        .from("sku_aliases")
        .select("sku_supplier, sku_site")
        .eq("workspace_id", workspaceId)
        .eq("supplier_id", job.supplier_id);
      
      if (aliases) {
        aliases.forEach(a => aliasMap.set(normalizeSKU(a.sku_supplier), a.sku_site));
      }
    }

    // Process SKU Groups in batches
    for (let i = 0; i < skuEntries.length; i += BATCH_SIZE) {
      const batch = skuEntries.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async ([sku, groupItems]) => {
        try {
          let mergedData: Record<string, any> = {};
          for (const item of groupItems) {
            const mapped = item.mapped_data || item.source_data || {};
            const isRawData = !item.mapped_data;
            const pd = buildProductData(mapped, isRawData);
            mergedData = mergeProductData(mergedData, pd);
          }
          mergedData.sku = sku;

          const rawSku = sku;
          const normalizedSkuHoreca = normalizeSKU(rawSku);
          
          let existingProduct = null;
          let matchMethod = "none";
          let confidence = 0;
          let matchedAlias = null;

          // 1. Exact match (Case insensitive)
          const upRawSku = rawSku.toUpperCase();
          const exactMatch = existingProductsMap.get(upRawSku);
          
          if (exactMatch) {
            existingProduct = exactMatch;
            matchMethod = "exact";
            confidence = 100;
          } else {
            // 2. Normalized match (handles spaces, leading zeros, etc.)
            const normRawSku = normalizeSKU(rawSku);
            const normMatch = normalizedProductsMap.get(normRawSku);
            
            if (normMatch) {
              existingProduct = normMatch;
              matchMethod = "normalized";
              confidence = 95;
            } else {
              // 3. Alias match
              const aliasSkuSite = aliasMap.get(normalizedSkuHoreca);
              if (aliasSkuSite) {
                const siteProduct = existingProductsMap.get(aliasSkuSite.toUpperCase());
                if (siteProduct) {
                  existingProduct = siteProduct;
                  matchMethod = "exact";
                  confidence = 95;
                  matchedAlias = rawSku;
                }
              }
            }

            if (!existingProduct && mergedData.ean && String(mergedData.ean).trim()) {
              const eanMatch = eanProductMap.get(String(mergedData.ean).trim());
              if (eanMatch) {
                existingProduct = eanMatch;
                matchMethod = "ean";
                confidence = 98;
              }
            }
          }


          const status = confidence >= 80 ? "pending" : "flagged";

          if (isSupplierDelta) {
            // Write to sync_staging instead of updating products
            // Ensure CATEGORY and BRAND are in the proposed_changes
            const { error: stagingErr } = await supabase
              .from("sync_staging")
              .insert({
                ingestion_job_id: jobId,
                supplier_id: job.supplier_id,
                sku_supplier: rawSku,
                sku_site_target: existingProduct?.sku || null,
                confidence_score: confidence,
                match_method: matchMethod,
                supplier_data: mergedData,
                proposed_changes: {
                   ...mergedData,
                   category: mergedData.category || mergedData.Categoria,
                   brand: mergedData.brand || mergedData.Marca,
                   model: mergedData.model || mergedData.Modelo,
                   ean: mergedData.ean || mergedData.EAN,
                   original_description: mergedData.original_description || mergedData.Descrição,
                   // Format attributes for display
                   attributes: mergedData.attributes ? Object.fromEntries(
                     Object.entries(mergedData.attributes).map(([k, v]) => [k, formatAttributeValue(v)])
                   ) : undefined
                },
                site_data: existingProduct || null,
                existing_product_id: existingProduct?.id || null,
                status: status,
                workspace_id: workspaceId
              });

            if (stagingErr) throw stagingErr;

            if (matchedAlias) {
              await supabase.rpc('increment_sku_alias_usage', {
                p_sku_supp: matchedAlias,
                p_supplier_id: job.supplier_id,
                p_workspace_id: workspaceId
              });
            }
            
            imported++; // Counting as "imported" to staging
          } else {
            // Normal behavior for other roles
            const existingId = existingProduct?.id;
            let productId: string | null = null;

            if (existingId) {
              let finalUpdateData = mergedData;
              if (job.merge_strategy === 'merge') {
                finalUpdateData = mergeProductData(existingProduct, mergedData);
                if (Array.isArray(existingProduct.image_urls) && Array.isArray(mergedData.image_urls)) {
                  finalUpdateData.image_urls = [...new Set([...mergedData.image_urls, ...existingProduct.image_urls])];
                }
              }

              const { error: updateErr } = await supabase
                .from("products")
                .update({ ...finalUpdateData, updated_at: new Date().toISOString() })
                .eq("id", existingId);
              if (updateErr) throw updateErr;
              productId = existingId;
              updated++;
            } else {
              const { data: existingAfterCheck } = await supabase
                .from("products")
                .select("id")
                .eq("workspace_id", workspaceId)
                .eq("sku", mergedData.sku)
                .maybeSingle();

              if (existingAfterCheck) {
                const { error: updateErr } = await supabase
                  .from("products")
                  .update({ ...mergedData, updated_at: new Date().toISOString() })
                  .eq("id", existingAfterCheck.id);
                if (updateErr) throw updateErr;
                productId = existingAfterCheck.id;
                updated++;
              } else {
                const { data: newProd, error: insertErr } = await supabase
                  .from("products")
                  .insert({
                    ...mergedData,
                    workspace_id: workspaceId,
                    user_id: user.id,
                    status: 'pending'
                  })
                  .select("id")
                  .single();
                if (insertErr) throw insertErr;
                productId = newProd.id;
                imported++;
              }
            }
          }

          groupItems.forEach(gi => {
            itemsToUpdateStatus.push({ 
              id: gi.id, 
              status: "processed", 
              product_id: productId 
            });
          });
        } catch (err) {
          console.error(`Error processing SKU ${sku}:`, err);
          failed += groupItems.length;
          groupItems.forEach(gi => {
            itemsToUpdateStatus.push({ id: gi.id, status: "error", error_message: (err as Error).message });
          });
        }
      }));
    }

    // Process No-SKU items in batches
    for (let i = 0; i < noSkuItems.length; i += BATCH_SIZE) {
      const batch = noSkuItems.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (item) => {
        try {
          const mapped = item.mapped_data || item.source_data || {};
          const isRawData = !item.mapped_data;
          const productData = buildProductData(mapped, isRawData);
          if (productData.productId !== undefined) delete productData.productId;

          
          if (isSupplierDelta) {
            const { error: stagingErr } = await supabase
              .from("sync_staging")
              .insert({
                ingestion_job_id: jobId,
                supplier_id: job.supplier_id,
                sku_supplier: null,
                confidence_score: 0,
                match_method: "none",
                supplier_data: productData,
                proposed_changes: productData, // Populate this so approval works
                site_data: null,
                existing_product_id: null,
                status: "flagged",
                workspace_id: workspaceId
              });
            if (stagingErr) throw stagingErr;
            imported++;
          } else if (item.matched_existing_id) {
            let finalUpdateData = productData;
            if (job.merge_strategy === 'merge') {
              const { data: existing } = await supabase
                .from("products")
                .select("*")
                .eq("id", item.matched_existing_id)
                .single();
              
              if (existing) {
                finalUpdateData = mergeProductData(existing, productData);
                if (Array.isArray(existing.image_urls) && Array.isArray(productData.image_urls)) {
                  finalUpdateData.image_urls = [...new Set([...productData.image_urls, ...existing.image_urls])];
                }
              }
            }

            const { error: updateErr } = await supabase
              .from("products")
              .update({ ...finalUpdateData, updated_at: new Date().toISOString() })
              .eq("id", item.matched_existing_id);
            if (updateErr) throw updateErr;
            updated++;
          } else {
            const { data: newProd, error: insertErr } = await supabase
              .from("products")
              .insert({
                ...productData,
                workspace_id: workspaceId,
                user_id: user.id,
                status: 'pending'
              })
              .select("id")
              .single();
            if (insertErr) throw insertErr;
            imported++;
          }
          itemsToUpdateStatus.push({ id: item.id, status: "processed" });
        } catch (err) {
          failed++;
          itemsToUpdateStatus.push({ id: item.id, status: "error", error_message: (err as Error).message });
        }
      }));
    }

    // Bulk update ingestion_job_items status
    if (itemsToUpdateStatus.length > 0) {
      // Supabase insert with upsert on id to update multiple rows with different values
      const { error: bulkErr } = await supabase
        .from("ingestion_job_items")
        .upsert(itemsToUpdateStatus.map(item => ({
          id: item.id,
          status: item.status,
          product_id: item.product_id || null,
          error_message: item.error_message || null,
          job_id: jobId // required for RLS usually
        })));
      
      if (bulkErr) console.error("Error in bulk update of items:", bulkErr);
    }

    // Check if there are more items to process for this job
    const { count: remainingCount } = await supabase
      .from("ingestion_job_items")
      .select("*", { count: 'exact', head: true })
      .eq("job_id", jobId)
      .eq("status", "mapped");

    const isFinished = (remainingCount || 0) === 0;

    // Update job status and incremental counters
    const { data: currentJob } = await supabase
      .from("ingestion_jobs")
      .select("imported_rows, updated_rows, skipped_rows, failed_rows")
      .eq("id", jobId)
      .single();

    await supabase.from("ingestion_jobs").update({
      status: isFinished ? "done" : "importing",
      imported_rows: (currentJob?.imported_rows || 0) + imported,
      updated_rows: (currentJob?.updated_rows || 0) + updated,
      skipped_rows: (currentJob?.skipped_rows || 0) + skipped,
      failed_rows: (currentJob?.failed_rows || 0) + failed,
      completed_at: isFinished ? new Date().toISOString() : null,
      results: { 
        imported: (currentJob?.imported_rows || 0) + imported, 
        updated: (currentJob?.updated_rows || 0) + updated, 
        skipped: (currentJob?.skipped_rows || 0) + skipped, 
        failed: (currentJob?.failed_rows || 0) + failed,
        lastBatch: { imported, updated, skipped, failed }
      },
    }).eq("id", jobId);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      finished: isFinished,
      remaining: remainingCount || 0,
      lastBatch: { imported, updated, skipped, failed }
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});