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
    const strategy = job.merge_strategy || "merge";

    // Update status to importing
    await supabase.from("ingestion_jobs").update({
      status: "importing",
      mode: "live",
      started_at: new Date().toISOString(),
    }).eq("id", jobId);

    // Load items
    const { data: items, error: itemsErr } = await supabase
      .from("ingestion_job_items")
      .select("*")
      .eq("job_id", jobId)
      .order("source_row_index", { ascending: true });

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) throw new Error("No items to process");

    // ─── SKU Grouping: merge items with same SKU ───
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
      // Extra fields → attributes
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

    // Deep merge: later values fill in blanks, arrays are concatenated & deduped
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
        // If base already has a non-empty value, keep it (first-wins for scalar)
      }
      return result;
    }

    // Group items by SKU
    const skuGroups = new Map<string, typeof items>();
    const noSkuItems: typeof items = [];

    for (const item of items) {
      const mapped = item.mapped_data || item.source_data || {};
      const action = item.action;
      if (action === "skip" || action === "duplicate") {
        continue; // handled later
      }
      const sku = (mapped.sku || "").toString().trim().toUpperCase();
      if (sku) {
        if (!skuGroups.has(sku)) skuGroups.set(sku, []);
        skuGroups.get(sku)!.push(item);
      } else {
        noSkuItems.push(item);
      }
    }

    let imported = 0, updated = 0, skipped = 0, failed = 0;

    // Handle skipped/duplicate items first
    for (const item of items) {
      if (item.action === "skip" || item.action === "duplicate") {
        await supabase.from("ingestion_job_items").update({ status: "skipped" }).eq("id", item.id);
        skipped++;
      }
    }

    // Process each SKU group (merge all items with same SKU into one product)
    for (const [sku, groupItems] of skuGroups.entries()) {
      try {
        // Build merged product data from all items with this SKU
        let mergedData: Record<string, any> = {};
        for (const item of groupItems) {
          const mapped = item.mapped_data || item.source_data || {};
          const pd = buildProductData(mapped);
          mergedData = mergeProductData(mergedData, pd);
        }
        mergedData.sku = sku;

        // Check if product with this SKU already exists in workspace
        const { data: existingProducts } = await supabase
          .from("products")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", user.id)
          .ilike("sku", sku)
          .limit(1);

        let productId: string | null = null;

        if (existingProducts && existingProducts.length > 0) {
          // Update existing product
          const updateData = { ...mergedData };
          delete updateData.workspace_id;
          delete updateData.user_id;
          const { error: updateErr } = await supabase
            .from("products")
            .update(updateData)
            .eq("id", existingProducts[0].id);
          if (updateErr) throw updateErr;
          productId = existingProducts[0].id;
          updated++;
        } else {
          // Insert new product
          const { data: newProduct, error: insertErr } = await supabase
            .from("products")
            .insert({
              ...mergedData,
              workspace_id: workspaceId,
              user_id: user.id,
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          productId = newProduct.id;
          imported++;
        }

        // Mark all group items as processed
        for (const item of groupItems) {
          await supabase.from("ingestion_job_items").update({
            status: "processed",
            product_id: productId,
          }).eq("id", item.id);
        }
      } catch (err: unknown) {
        failed++;
        for (const item of groupItems) {
          await supabase.from("ingestion_job_items").update({
            status: "error",
            error_message: (err as Error).message,
          }).eq("id", item.id);
        }
      }
    }

    // Process items without SKU individually
    for (const item of noSkuItems) {
      try {
        const mapped = item.mapped_data || item.source_data || {};
        const productData = buildProductData(mapped);

        if ((item.action === "update" || item.action === "merge") && item.matched_existing_id) {
          const updateData = { ...productData };
          const { error: updateErr } = await supabase
            .from("products")
            .update(updateData)
            .eq("id", item.matched_existing_id);
          if (updateErr) throw updateErr;
          await supabase.from("ingestion_job_items").update({
            status: "processed",
            product_id: item.matched_existing_id,
          }).eq("id", item.id);
          updated++;
        } else {
          const { data: newProduct, error: insertErr } = await supabase
            .from("products")
            .insert({
              ...productData,
              workspace_id: workspaceId,
              user_id: user.id,
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          await supabase.from("ingestion_job_items").update({
            status: "processed",
            product_id: newProduct.id,
          }).eq("id", item.id);
          imported++;
        }
      } catch (err: unknown) {
        failed++;
        await supabase.from("ingestion_job_items").update({
          status: "error",
          error_message: (err as Error).message,
        }).eq("id", item.id);
      }
    }

    // Complete job
    await supabase.from("ingestion_jobs").update({
      status: "done",
      imported_rows: imported,
      updated_rows: updated,
      skipped_rows: skipped,
      failed_rows: failed,
      completed_at: new Date().toISOString(),
      results: { imported, updated, skipped, failed, skuGroupsMerged: skuGroups.size },
    }).eq("id", jobId);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      imported,
      updated,
      skipped,
      failed,
      skuGroupsMerged: skuGroups.size,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
