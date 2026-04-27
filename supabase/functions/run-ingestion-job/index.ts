import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
      .select("*")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) throw new Error("Job not found");

    const workspaceId = job.workspace_id;
    
    // Update status to importing if it's the first run
    if (job.status !== "importing") {
      await supabase.from("ingestion_jobs").update({
        status: "importing",
        mode: "live",
        started_at: new Date().toISOString(),
      }).eq("id", jobId);
    }

    // Fetch items with status 'mapped' (not yet processed)
    // We process in batches of 50 per invocation to stay within memory/time limits
    const INVOCATION_BATCH_SIZE = 50;
    
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

    const fieldMap: Record<string, string> = {
      original_title: "original_title",
      title: "original_title",
      original_description: "original_description",
      description: "original_description",
      short_description: "short_description",
      sku: "sku",
      category: "category",
      original_price: "original_price",
      price: "original_price",
      sale_price: "sale_price",
      image_urls: "image_urls",
      tags: "tags",
      meta_title: "meta_title",
      meta_description: "meta_description",
      seo_slug: "seo_slug",
      supplier_ref: "supplier_ref",
      technical_specs: "technical_specs",
      product_type: "product_type",
      attributes: "attributes",
      stock: "stock",
    };

    function buildProductData(mapped: Record<string, any>): Record<string, any> {
      const productData: Record<string, any> = {};
      for (const [src, dst] of Object.entries(fieldMap)) {
        if (mapped[src] !== undefined && mapped[src] !== null && mapped[src] !== "") {
          let val = mapped[src];
          if (dst === "image_urls" || dst === "tags") {
            if (typeof val === "string") {
              val = val.split(",").map((s: string) => s.trim()).filter(Boolean);
            }
          }
          if (dst === "original_price" || dst === "sale_price") {
            val = parseFloat(String(val).replace(",", "."));
            if (isNaN(val)) continue;
          }
          if (dst === "stock") {
            val = parseInt(String(val).replace(/\D/g, ""), 10);
            if (isNaN(val)) continue;
          }
          productData[dst] = val;
        }
      }
      
      const knownKeys = new Set([...Object.keys(fieldMap), "id", "workspace_id", "user_id"]);
      const extras: Record<string, any> = {};
      for (const [k, v] of Object.entries(mapped)) {
        if (!knownKeys.has(k) && v !== undefined && v !== null && v !== "") {
          extras[k] = v;
        }
      }
      if (Object.keys(extras).length > 0) {
        productData.attributes = { ...(productData.attributes || {}), ...extras };
      }
      return productData;
    }

    function mergeProductData(base: Record<string, any>, overlay: Record<string, any>): Record<string, any> {
      const result = { ...base };
      for (const [key, val] of Object.entries(overlay)) {
        if (val === undefined || val === null || val === "") continue;
        const existing = result[key];
        if (existing === undefined || existing === null || existing === "") {
          result[key] = val;
        } else if (Array.isArray(existing) && Array.isArray(val)) {
          result[key] = [...new Set([...existing, ...val])];
        } else if (typeof existing === "object" && typeof val === "object" && !Array.isArray(existing)) {
          result[key] = { ...existing, ...val };
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
    // and also do a secondary check if needed, but usually SKUs should be normalized.
    const { data: existingProductsList } = await supabase
      .from("products")
      .select("id, sku")
      .eq("workspace_id", workspaceId)
      .in("sku", allSkus);

    const existingProductsMap = new Map<string, string>();
    existingProductsList?.forEach(p => {
      if (p.sku) existingProductsMap.set(p.sku.toUpperCase(), p.id);
    });

    // To handle case-insensitivity for those not found by exact match:
    // If we have many missing, we could do more, but for now this is much better than before.

    const itemsToUpdateStatus: { id: string, status: string, product_id?: string, error_message?: string }[] = [];

    // Process SKU Groups in batches
    for (let i = 0; i < skuEntries.length; i += BATCH_SIZE) {
      const batch = skuEntries.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async ([sku, groupItems]) => {
        try {
          let mergedData: Record<string, any> = {};
          for (const item of groupItems) {
            const mapped = item.mapped_data || item.source_data || {};
            const pd = buildProductData(mapped);
            mergedData = mergeProductData(mergedData, pd);
          }
          mergedData.sku = sku;

          const normalizedSku = sku.toUpperCase();
          let existingId = existingProductsMap.get(normalizedSku);
          
          // Fallback check for case-insensitivity if not found in the initial IN query
          if (!existingId) {
            const { data: fallback } = await supabase
              .from("products")
              .select("id")
              .eq("workspace_id", workspaceId)
              .ilike("sku", sku)
              .limit(1)
              .maybeSingle();
            if (fallback) {
              existingId = fallback.id;
              existingProductsMap.set(normalizedSku, existingId);
            }
          }

          let productId: string | null = null;

          if (existingId) {
            const { error: updateErr } = await supabase
              .from("products")
              .update({ ...mergedData, updated_at: new Date().toISOString() })
              .eq("id", existingId);
            if (updateErr) throw updateErr;
            productId = existingId;
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

          groupItems.forEach(gi => {
            itemsToUpdateStatus.push({ id: gi.id, status: "processed", product_id: productId! });
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
          const productData = buildProductData(mapped);
          
          if (item.matched_existing_id) {
            const { error: updateErr } = await supabase
              .from("products")
              .update({ ...productData, updated_at: new Date().toISOString() })
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