import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function hasMeaningfulProduct(candidate: any): boolean {
  if (!candidate || typeof candidate !== "object") return false;
  return [
    candidate.sku, candidate.title, candidate.original_title,
    candidate.description, candidate.original_description,
    candidate.price, candidate.original_price,
  ].some((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function flattenVisionProducts(items: any, parentSection?: string): any[] {
  const flat: any[] = [];
  const walk = (candidate: any, section?: string) => {
    if (candidate == null) return;
    if (Array.isArray(candidate)) { candidate.forEach((entry) => walk(entry, section)); return; }
    if (typeof candidate !== "object") return;
    if (Array.isArray(candidate.products)) {
      const sectionTitle = typeof candidate.section_title === "string" && candidate.section_title.trim() ? candidate.section_title.trim() : section;
      candidate.products.forEach((entry: any) => walk(entry, sectionTitle));
      return;
    }
    flat.push({ ...candidate, category: candidate.category || section });
  };
  walk(items, parentSection);
  return flat;
}

function pickBestPageRows(rows: any[]): any[] {
  const bestByPage = new Map<number, { row: any; productCount: number; confidence: number }>();
  for (const row of rows || []) {
    const pageNumber = Number(row?.page_number);
    if (!Number.isFinite(pageNumber)) continue;
    const products = flattenVisionProducts(row?.vision_result?.products || [], row?.page_context?.section_title || "");
    const productCount = products.filter(hasMeaningfulProduct).length;
    const confidence = Number(row?.confidence_score || 0);
    const current = bestByPage.get(pageNumber);
    if (!current || productCount > current.productCount || (productCount === current.productCount && confidence > current.confidence)) {
      bestByPage.set(pageNumber, { row, productCount, confidence });
    }
  }
  return [...bestByPage.values()].map((e) => e.row).sort((a, b) => (a?.page_number || 0) - (b?.page_number || 0));
}

function toNumberPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = parseFloat(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function mapProductRow(product: any, fallbackCategory = "", source = "pdf_ai_vision", pageNumber?: number): Record<string, any> {
  const mapped: Record<string, any> = {};
  const sku = product?.sku ?? product?.SKU ?? product?.reference;
  const title = product?.original_title ?? product?.title ?? product?.name;
  const description = product?.original_description ?? product?.description;
  const shortDescription = product?.short_description ?? product?.optimized_short_description;
  const category = product?.category || fallbackCategory;
  const price = toNumberPrice(product?.original_price ?? product?.price);

  if (sku) mapped.sku = String(sku).trim();
  if (title) mapped.original_title = title;
  if (description) mapped.original_description = description;
  if (shortDescription) mapped.short_description = shortDescription;
  if (price !== null) mapped.original_price = price;
  if (category) mapped.category = category;
  if (product?.dimensions) mapped.dimensions = product.dimensions;
  if (product?.weight) mapped.weight = product.weight;
  if (product?.material) mapped.material = product.material;
  if (product?.color_options?.length) mapped.color_options = product.color_options;
  if (product?.image_description) mapped.image_description = product.image_description;
  if (product?.image_url) mapped.image_url = product.image_url;
  if (product?.image_urls) mapped.image_urls = product.image_urls;
  if (product?.technical_specs) mapped.technical_specs = typeof product.technical_specs === "string" ? product.technical_specs : JSON.stringify(product.technical_specs);
  if (product?.brand) mapped.brand = product.brand;
  if (product?.model) mapped.model = product.model;
  if (product?.quantity) mapped.quantity = product.quantity;
  if (product?.unit) mapped.unit = product.unit;

  const skipKeys = new Set([
    "sku", "SKU", "reference", "title", "name", "original_title", "description", "original_description",
    "price", "original_price", "category", "dimensions", "weight", "material", "color_options",
    "image_description", "image_url", "image_urls", "technical_specs", "short_description",
    "optimized_short_description", "confidence", "currency", "brand", "model", "quantity", "unit",
  ]);
  for (const [key, value] of Object.entries(product || {})) {
    if (key.startsWith("_") || skipKeys.has(key)) continue;
    if (value !== null && value !== undefined && value !== "") mapped[key] = value;
  }

  return {
    ...mapped,
    _confidence: Number(product?._confidence ?? product?.confidence ?? 70),
    _pageNumber: pageNumber ?? product?._pageNumber ?? null,
    _source: product?._source || source,
  };
}

// ─── Merge products with same SKU from different pages ───
function mergeProductsBySku(products: any[]): any[] {
  const bySkuMap = new Map<string, any>();
  const noSku: any[] = [];

  for (const product of products) {
    const sku = product.sku;
    if (!sku || typeof sku !== "string" || !sku.trim()) {
      noSku.push(product);
      continue;
    }

    const key = sku.trim().toLowerCase();
    const existing = bySkuMap.get(key);

    if (!existing) {
      bySkuMap.set(key, { ...product, _sources: [product._source || "unknown"], _pages: product._pageNumber ? [product._pageNumber] : [] });
      continue;
    }

    // Merge: prefer longer/more complete values
    for (const [field, value] of Object.entries(product)) {
      if (field.startsWith("_")) continue;
      if (value === null || value === undefined || value === "") continue;

      const existingValue = existing[field];
      if (!existingValue || existingValue === "" || existingValue === null) {
        existing[field] = value;
      } else if (typeof value === "string" && typeof existingValue === "string" && value.length > existingValue.length) {
        existing[field] = value;
      }
    }

    // Merge image_urls arrays
    if (product.image_urls && Array.isArray(product.image_urls)) {
      existing.image_urls = [...new Set([...(existing.image_urls || []), ...product.image_urls])];
    }
    if (product.image_url && !existing.image_urls?.includes(product.image_url)) {
      existing.image_urls = [...(existing.image_urls || []), product.image_url];
    }

    // Track sources and pages
    if (product._source && !existing._sources.includes(product._source)) existing._sources.push(product._source);
    if (product._pageNumber && !existing._pages.includes(product._pageNumber)) existing._pages.push(product._pageNumber);

    // Take higher confidence
    if ((product._confidence || 0) > (existing._confidence || 0)) {
      existing._confidence = product._confidence;
    }

    bySkuMap.set(key, existing);
  }

  return [...bySkuMap.values(), ...noSku];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { extractionId, sendToIngestion, workspaceId, mergeStrategy } = await req.json();
    if (!extractionId) throw new Error("extractionId required");

    const { data: extractionRow, error: extractionError } = await supabase
      .from("pdf_extractions")
      .select("detected_products, workspace_id")
      .eq("id", extractionId)
      .single();
    if (extractionError) throw extractionError;

    const effectiveWorkspaceId = workspaceId || extractionRow?.workspace_id;

    // Collect products from reviewed data or from pages + tables
    let structuredRows: any[] = [];

    const reviewedProducts = flattenVisionProducts(extractionRow?.detected_products || []);
    structuredRows = reviewedProducts
      .map((p: any) => mapProductRow(p, p?.category || "", p?._source || "pdf_review", p?._pageNumber))
      .filter(hasMeaningfulProduct);

    // Always fetch pages for enrichment (even if reviewed products exist)
    const { data: allPages } = await supabase
      .from("pdf_pages")
      .select("id, page_number, confidence_score, vision_result, page_context")
      .eq("extraction_id", extractionId)
      .order("page_number");

    if (structuredRows.length === 0 && allPages?.length) {
      const pages = pickBestPageRows(allPages);
      for (const page of pages) {
        const sectionTitle = page.page_context?.section_title || "";
        const products = flattenVisionProducts(page.vision_result?.products || [], sectionTitle);
        for (const product of products) {
          const mapped = mapProductRow(product, sectionTitle, "pdf_ai_vision", page.page_number);
          if (hasMeaningfulProduct(mapped)) structuredRows.push(mapped);
        }
      }
    }

    // Always enrich with table data — merge table rows into existing products by SKU or append new ones
    if (allPages?.length) {
      const pageIds = allPages.map((p: any) => p.id);
      const { data: tables } = await supabase
        .from("pdf_tables")
        .select("*, pdf_table_rows(*)")
        .in("page_id", pageIds)
        .order("table_index");

      if (tables?.length) {
        const tableProducts: any[] = [];
        for (const table of tables) {
          for (const row of table.pdf_table_rows || []) {
            const cells = row.cells || [];
            const product: Record<string, any> = {};
            let totalConfidence = 0;
            for (const cell of cells) {
              const field = cell.semantic_type || cell.header;
              if (cell.value && field) {
                if (field === "sku" || field === "reference" || field === "código" || field === "codigo" || field === "ref") product.sku = cell.value;
                else if (field === "title" || field === "nome" || field === "produto" || field === "designação" || field === "designacao") product.original_title = cell.value;
                else if (field === "description" || field === "descrição" || field === "descricao") product.original_description = cell.value;
                else if (field === "short_description") product.short_description = cell.value;
                else if (field === "price" || field === "preço" || field === "preco" || field === "pvp") {
                  const num = toNumberPrice(cell.value);
                  if (num !== null) product.original_price = num;
                }
                else if (field === "category" || field === "categoria" || field === "família" || field === "familia") product.category = cell.value;
                else if (field === "dimensions" || field === "dimensões" || field === "medidas") product.dimensions = cell.value;
                else if (field === "weight" || field === "peso") product.weight = cell.value;
                else if (field === "material") product.material = cell.value;
                else if (field === "brand" || field === "marca") product.brand = cell.value;
                else if (field === "model" || field === "modelo") product.model = cell.value;
                else if (field === "technical_specs" || field === "especificações" || field === "specs") {
                  product.technical_specs = product.technical_specs
                    ? product.technical_specs + "; " + cell.value
                    : cell.value;
                }
                else {
                  // Store unknown fields as extra attributes
                  product[field] = cell.value;
                }
              }
              totalConfidence += Number(cell.confidence || 0);
            }
            if (hasMeaningfulProduct(product)) {
              tableProducts.push({
                ...product,
                _confidence: cells.length > 0 ? Math.round(totalConfidence / cells.length) : 50,
                _source: "pdf_table",
                _rowId: row.id,
              });
            }
          }
        }

        // Merge table products into structuredRows — table data enriches existing vision products
        if (tableProducts.length > 0) {
          structuredRows = [...structuredRows, ...tableProducts];
        }
      }
    }

    if (structuredRows.length === 0 && !allPages?.length) {
      throw new Error("No pages found");
    }

    // ─── Merge products with same SKU ───
    structuredRows = mergeProductsBySku(structuredRows);

    // ─── SKU matching & ingestion ───
    if (sendToIngestion && effectiveWorkspaceId && structuredRows.length > 0) {
      const skus = structuredRows
        .map((r) => r.sku)
        .filter((s) => typeof s === "string" && s.trim() !== "");

      let existingBySku: Record<string, string> = {};
      if (skus.length > 0) {
        for (let i = 0; i < skus.length; i += 200) {
          const batch = skus.slice(i, i + 200);
          const { data: existing } = await supabase
            .from("products")
            .select("id, sku")
            .eq("workspace_id", effectiveWorkspaceId)
            .in("sku", batch);
          if (existing) {
            for (const p of existing) {
              if (p.sku) existingBySku[p.sku] = p.id;
            }
          }
        }
      }

      const { data: job } = await supabase
        .from("ingestion_jobs")
        .insert({
          workspace_id: effectiveWorkspaceId,
          source_type: "api",
          file_name: `pdf_extraction_${extractionId}`,
          status: "mapping",
          mode: "dry_run",
          merge_strategy: mergeStrategy || "merge",
          total_rows: structuredRows.length,
          parsed_rows: structuredRows.length,
        })
        .select("id")
        .single();

      if (job) {
        let insertCount = 0, updateCount = 0, duplicateCount = 0;

        const items = structuredRows.map((row, i) => {
          const sku = row.sku;
          const matchedId = sku ? existingBySku[sku] || null : null;
          let action = "insert";
          let matchConfidence = row._confidence || 0;

          if (matchedId) {
            const strat = mergeStrategy || "merge";
            if (strat === "insert_only") {
              action = "skip";
              duplicateCount++;
            } else {
              action = strat === "replace" ? "update" : "merge";
              matchConfidence = 100;
              updateCount++;
            }
          } else {
            insertCount++;
          }

          return {
            job_id: job.id,
            status: "mapped" as const,
            source_row_index: i,
            source_data: row,
            mapped_data: {
              sku: row.sku,
              original_title: row.original_title,
              original_description: row.original_description,
              short_description: row.short_description,
              original_price: row.original_price,
              category: row.category,
              dimensions: row.dimensions,
              weight: row.weight,
              material: row.material,
              image_description: row.image_description,
              image_urls: row.image_urls || (row.image_url ? [row.image_url] : undefined),
              technical_specs: row.technical_specs,
              brand: row.brand,
              model: row.model,
            },
            action,
            matched_existing_id: matchedId,
            match_confidence: matchConfidence,
          };
        });

        await supabase.from("ingestion_job_items").insert(items);
        await supabase.from("ingestion_jobs").update({
          status: "dry_run",
          imported_rows: insertCount,
          updated_rows: updateCount,
          duplicate_rows: duplicateCount,
        }).eq("id", job.id);
      }

      await supabase
        .from("pdf_extractions")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          detected_products: structuredRows,
          sent_to_ingestion: true,
        })
        .eq("id", extractionId);

      return new Response(
        JSON.stringify({
          success: true,
          rowsMapped: structuredRows.length,
          ingestionJobId: job?.id,
          sentToIngestion: true,
          skuMatches: Object.keys(existingBySku).length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Not sending to ingestion — just compile products for review
    await supabase
      .from("pdf_extractions")
      .update({ status: "reviewing", detected_products: structuredRows })
      .eq("id", extractionId);

    return new Response(
      JSON.stringify({ success: true, rowsMapped: structuredRows.length, preview: structuredRows.slice(0, 20) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: unknown) {
    console.error("map-pdf-to-products error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
