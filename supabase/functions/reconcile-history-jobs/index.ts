import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizeSKU = (sku: string): string => {
  if (!sku) return "";
  let normalized = sku.trim().toUpperCase();
  normalized = normalized.replace(/[/\\]/g, "-");
  normalized = normalized.replace(/^0+/, "");
  return normalized || "0";
};

const areValuesDifferent = (val1: any, val2: any): boolean => {
  if (val1 === val2) return false;
  if (!val1 && !val2) return false;
  
  // Handle numbers with small precision differences
  if (typeof val1 === 'number' && typeof val2 === 'number') {
    return Math.abs(val1 - val2) > 0.001;
  }
  
  // Handle strings that look like numbers
  const n1 = parseFloat(String(val1).replace(',', '.'));
  const n2 = parseFloat(String(val2).replace(',', '.'));
  if (!isNaN(n1) && !isNaN(n2)) {
    return Math.abs(n1 - n2) > 0.001;
  }
  
  // Handle arrays (like image_urls)
  if (Array.isArray(val1) && Array.isArray(val2)) {
    return val1.length !== val2.length || val1.some((v, i) => v !== val2[i]);
  }
  
  return String(val1 || '').trim() !== String(val2 || '').trim();
};

const ensureArray = (val: any): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    if (val.startsWith('[') && val.endsWith(']')) {
      try { return JSON.parse(val); } catch (e) { return [val]; }
    }
    return val.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [String(val)];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { masterJobId, deltaJobId, workspaceId } = body;

    if (!masterJobId || !deltaJobId) throw new Error("masterJobId and deltaJobId are required");

    // Fetch Job Config and Field Mappings
    const { data: deltaJob } = await supabase
      .from("ingestion_jobs")
      .select("workspace_id, supplier_id, config")
      .eq("id", deltaJobId)
      .single();

    const finalWorkspaceId = workspaceId || deltaJob?.workspace_id;
    if (!finalWorkspaceId) throw new Error("Could not determine workspaceId");
    
    const supplierId = deltaJob?.supplier_id;
    const config = deltaJob?.config || {};
    const fieldMappings = config.fieldMappings || {};
    
    // Reverse mapping to find target fields easily
    const targetFields = Object.values(fieldMappings);
    const hasPriceMapping = targetFields.includes('original_price');

    console.log(`Starting history reconciliation: Master=${masterJobId}, Delta=${deltaJobId}, Workspace=${finalWorkspaceId}`);

    // 1. Fetch Delta Items (Paginated to handle large jobs)
    console.log(`Fetching items for Delta job: ${deltaJobId}`);
    let deltaItems: any[] = [];
    let hasMoreDelta = true;
    let deltaOffset = 0;
    const BATCH_SIZE = 1000; // Reduced batch size to stay under PostgREST limits

    while (hasMoreDelta) {
      const { data, error } = await supabase
        .from("ingestion_job_items")
        .select("*")
        .eq("job_id", deltaJobId)
        .range(deltaOffset, deltaOffset + BATCH_SIZE - 1);

      if (error) throw error;
      if (data && data.length > 0) {
        deltaItems = [...deltaItems, ...data];
        deltaOffset += BATCH_SIZE;
        if (data.length < BATCH_SIZE) hasMoreDelta = false;
      } else {
        hasMoreDelta = false;
      }
    }
    console.log(`Fetched ${deltaItems.length} items for Delta job`);

    // 2. Fetch Master Items (Paginated)
    console.log(`Fetching items for Master job: ${masterJobId}`);
    let masterItems: any[] = [];
    let hasMoreMaster = true;
    let masterOffset = 0;

    while (hasMoreMaster) {
      const { data, error } = await supabase
        .from("ingestion_job_items")
        .select("*")
        .eq("job_id", masterJobId)
        .range(masterOffset, masterOffset + BATCH_SIZE - 1);

      if (error) throw error;
      if (data && data.length > 0) {
        masterItems = [...masterItems, ...data];
        masterOffset += BATCH_SIZE;
        if (data.length < BATCH_SIZE) hasMoreMaster = false;
      } else {
        hasMoreMaster = false;
      }
    }
    console.log(`Fetched ${masterItems.length} items for Master job`);

    // 3. Map Master items by SKU
    const masterMap = new Map<string, any>();
    masterItems.forEach(item => {
      const mapped = item.mapped_data || {};
      const source = item.source_data || {};
      const rawSku = mapped.sku || source.sku || mapped.Codigo || source.Codigo || mapped.Ref || source.Ref || "";
      const sku = normalizeSKU(rawSku);
      if (sku) masterMap.set(sku, item);
    });

    // 4. Clear old staging for this delta job
    await supabase.from("sync_staging").delete().eq("ingestion_job_id", deltaJobId);

    // 5. Process Delta against Master
    const stagingRecords = [];
    const processedSkusInDelta = new Set<string>();

    for (const deltaItem of deltaItems) {
      const mappedData = deltaItem.mapped_data || {};
      const sourceData = deltaItem.source_data || {};
      
      const rawSku = mappedData.sku || sourceData.sku || mappedData.Codigo || sourceData.Codigo || mappedData.Ref || sourceData.Ref || "";
      const normalizedSku = normalizeSKU(rawSku);
      
      if (normalizedSku) {
        processedSkusInDelta.add(normalizedSku);
      }

      const masterItem = normalizedSku ? masterMap.get(normalizedSku) : null;
      const masterMapped = masterItem?.mapped_data || masterItem?.source_data || {};

      let changeType = "new_product";
      let confidence = 0;
      let matchMethod = "none";

      if (masterItem) {
        confidence = 100;
        matchMethod = "exact";

        // Determine Change Type based ONLY on mapped fields
        let priceDiff = false;
        if (hasPriceMapping) {
          const sPrice = mappedData.original_price;
          const mPrice = masterMapped.original_price;
          priceDiff = areValuesDifferent(sPrice, mPrice);
        }
        
        // Fields to compare (only if mapped)
        const possibleFields = ['original_title', 'original_description', 'short_description', 'category', 'brand', 'image_urls', 'status'];
        const fieldsToCompare = possibleFields.filter(f => targetFields.includes(f));
        
        let fieldsDiff = false;
        for (const field of fieldsToCompare) {
          // Special rule: if it's a text field we protect, we check if supplier value is different from site value
          // even if we won't overwrite it in proposed_changes
          if (areValuesDifferent(mappedData[field], masterMapped[field])) {
            if ((field === 'category' || field === 'brand') && !mappedData[field]) {
              continue;
            }
            fieldsDiff = true;
            break;
          }
        }

        if (priceDiff && fieldsDiff) changeType = "multiple_changes";
        else if (priceDiff) changeType = "price_change";
        else if (fieldsDiff) changeType = "field_update";
        else changeType = "none";
      }

      if (changeType === "none" && masterItem) continue;

      // Prepare proposed changes
      const proposedChanges: any = {
        is_discontinued: false
      };

      // Only include mapped fields in proposed_changes
      targetFields.forEach((field: any) => {
        if (mappedData[field] !== undefined) {
          proposedChanges[field] = mappedData[field];
        }
      });

      // PRESERVATION RULE: Workable text fields from Master always win
      // We move supplier data to specific fields for reference
      const textFields = ['original_title', 'original_description', 'short_description'];
      textFields.forEach(field => {
        if (masterItem && masterMapped[field]) {
          // Keep master value
          proposedChanges[field] = masterMapped[field];
          // Move supplier value to a reference field
          const refField = field === 'original_title' ? 'supplier_title' : 
                          field === 'original_description' ? 'supplier_description' : 'supplier_short_description';
          proposedChanges[refField] = mappedData[field];
        }
      });

      // Special rule for Category and Brand preservation
      if (masterItem) {
        if (masterMapped.category) proposedChanges.category = masterMapped.category;
        if (masterMapped.brand) proposedChanges.brand = masterMapped.brand;
      }

      // Ensure images are arrays
      if (proposedChanges.image_urls) {
        proposedChanges.image_urls = ensureArray(proposedChanges.image_urls);
      }

      // Fallback supplier name from config if supplier_id is missing
      const supplierName = config.defaultBrand || "Desconhecido";

      stagingRecords.push({
        workspace_id: finalWorkspaceId,
        ingestion_job_id: deltaJobId,
        supplier_id: supplierId,
        sku_supplier: rawSku || normalizedSku,
        sku_site_target: masterMapped.sku || null,
        confidence_score: confidence,
        match_method: matchMethod,
        supplier_data: { 
          ...mappedData,
          supplier_name: supplierName // Injecting for UI display
        },
        proposed_changes: {
          ...proposedChanges,
          supplier_name: supplierName
        },
        site_data: masterItem ? masterMapped : null,
        existing_product_id: masterItem?.product_id || null,
        status: confidence >= 80 ? "pending" : "flagged",
        change_type: changeType,
      });
    }

    // 6. Identify Discontinued
    for (const [sku, masterItem] of masterMap.entries()) {
      if (!processedSkusInDelta.has(sku)) {
        const masterMapped = masterItem.mapped_data || masterItem.source_data || {};
        stagingRecords.push({
          workspace_id: finalWorkspaceId,
          ingestion_job_id: deltaJobId,
          supplier_id: supplierId,
          sku_supplier: sku,
          sku_site_target: masterMapped.sku || sku,
          confidence_score: 100,
          match_method: "manual",
          supplier_data: {},
          proposed_changes: { 
            is_discontinued: true,
            stock: 0,
            status: 'needs_review'
          },
          site_data: masterMapped,
          existing_product_id: masterItem.product_id || null,
          status: "pending",
          change_type: "discontinued"
        });
      }
    }

    // 7. Batch insert staging records
    for (let i = 0; i < stagingRecords.length; i += 500) {
      const chunk = stagingRecords.slice(i, i + 500);
      const { error: insertErr } = await supabase
        .from("sync_staging")
        .insert(chunk);
      if (insertErr) throw insertErr;
      console.log(`Inserido lote ${Math.floor(i / 500) + 1} de ${Math.ceil(stagingRecords.length / 500)} em sync_staging`);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: stagingRecords.length,
      newItems: stagingRecords.filter(r => r.change_type === 'new_product').length,
      discontinued: stagingRecords.filter(r => r.change_type === 'discontinued').length,
      priceChanges: stagingRecords.filter(r => r.change_type === 'price_change').length,
      fieldUpdates: stagingRecords.filter(r => r.change_type === 'field_update').length,
      multipleChanges: stagingRecords.filter(r => r.change_type === 'multiple_changes').length
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
