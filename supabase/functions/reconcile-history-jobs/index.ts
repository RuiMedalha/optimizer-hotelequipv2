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

    console.log(`Starting history reconciliation: Master=${masterJobId}, Delta=${deltaJobId}`);

    // 1. Fetch Delta Items (the source of truth for updates/new products)
    const { data: deltaItems, error: deltaErr } = await supabase
      .from("ingestion_job_items")
      .select("*")
      .eq("job_id", deltaJobId)
      .limit(10000);

    if (deltaErr) throw deltaErr;

    // 2. Fetch Master Items (the source of truth for what currently exists)
    const { data: masterItems, error: masterErr } = await supabase
      .from("ingestion_job_items")
      .select("*")
      .eq("job_id", masterJobId)
      .limit(10000);

    if (masterErr) throw masterErr;

    // 3. Map Master items by SKU for fast lookup
    const masterMap = new Map<string, any>();
    masterItems.forEach(item => {
      const sku = normalizeSKU(item.mapped_data?.sku || item.source_data?.sku || "");
      if (sku) masterMap.set(sku, item);
    });

    // 4. Clear old staging for this delta job
    await supabase.from("sync_staging").delete().eq("ingestion_job_id", deltaJobId);

    // 5. Process Delta against Master
    const stagingRecords = [];
    const processedSkusInDelta = new Set<string>();

    for (const deltaItem of deltaItems) {
      const rawSku = deltaItem.mapped_data?.sku || deltaItem.source_data?.sku || "";
      const normalizedSku = normalizeSKU(rawSku);
      processedSkusInDelta.add(normalizedSku);

      const mappedData = deltaItem.mapped_data || deltaItem.source_data || {};
      const masterItem = masterMap.get(normalizedSku);

      let confidence = 0;
      let matchMethod = "none";

      if (masterItem) {
        confidence = 100;
        matchMethod = "exact";
      }

      stagingRecords.push({
        workspace_id: workspaceId,
        ingestion_job_id: deltaJobId,
        supplier_id: null, // Could be fetched from job if needed
        sku_supplier: rawSku,
        sku_site_target: masterItem?.mapped_data?.sku || null,
        confidence_score: confidence,
        match_method: matchMethod,
        supplier_data: mappedData,
        proposed_changes: {
          ...mappedData,
          category: mappedData.category || mappedData.Categoria,
          brand: mappedData.brand || mappedData.Marca,
          original_description: mappedData.original_description || mappedData.Descrição
        },
        site_data: masterItem?.mapped_data || masterItem?.source_data || null,
        existing_product_id: null, // Would need database lookup to be 100% sure, but Master file is the focus here
        status: confidence >= 80 ? "pending" : "flagged",
      });
    }

    // 6. Identify Discontinued (In Master but NOT in Delta)
    for (const [sku, masterItem] of masterMap.entries()) {
      if (!processedSkusInDelta.has(sku)) {
        stagingRecords.push({
          workspace_id: workspaceId,
          ingestion_job_id: deltaJobId,
          sku_supplier: sku,
          sku_site_target: sku,
          confidence_score: 100,
          match_method: "manual",
          supplier_data: {}, // Fix: Column violates not-null constraint if null
          proposed_changes: { is_discontinued: true },
          site_data: masterItem.mapped_data || masterItem.source_data,
          status: "flagged",
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
      newItems: deltaItems.length,
      discontinued: stagingRecords.length - deltaItems.length
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
