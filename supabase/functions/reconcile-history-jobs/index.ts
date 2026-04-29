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
  
  // Handle arrays (like image_urls)
  if (Array.isArray(val1) && Array.isArray(val2)) {
    return val1.length !== val2.length || val1.some((v, i) => v !== val2[i]);
  }
  
  return String(val1 || '').trim() !== String(val2 || '').trim();
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

    // Fetch workspace info from the delta job if not provided
    const { data: deltaJob } = await supabase
      .from("ingestion_jobs")
      .select("workspace_id, supplier_id")
      .eq("id", deltaJobId)
      .single();

    const finalWorkspaceId = workspaceId || deltaJob?.workspace_id;
    if (!finalWorkspaceId) throw new Error("Could not determine workspaceId");
    
    const supplierId = deltaJob?.supplier_id;

    console.log(`Starting history reconciliation: Master=${masterJobId}, Delta=${deltaJobId}, Workspace=${finalWorkspaceId}`);

    // 1. Fetch Delta Items
    const { data: deltaItems, error: deltaErr } = await supabase
      .from("ingestion_job_items")
      .select("*")
      .eq("job_id", deltaJobId)
      .limit(10000);

    if (deltaErr) throw deltaErr;

    // 2. Fetch Master Items
    const { data: masterItems, error: masterErr } = await supabase
      .from("ingestion_job_items")
      .select("*")
      .eq("job_id", masterJobId)
      .limit(10000);

    if (masterErr) throw masterErr;

    // 3. Map Master items by SKU
    const masterMap = new Map<string, any>();
    masterItems.forEach(item => {
      const mapped = item.mapped_data || {};
      const source = item.source_data || {};
      const rawSku = mapped.sku || source.sku || mapped.Codigo || source.Codigo || mapped.Ref || source.Ref || "";
      const sku = normalizeSKU(rawSku);
      if (sku) masterMap.set(sku, item);
    });

    // 4. Clear old staging for this delta job (now redundant due to migration clearing it, but good practice)
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

        // Determine Change Type
        const priceDiff = areValuesDifferent(mappedData.price || mappedData.Preço || mappedData.Publico, masterMapped.price || masterMapped.Preço || masterMapped.Publico);
        
        const fieldsToCompare = ['name', 'description', 'category', 'brand', 'image_urls', 'status'];
        let fieldsDiff = false;
        for (const field of fieldsToCompare) {
          if (areValuesDifferent(mappedData[field], masterMapped[field])) {
            // Special rule: Category and Brand from site_wins don't count as "field_update" if they match the site
            if ((field === 'category' || field === 'brand') && !mappedData[field]) {
              continue; // If delta has no brand/category, we preserve site, so not a "field update" from delta's perspective
            }
            fieldsDiff = true;
            break;
          }
        }

        if (priceDiff && fieldsDiff) changeType = "multiple_changes";
        else if (priceDiff) changeType = "price_change";
        else if (fieldsDiff) changeType = "field_update";
        else changeType = "none"; // No changes detected
      }

      // Skip records with no changes to keep staging lean (optional, but requested implicitly by "only show what to do")
      if (changeType === "none" && masterItem) continue;

      // Prepare proposed changes with "Site Wins" for Category and Brand
      const proposedChanges = {
        ...mappedData,
        is_discontinued: false,
        // PRESERVATION RULE: Category and Brand from Master (Site) always win if they exist
        category: masterMapped.category || masterMapped.Categoria || mappedData.category || mappedData.Categoria,
        brand: masterMapped.brand || masterMapped.Marca || mappedData.brand || mappedData.Marca,
        original_description: mappedData.original_description || mappedData.Descrição || sourceData.Descrição
      };

      stagingRecords.push({
        workspace_id: finalWorkspaceId,
        ingestion_job_id: deltaJobId,
        supplier_id: supplierId,
        sku_supplier: rawSku || normalizedSku,
        sku_site_target: masterMapped.sku || null,
        confidence_score: confidence,
        match_method: matchMethod,
        supplier_data: mappedData,
        proposed_changes: proposedChanges,
        site_data: masterItem ? masterMapped : null,
        existing_product_id: masterItem?.product_id || null,
        status: confidence >= 80 ? "pending" : "flagged",
        change_type: changeType
      });
    }

    // 6. Identify Discontinued (In Master but NOT in Delta)
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
          status: "pending", // Mark as pending so it shows up
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
