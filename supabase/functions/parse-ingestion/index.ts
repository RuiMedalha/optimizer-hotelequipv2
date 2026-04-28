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
    const { workspaceId, sourceId, data, fileName, sourceType, fieldMappings, mergeStrategy, duplicateDetectionFields, groupingConfig, mode, skuPrefix, sourceLanguage, role, supplierId } = body;

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
      
      // Create a normalized version of row keys for safer lookup
      const normalizedRow: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        normalizedRow[k.trim()] = v;
      }
      
      if (mappings && Object.keys(mappings).length > 0) {
        for (const [sourceKey, targetKey] of Object.entries(mappings)) {
          const trimmedSourceKey = sourceKey.trim();
          if (normalizedRow[trimmedSourceKey] !== undefined && typeof targetKey === "string") {
            mapped[targetKey] = normalizedRow[trimmedSourceKey];
          }
        }
        // Keep unmapped fields (original names)
        for (const [key, val] of Object.entries(row)) {
          if (!mappings[key]) mapped[key] = val;
        }
      } else {
        Object.assign(mapped, row);
      }

      // ─── Apply SKU Prefix ───
      const targetSkuKey = Object.entries(mappings).find(([_, v]) => v === "sku")?.[1] || "sku";
      let sku = mapped[targetSkuKey];
      
      if (skuPrefix && sku) {
        const prefixStr = String(skuPrefix).trim();
        const skuStr = String(sku).trim();
        
        // If it starts with the prefix AND has a separator, skip.
        // Otherwise, if it's just a string prefix like "CH" and the ref is "CH350", 
        // we should probably prepend it to get "CHCH350" which is the user's convention.
        const hasSeparator = /[-_:\s]/.test(prefixStr);
        const alreadyHasPrefix = skuStr.toUpperCase().startsWith(prefixStr.toUpperCase());
        
        if (hasSeparator) {
          if (!alreadyHasPrefix) {
            mapped[targetSkuKey] = `${prefixStr}${skuStr}`;
          }
        } else {
          // If no separator, and user explicitly provided a prefix, 
          // we only skip if it already has the prefix TWICE (to prevent infinite growth)
          // or if it matches some other safety criteria.
          // For now, let's be more permissive: if the user provided a prefix, prepend it.
          // To avoid CHCHCH350, we check if it already starts with (prefix + prefix)
          const doublePrefix = (prefixStr + prefixStr).toUpperCase();
          if (!skuStr.toUpperCase().startsWith(doublePrefix)) {
            mapped[targetSkuKey] = `${prefixStr}${skuStr}`;
          }
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
      const pageSize = 1000;

      while (hasMore) {
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

      // Check duplicates
      let matchedId: string | null = null;
      let matchConf = 0;
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

          // Smart matching: if SKU didn't match, try without the prefix we just added
          if (field === "sku" && skuPrefix) {
            const prefixLower = String(skuPrefix).trim().toLowerCase();
            if (valStr.startsWith(prefixLower)) {
              const withoutPrefix = valStr.substring(prefixLower.length);
              const altKey = `${field}:${withoutPrefix}`;
              if (existingProducts[altKey]) {
                matchedId = existingProducts[altKey];
                matchConf = 95; // High confidence match without the prefix
                break;
              }
            }
          }
        }
      }

      // Determine action
      let action: string;
      if (matchedId) {
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

    // Batch insert items (chunks of 500)
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      const { error: itemError } = await supabase
        .from("ingestion_job_items")
        .insert(chunk);
      if (itemError) throw itemError;
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
    const finalStatus = jobMode === "dry_run" ? "dry_run" : "mapping";
    await supabase
      .from("ingestion_jobs")
      .update({
        status: finalStatus,
        parsed_rows: rows.length,
        duplicate_rows: duplicates,
        merge_strategy: strategy,
        results: { inserts, updates, skips, duplicates, groups, sourceLanguage: sourceLanguage || "auto" },
        ...(jobMode === "dry_run" ? { completed_at: new Date().toISOString() } : {}),
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
