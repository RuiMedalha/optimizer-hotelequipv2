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

    // Get user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const { workspaceId, sourceId, data, masterData, fileName, sourceType, fieldMappings, mergeStrategy, duplicateDetectionFields, groupingConfig, mode, skuPrefix, sourceLanguage, role, supplierId, defaultBrand, autoModelFromSku } = body;

    if (!workspaceId) throw new Error("workspaceId required");
    if (!data && !fileName) throw new Error("data or fileName required");

    const detectedType = sourceType || "csv";
    const strategy = mergeStrategy || "merge";
    const dupFields = duplicateDetectionFields || ["sku"];
    const mappings = fieldMappings || {};
    const groupCfg = groupingConfig || {};
    const jobMode = mode || "dry_run";

    // Parse rows - data should already be an array of objects from frontend parsing
    let rows: Record<string, any>[] = [];
    if (Array.isArray(data)) {
      rows = data;
    } else if (typeof data === "object" && data !== null) {
      rows = [data];
    }

    if (rows.length === 0) throw new Error("No data rows to process");

    // Create ingestion job
    const { data: job, error: jobError } = await supabase
      .from("ingestion_jobs")
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        source_id: sourceId || null,
        source_type: detectedType,
        file_name: fileName || null,
        status: "parsing",
        mode: jobMode,
        merge_strategy: strategy,
        total_rows: rows.length,
        role: role || null,
        supplier_id: supplierId || null,
        started_at: new Date().toISOString(),
        config: {
          fieldMappings: mappings,
          mergeStrategy: strategy,
          duplicateDetectionFields: dupFields,
          skuPrefix: skuPrefix || null,
          defaultBrand: defaultBrand || null,
          autoModelFromSku: autoModelFromSku || false,
          sourceLanguage: sourceLanguage || "auto",
          role: role || null,
          groupingConfig: groupCfg
        }
      })
      .select("id")
      .single();

    if (jobError) throw jobError;
    const jobId = job.id;

    // Apply field mappings & SKU Prefix
    const mapRow = (row: Record<string, any>): Record<string, any> => {
      const mappings = fieldMappings || {};
      const mapped: Record<string, any> = {};
      
      // Create a normalized version of row keys for safer lookup (case-insensitive and trimmed)
      const normalizedRow: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        normalizedRow[k.trim().toLowerCase()] = v;
      }
      
      if (mappings && Object.keys(mappings).length > 0) {
        // Map based on target keys
        for (const [sourceKey, targetKey] of Object.entries(mappings)) {
          const lowerSourceKey = sourceKey.trim().toLowerCase();
          if (normalizedRow[lowerSourceKey] !== undefined && typeof targetKey === "string") {
            mapped[targetKey] = normalizedRow[lowerSourceKey];
          }
        }
        
        // Keep unmapped fields (original names)
        for (const [key, val] of Object.entries(row)) {
          const trimmedKey = key.trim();
          const alreadyMapped = Object.keys(mappings).some(mk => mk.trim().toLowerCase() === trimmedKey.toLowerCase());
          if (!alreadyMapped) mapped[trimmedKey] = val;
        }
      } else {
        Object.assign(mapped, row);
      }

      // ─── Apply SKU Prefix & Auto Model ───
      const targetSkuKey = Object.entries(mappings).find(([_, v]) => v === "sku")?.[1] || "sku";
      let sku = mapped[targetSkuKey];
      let prePrefixSku = sku;
      
      if (skuPrefix && sku) {
        const prefixStr = String(skuPrefix).trim();
        const skuStr = String(sku).trim();
        const alreadyHasPrefix = skuStr.toUpperCase().startsWith(prefixStr.toUpperCase());
        
        if (!alreadyHasPrefix) {
          mapped[targetSkuKey] = `${prefixStr}${skuStr}`;
          sku = mapped[targetSkuKey];
        } else {
          // If it already has the prefix, the pre-prefix SKU is the part after the prefix
          prePrefixSku = skuStr.substring(prefixStr.length);
        }
      }

      if (autoModelFromSku && sku) {
        // Use SKU without prefix as model if enabled
        const targetModelKey = Object.entries(mappings).find(([_, v]) => v === "model")?.[1] || "model";
        if (!mapped[targetModelKey]) {
          mapped[targetModelKey] = prePrefixSku;
        }
      }

      // ─── Apply Default Brand ───
      if (defaultBrand) {
        const targetBrandKey = Object.entries(mappings).find(([_, v]) => v === "brand")?.[1] || "brand";
        if (!mapped[targetBrandKey]) {
          mapped[targetBrandKey] = defaultBrand;
        }
      }

      return mapped;
    };

    // Duplicate detection - Fetch ALL existing products to avoid 1000 limit
    const existingProducts: Record<string, string> = {};
    if (dupFields.length > 0) {
      console.log(`Checking duplicates for fields: ${dupFields.join(", ")}`);
      let hasMore = true;
      let offset = 0;
      const pageSize = 5000;
      const MAX_SEARCH_LIMIT = 200000; // Increase to 200k to ensure we find all existing products

      while (hasMore && offset < MAX_SEARCH_LIMIT) {
        const { data: existing, error: fetchError } = await supabase
          .from("products")
          .select("id, sku, original_title")
          .eq("workspace_id", workspaceId)
          .range(offset, offset + pageSize - 1);

        if (fetchError) throw fetchError;

        if (existing && existing.length > 0) {
          for (const p of existing) {
            for (const field of dupFields) {
              const val = (p as any)[field];
              if (val) existingProducts[`${field}:${String(val).trim().toLowerCase()}`] = p.id;
            }
          }
          offset += pageSize;
          if (existing.length < pageSize) hasMore = false;
        } else {
          hasMore = false;
        }
      }
      console.log(`Loaded ${Object.keys(existingProducts).length} duplicate keys for comparison`);
    }

    // Grouping
    const parentKeyField = groupCfg.parent_key_field;
    const groupMap = new Map<string, number[]>();

    // Create job items
    const items = rows.map((row, idx) => {
      const mapped = mapRow(row);
      
      // Clean numeric values (price, stock)
      ["original_price", "sale_price", "stock", "weight"].forEach(field => {
        if (mapped[field]) {
          const val = String(mapped[field]).replace(/[^\d.,-]/g, '').replace(',', '.');
          mapped[field] = parseFloat(val) || 0;
        }
      });

      // Match logic
      let matchedId: string | null = null;
      let matchedMasterRow: any = null;
      let matchConf = 0;

      // If we have masterData (Delta Mode), try to find the product in the master file first
      if (masterData && Array.isArray(masterData)) {
        for (const masterRow of masterData) {
          const masterSku = String(masterRow.sku || masterRow.SKU || masterRow.reference || "").trim().toLowerCase();
          const targetSku = String(mapped.sku || "").trim().toLowerCase();
          
          if (masterSku && targetSku && masterSku === targetSku) {
            matchedMasterRow = masterRow;
            matchConf = 100;
            break;
          }
        }
      }

      // Fallback to database lookup for duplicates
      if (!matchedMasterRow) {
        for (const field of dupFields) {
          const val = mapped[field] || mapped[`original_${field}`];
          if (val) {
            const valStr = String(val).trim().toLowerCase();
            const key = `${field}:${valStr}`;
            if (existingProducts[key]) {
              matchedId = existingProducts[key];
              matchConf = field === "sku" ? 100 : 70;
              break;
            }
          }
        }
      }

      // Determine action
      let action: string;
      if (role === "supplier_delta") {
        action = "staging"; // Force staging for reconciliation mode
      } else if (matchedId || matchedMasterRow) {
        if (strategy === "insert_only") action = "skip";
        else if (strategy === "update_only") action = "update";
        else action = "merge";
      } else {
        if (strategy === "update_only") action = "skip";
        else action = "insert";
      }

      // Grouping
      let parentGroupKey: string | null = null;
      let isParent = false;
      if (parentKeyField && mapped[parentKeyField]) {
        parentGroupKey = String(mapped[parentKeyField]).trim().toLowerCase();
        if (!groupMap.has(parentGroupKey)) {
          groupMap.set(parentGroupKey, []);
          isParent = true;
        }
        groupMap.get(parentGroupKey)!.push(idx);
      }

      return {
        job_id: jobId,
        status: "mapped" as const,
        source_row_index: idx,
        source_data: row,
        mapped_data: mapped,
        matched_existing_id: matchedId,
        match_confidence: matchConf,
        action,
        parent_group_key: parentGroupKey,
        is_parent: isParent,
        grouping_confidence: parentGroupKey ? 80 : null,
      };
    });

    // Batch insert items (chunks of 500) with improved logging and persistence
    const batchSize = 500;
    let successfullyInserted = 0;
    
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      try {
        const { error: itemError } = await supabase
          .from("ingestion_job_items")
          .insert(chunk);
          
        if (itemError) {
          console.error(`Error inserting batch starting at index ${i}:`, itemError.message);
          // We continue to next batch instead of aborting
        } else {
          successfullyInserted += chunk.length;
          console.log(`Lote ${Math.floor(i / batchSize) + 1} de ${Math.ceil(items.length / batchSize)} inserido (${successfullyInserted} registos total)`);
        }
      } catch (err) {
        console.error(`Unexpected error in batch ${i}:`, err);
      }
    }

    // Verify if all rows were saved
    const isComplete = successfullyInserted === items.length;
    if (!isComplete) {
      console.warn(`Job ${jobId} incomplete: ${successfullyInserted}/${items.length} rows saved.`);
    }

    // Compute stats
    const inserts = items.filter(i => i.action === "insert").length;
    const updates = items.filter(i => i.action === "update" || i.action === "merge").length;
    const skips = items.filter(i => i.action === "skip").length;
    const duplicates = items.filter(i => i.matched_existing_id).length;

    // Groups
    const groups = Array.from(groupMap.entries())
      .filter(([, idxs]) => idxs.length > 1)
      .map(([key, idxs]) => ({ key, count: idxs.length }));

    // Update job status
    const finalStatus = isComplete 
      ? (jobMode === "dry_run" ? "dry_run" : "mapping")
      : "incomplete";

    await supabase
      .from("ingestion_jobs")
      .update({
        status: finalStatus,
        parsed_rows: successfullyInserted,
        duplicate_rows: duplicates,
        merge_strategy: strategy,
        results: { 
          inserts, 
          updates, 
          skips, 
          duplicates, 
          groups, 
          sourceLanguage: sourceLanguage || "auto",
          total_attempted: items.length,
          total_saved: successfullyInserted
        },
        ...(jobMode === "dry_run" && isComplete ? { completed_at: new Date().toISOString() } : {}),
      })
      .eq("id", jobId);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      totalRows: rows.length,
      inserts,
      updates,
      skips,
      duplicates,
      groups,
      mode: jobMode,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
