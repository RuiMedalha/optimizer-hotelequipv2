import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── WooCommerce config ───────────────────────────────────────────────────────

async function getWooConfig(supabase: any) {
  const { data: settings } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);

  const settingsMap: Record<string, string> = {};
  settings?.forEach((s: any) => { settingsMap[s.key] = s.value; });

  const wooUrl = settingsMap["woocommerce_url"];
  const wooKey = settingsMap["woocommerce_consumer_key"];
  const wooSecret = settingsMap["woocommerce_consumer_secret"];

  if (!wooUrl || !wooKey || !wooSecret) return null;

  const baseUrl = wooUrl.replace(/\/+$/, "");
  const auth = btoa(`${wooKey}:${wooSecret}`);
  return { baseUrl, auth };
}

async function wooFetch(baseUrl: string, auth: string, endpoint: string, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3${endpoint}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`WooCommerce ${resp.status}: ${errBody.substring(0, 300)}`);
    }
    const totalPages = parseInt(resp.headers.get("X-WP-TotalPages") || "1");
    const total = parseInt(resp.headers.get("X-WP-Total") || "0");
    const data = await resp.json();
    return { data, totalPages, total };
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      throw new Error(`WooCommerce request timeout after ${timeoutMs}ms for ${endpoint}`);
    }
    throw e;
  }
}

// ─── Normalization helpers ────────────────────────────────────────────────────

const BRAND_ATTR_NAMES = new Set([
  "marca", "brand", "marcas", "brands", "xstore brand", "xstore-brand",
]);
const EAN_KEYS = ["_ean", "ean", "_gtin", "gtin", "barcode", "_barcode"];
const MODELO_KEYS = ["_modelo", "modelo", "_model", "model"];
const SEO_TITLE_KEYS = ["rank_math_title", "_yoast_wpseo_title", "_seopress_titles_title"];
const SEO_DESC_KEYS = ["rank_math_description", "_yoast_wpseo_metadesc", "_seopress_titles_desc"];
const SEO_KW_KEYS = ["rank_math_focus_keyword", "_yoast_wpseo_focuskw", "_seopress_analysis_target_kw"];

/** Convert wp.meta_data array → flat key/value map (string values only). */
function parseMeta(metaData: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of metaData || []) {
    if (m.key && m.value != null) {
      const v = typeof m.value === "string" ? m.value : JSON.stringify(m.value);
      if (v.trim()) out[m.key] = v.trim();
    }
  }
  return out;
}

/** Return first non-empty value found in meta for any of the given keys. */
function metaGet(meta: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = meta[k];
    if (v) return v;
  }
  return null;
}

/**
 * Resolve the full category path from a leaf category id to the root.
 * Returns e.g. "Mobiliário > Cadeiras > Cadeiras de Escritório".
 * Protects against cycles with a visited set.
 */
function resolveCategoryPath(
  catId: number,
  catMap: Map<number, { name: string; parent: number }>,
): string {
  const parts: string[] = [];
  let current = catId;
  const visited = new Set<number>();
  while (current && catMap.has(current) && !visited.has(current)) {
    visited.add(current);
    const cat = catMap.get(current)!;
    parts.unshift(cat.name);
    current = cat.parent;
  }
  return parts.join(" > ");
}

/** Build technical_specs string from weight + dimensions. */
function buildTechSpecs(obj: { weight?: string; dimensions?: { length?: string; width?: string; height?: string } }): string | null {
  const parts: string[] = [];
  if (obj.weight) parts.push(`Peso: ${obj.weight}kg`);
  if (obj.dimensions?.length) parts.push(`Comprimento: ${obj.dimensions.length}cm`);
  if (obj.dimensions?.width) parts.push(`Largura: ${obj.dimensions.width}cm`);
  if (obj.dimensions?.height) parts.push(`Altura: ${obj.dimensions.height}cm`);
  return parts.length > 0 ? parts.join(" | ") : null;
}

/**
 * Map a WooCommerce product object to the products DB row shape.
 * Does NOT include parent_product_id (set after insert for variations).
 */
function normalizeWooProduct(
  wp: any,
  userId: string,
  workspaceId: string,
  _workflowRunId: string | null,
  catMap: Map<number, { name: string; parent: number }>,
): Record<string, unknown> {
  const meta = parseMeta(wp.meta_data);

  // Images
  const imageUrls: string[] = (wp.images || []).map((img: any) => img.src).filter(Boolean);
  const imageAltTexts: Record<string, string> = {};
  for (const img of wp.images || []) {
    if (img.src && img.alt) imageAltTexts[img.src] = img.alt;
  }

  // Categories — resolve full hierarchy via catMap
  const wooCats: Array<{ id: number; name: string; slug: string }> = wp.categories || [];
  let category: string | null = null;
  let categoryPaths: string[] = [];
  if (wooCats.length > 0 && catMap.size > 0) {
    // Build the full path for every assigned category
    categoryPaths = wooCats
      .map((c) => resolveCategoryPath(c.id, catMap))
      .filter(Boolean);
    // Sort descending by number of segments — deepest path first
    categoryPaths.sort((a, b) => b.split(" > ").length - a.split(" > ").length);
    category = categoryPaths[0] || null;
  } else if (wooCats.length > 0) {
    // catMap not available (e.g. fetch failed) — fall back to flat names
    categoryPaths = wooCats.map((c) => c.name);
    category = categoryPaths.join(", ");
  }

  // Tags
  const tags: string[] = (wp.tags || []).map((t: any) => t.name).filter(Boolean);

  // Attributes — ALL (variation + non-variation)
  const attrs: any[] = (wp.attributes || []).map((a: any) => ({
    name: a.name,
    values: a.options || [],
    variation: a.variation || false,
    visible: a.visible !== false,
  }));

  // EAN from meta_data → append as non-variation attribute
  const eanVal = metaGet(meta, EAN_KEYS);
  if (eanVal) attrs.push({ name: "EAN", values: [eanVal], variation: false, visible: false });

  // Modelo from meta_data → append as non-variation attribute
  const modeloVal = metaGet(meta, MODELO_KEYS);
  if (modeloVal) attrs.push({ name: "Modelo", values: [modeloVal], variation: false, visible: false });

  // Brand supplier_ref
  const brandAttr = (wp.attributes || []).find((a: any) =>
    BRAND_ATTR_NAMES.has(a.name.toLowerCase())
  );
  const supplierRef = brandAttr?.options?.[0] || null;

  // SEO from meta_data (Rank Math / Yoast / SEOPress)
  const seoTitle = metaGet(meta, SEO_TITLE_KEYS);
  const seoDesc = metaGet(meta, SEO_DESC_KEYS);
  const seoKw = metaGet(meta, SEO_KW_KEYS);

  // Upsell / cross-sell WooCommerce IDs (stored as string arrays)
  const upsellIds: string[] = (wp.upsell_ids || []).map(String);
  const crosssellIds: string[] = (wp.cross_sell_ids || []).map(String);

  // Extra WooCommerce fields stored in source_confidence_profile
  const sourceProfile: Record<string, unknown> = {
    permalink: wp.permalink || null,
    woo_status: wp.status || null,
    stock_status: wp.stock_status || null,
    stock_quantity: wp.stock_quantity ?? null,
    manage_stock: wp.manage_stock ?? null,
    catalog_visibility: wp.catalog_visibility || null,
    woo_categories: wooCats,
    category_paths: categoryPaths.length > 0 ? categoryPaths : undefined,
    meta_data: meta,
  };

  return {
    user_id: userId,
    workspace_id: workspaceId,
    sku: wp.sku || String(wp.id),
    original_title: wp.name || null,
    original_description: wp.description || null,
    short_description: wp.short_description || null,
    original_price: wp.regular_price ? parseFloat(wp.regular_price) : null,
    sale_price: wp.sale_price ? parseFloat(wp.sale_price) : null,
    image_urls: imageUrls.length > 0 ? imageUrls : null,
    image_alt_texts: Object.keys(imageAltTexts).length > 0 ? imageAltTexts : null,
    category,
    product_type: wp.type === "variable" ? "variable" : "simple",
    status: "pending",
    woocommerce_id: wp.id,
    source_file: "woocommerce-import",
    supplier_ref: supplierRef,
    attributes: attrs.length > 0 ? attrs : null,
    tags: tags.length > 0 ? tags : null,
    technical_specs: buildTechSpecs(wp),
    seo_slug: wp.slug || null,
    meta_title: seoTitle,
    meta_description: seoDesc,
    focus_keyword: seoKw ? [seoKw] : null,
    upsell_skus: upsellIds.length > 0 ? upsellIds : null,
    crosssell_skus: crosssellIds.length > 0 ? crosssellIds : null,
    source_confidence_profile: sourceProfile,
  };
}

/**
 * Map a WooCommerce variation object to the products DB row shape.
 */
function normalizeWooVariation(
  v: any,
  parentWp: any,
  parentDbId: string,
  userId: string,
  workspaceId: string,
  _workflowRunId: string | null,
): Record<string, unknown> {
  const meta = parseMeta(v.meta_data);

  // Variation-specific attributes (name + single option value)
  const varAttrs: any[] = (v.attributes || []).map((a: any) => ({
    name: a.name,
    value: a.option,
    variation: true,
  }));

  // EAN for variation
  const eanVal = metaGet(meta, EAN_KEYS);
  if (eanVal) varAttrs.push({ name: "EAN", value: eanVal, variation: false });

  // Title: parent name + attribute label
  const attrLabel = varAttrs
    .filter((a) => a.variation || a.value)
    .map((a) => a.value)
    .filter(Boolean)
    .join(" / ");
  const varTitle = attrLabel ? `${parentWp.name} - ${attrLabel}`.trim() : parentWp.name;

  // Images
  const varImages: string[] = v.image?.src ? [v.image.src] : [];
  const varAltTexts: Record<string, string> = {};
  if (v.image?.src && v.image?.alt) varAltTexts[v.image.src] = v.image.alt;

  // Extra WooCommerce fields for variation
  const sourceProfile: Record<string, unknown> = {
    parent_woocommerce_id: parentWp.id,
    woo_status: v.status || null,
    stock_status: v.stock_status || null,
    stock_quantity: v.stock_quantity ?? null,
    manage_stock: v.manage_stock ?? null,
    meta_data: meta,
  };

  return {
    user_id: userId,
    workspace_id: workspaceId,
    sku: v.sku || `${parentWp.id}-${v.id}`,
    original_title: varTitle,
    original_price: v.regular_price ? parseFloat(v.regular_price) : null,
    sale_price: v.sale_price ? parseFloat(v.sale_price) : null,
    image_urls: varImages.length > 0 ? varImages : null,
    image_alt_texts: Object.keys(varAltTexts).length > 0 ? varAltTexts : null,
    product_type: "variation",
    parent_product_id: parentDbId,
    attributes: varAttrs.length > 0 ? varAttrs : null,
    status: "pending",
    woocommerce_id: v.id,
    source_file: "woocommerce-import",
    technical_specs: buildTechSpecs(v),
    source_confidence_profile: sourceProfile,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action } = body;

    const wooConfig = await getWooConfig(supabase);
    if (!wooConfig) {
      return new Response(JSON.stringify({ error: "Credenciais WooCommerce não configuradas." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { baseUrl, auth } = wooConfig;

    // ── ACTION: List categories ──────────────────────────────────────────────
    if (action === "list_categories") {
      const allCats: any[] = [];
      let page = 1;
      while (true) {
        const { data } = await wooFetch(baseUrl, auth, `/products/categories?per_page=100&page=${page}`);
        allCats.push(...data);
        if (data.length < 100) break;
        page++;
        if (page > 20) break;
      }
      return new Response(JSON.stringify({ categories: allCats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: List attributes ──────────────────────────────────────────────
    if (action === "list_attributes") {
      const { data: attributes } = await wooFetch(baseUrl, auth, `/products/attributes?per_page=100`);

      const CONCURRENCY = 5;
      const withTerms: any[] = [];

      for (let i = 0; i < attributes.length; i += CONCURRENCY) {
        const batch = attributes.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (attr: any) => {
            const allTerms: any[] = [];
            let page = 1;
            while (true) {
              const { data: terms } = await wooFetch(
                baseUrl, auth,
                `/products/attributes/${attr.id}/terms?per_page=100&page=${page}`,
                15000,
              );
              allTerms.push(...terms);
              if (terms.length < 100) break;
              page++;
              if (page > 10) break;
            }
            return { ...attr, terms: allTerms };
          })
        );
        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          withTerms.push(r.status === "fulfilled" ? r.value : { ...batch[j], terms: [] });
        }
      }

      return new Response(JSON.stringify({ attributes: withTerms }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: Import products ──────────────────────────────────────────────
    if (action === "import") {
      const { workspaceId, filters = {}, workflowRunId, categoryMapping } = body;

      if (!workspaceId) {
        return new Response(JSON.stringify({ error: "workspaceId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Build query params from filters (unchanged)
      const params = new URLSearchParams();
      params.set("per_page", "100");
      if (filters.type && filters.type !== "all") params.set("type", filters.type);
      if (filters.status && filters.status !== "all") params.set("status", filters.status);
      if (filters.category) params.set("category", filters.category);
      if (filters.stock_status && filters.stock_status !== "all") params.set("stock_status", filters.stock_status);
      if (filters.search) params.set("search", filters.search);
      if (filters.attribute && filters.attribute_term) {
        params.set("attribute", filters.attribute);
        params.set("attribute_term", filters.attribute_term);
      }

      // Paginate products (unchanged)
      const allProducts: any[] = [];
      let page = 1;
      console.log(`Importing from WooCommerce with filters: ${JSON.stringify(filters)}`);
      while (true) {
        params.set("page", String(page));
        const { data: products, totalPages } = await wooFetch(baseUrl, auth, `/products?${params.toString()}`);
        allProducts.push(...products);
        console.log(`Page ${page}/${totalPages}: ${products.length} products`);
        if (page >= totalPages || products.length === 0) break;
        page++;
      }
      console.log(`Total products fetched from WooCommerce: ${allProducts.length}`);

      // Fetch variations for variable products (unchanged)
      const variableProducts = allProducts.filter((p: any) => p.type === "variable");
      const variationMap: Record<number, any[]> = {};

      for (let i = 0; i < variableProducts.length; i += 5) {
        const batch = variableProducts.slice(i, i + 5);
        const results = await Promise.allSettled(
          batch.map(async (vp: any) => {
            const allVars: any[] = [];
            let vPage = 1;
            while (true) {
              const { data: vars } = await wooFetch(
                baseUrl, auth,
                `/products/${vp.id}/variations?per_page=100&page=${vPage}`,
              );
              allVars.push(...vars);
              if (vars.length < 100) break;
              vPage++;
            }
            return { id: vp.id, vars: allVars };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") variationMap[r.value.id] = r.value.vars;
        }
      }

      // ── Load category tree for hierarchy resolution ───────────────────────
      const catMap = new Map<number, { name: string; parent: number }>();
      try {
        let catPage = 1;
        while (true) {
          const { data: cats } = await wooFetch(
            baseUrl, auth, `/products/categories?per_page=100&page=${catPage}`,
          );
          for (const c of cats) catMap.set(c.id, { name: c.name, parent: c.parent || 0 });
          if (cats.length < 100) break;
          catPage++;
          if (catPage > 20) break;
        }
        console.log(`Loaded ${catMap.size} categories for hierarchy resolution`);
      } catch (e: unknown) {
        console.warn("Could not load category tree, falling back to flat names:", e);
      }

      // ── Load existing products: index by woocommerce_id AND sku ──────────
      // Priority: woocommerce_id match > sku match
      const existingByWooId = new Map<number, { id: string; sku: string | null }>();
      const existingBySku = new Map<string, { id: string; woocommerce_id: number | null }>();

      let rangeFrom = 0;
      while (true) {
        const { data: existing } = await supabase
          .from("products")
          .select("id, sku, woocommerce_id")
          .eq("workspace_id", workspaceId)
          .range(rangeFrom, rangeFrom + 999);
        if (!existing || existing.length === 0) break;
        for (const p of existing) {
          if (p.woocommerce_id) existingByWooId.set(p.woocommerce_id, { id: p.id, sku: p.sku });
          if (p.sku) existingBySku.set(p.sku, { id: p.id, woocommerce_id: p.woocommerce_id });
        }
        if (existing.length < 1000) break;
        rangeFrom += 1000;
      }

      // ── Build category mapping lookup: woo cat id → internal cat id ───────
      const catMappingLookup: Map<string, string> = new Map();
      if (categoryMapping && typeof categoryMapping === "object") {
        for (const [wooCatId, internalCatId] of Object.entries(categoryMapping)) {
          if (internalCatId) catMappingLookup.set(wooCatId, internalCatId as string);
        }
      }

      // ── Load internal categories for name resolution ──────────────────────
      const internalCatNames = new Map<string, string>();
      if (catMappingLookup.size > 0) {
        const catIds = [...new Set(catMappingLookup.values())];
        for (let i = 0; i < catIds.length; i += 50) {
          const batch = catIds.slice(i, i + 50);
          const { data: cats } = await supabase.from("categories").select("id, name").in("id", batch);
          for (const c of cats || []) internalCatNames.set(c.id, c.name);
        }
      }

      /** Apply category mapping to a product row */
      function applyCategoryMapping(product: Record<string, unknown>, wp: any): void {
        if (catMappingLookup.size === 0) return;
        const wooCats: Array<{ id: number }> = wp.categories || [];
        for (const wc of wooCats) {
          const internalId = catMappingLookup.get(String(wc.id));
          if (internalId) {
            product.category_id = internalId;
            const internalName = internalCatNames.get(internalId);
            if (internalName) product.category = internalName;
            break; // Use the first matching mapped category
          }
        }
      }

      // ── Build insert list + collect woo_id backfills ──────────────────────
      const userId = user.id;
      const toInsert: any[] = [];
      const toInsertWps: any[] = []; // parallel array to track original wp for category mapping
      // parentIdMap: woo product id → db uuid (needed for variation linking)
      const parentIdMap: Record<string, string> = {};
      // Products matched by SKU that are missing woocommerce_id → backfill
      const wooIdBackfills: Array<{ id: string; woocommerce_id: number }> = [];
      // Error tracking
      const importErrors: Array<{ sku: string; title: string; error: string; phase: string }> = [];

      let skipped = 0;

      for (const wp of allProducts) {
        const sku = wp.sku || String(wp.id);

        // Priority 1: woocommerce_id match → already in DB
        const byWooId = existingByWooId.get(wp.id);
        if (byWooId) {
          skipped++;
          parentIdMap[String(wp.id)] = byWooId.id;
          continue;
        }

        // Priority 2: SKU match → already in DB, maybe missing woocommerce_id
        const bySku = existingBySku.get(sku);
        if (bySku) {
          skipped++;
          parentIdMap[String(wp.id)] = bySku.id;
          if (!bySku.woocommerce_id) {
            wooIdBackfills.push({ id: bySku.id, woocommerce_id: wp.id });
          }
          continue;
        }

        // New product
        const product = normalizeWooProduct(wp, userId, workspaceId, workflowRunId ?? null, catMap);
        applyCategoryMapping(product, wp);
        toInsert.push(product);
        toInsertWps.push(wp);
      }

      // ── Backfill woocommerce_id for SKU-matched products ──────────────────
      if (wooIdBackfills.length > 0) {
        console.log(`Backfilling woocommerce_id for ${wooIdBackfills.length} SKU-matched products`);
        await Promise.allSettled(
          wooIdBackfills.map(({ id, woocommerce_id }) =>
            supabase.from("products").update({ woocommerce_id }).eq("id", id)
          )
        );
      }

      // ── Batch insert new products ─────────────────────────────────────────
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50);
        const batchWps = toInsertWps.slice(i, i + 50);
        const { data: insertedData, error: insertErr } = await supabase
          .from("products")
          .insert(batch)
          .select("id, sku, woocommerce_id");

        if (insertErr) {
          console.error(`Insert batch error:`, insertErr);
          // Track individual errors for this batch and log to central table
          for (const wp of batchWps) {
            const sku = wp.sku || String(wp.id);
            const errMsg = insertErr.message || "Erro ao inserir";
            
            importErrors.push({
              sku,
              title: wp.name || "",
              error: errMsg,
              phase: "insert",
            });

            // Persist to central error log
            try {
              await supabase.from("catalog_operation_errors").insert({
                workspace_id: workspaceId,
                user_id: userId,
                operation_type: 'woocommerce_import',
                sku: sku,
                error_message: errMsg,
                error_detail: { phase: 'insert', woo_id: wp.id, name: wp.name }
              });
            } catch (logErr) {
              console.error("Failed to persist import error:", logErr);
            }
          }
          continue;
        }

        inserted += insertedData?.length || 0;
        for (const row of insertedData || []) {
          if (row.woocommerce_id) parentIdMap[String(row.woocommerce_id)] = row.id;
        }
      }

      // ── Insert variations ─────────────────────────────────────────────────
      let variationsInserted = 0;

      for (const [wooParentId, variations] of Object.entries(variationMap)) {
        const parentDbId = parentIdMap[wooParentId];
        if (!parentDbId) continue;

        const parentWp = allProducts.find((p: any) => p.id === parseInt(wooParentId));
        if (!parentWp) continue;

        const varInserts: any[] = [];

        for (const v of variations) {
          const varSku = v.sku || `${wooParentId}-${v.id}`;

          // Priority 1: woocommerce_id match
          if (existingByWooId.has(v.id)) continue;

          // Priority 2: SKU match — backfill woo_id if needed
          const bySku = existingBySku.get(varSku);
          if (bySku) {
            if (!bySku.woocommerce_id) {
              await supabase.from("products").update({ woocommerce_id: v.id }).eq("id", bySku.id);
            }
            continue;
          }

          varInserts.push(
            normalizeWooVariation(v, parentWp, parentDbId, userId, workspaceId, workflowRunId ?? null)
          );
        }

        for (let i = 0; i < varInserts.length; i += 50) {
          const batch = varInserts.slice(i, i + 50);
          const { data: vData, error: vErr } = await supabase
            .from("products")
            .insert(batch)
            .select("id");
          if (vErr) {
            console.error(`Variation insert error for parent ${wooParentId}:`, vErr);
            for (const vi of batch) {
              const errMsg = vErr.message || "Erro ao inserir variação";
              importErrors.push({
                sku: vi.sku || "",
                title: vi.original_title || "",
                error: errMsg,
                phase: "variation",
              });

              // Persist to central error log
              try {
                await supabase.from("catalog_operation_errors").insert({
                  workspace_id: workspaceId,
                  user_id: userId,
                  operation_type: 'woocommerce_import_variation',
                  sku: vi.sku,
                  error_message: errMsg,
                  error_detail: { phase: 'variation', parent_id: wooParentId }
                });
              } catch (logErr) {
                console.error("Failed to persist variation import error:", logErr);
              }
            }
          } else {
            variationsInserted += vData?.length || 0;
          }
        }
      }

      // ── Activity log ──────────────────────────────────────────────────────
      await supabase.from("activity_log").insert({
        user_id: userId,
        action: "upload" as const,
        workspace_id: workspaceId,
        details: {
          type: "woocommerce_import",
          imported: inserted,
          variations: variationsInserted,
          skipped,
          filters,
          workflow_run_id: workflowRunId || null,
          imported_at: new Date().toISOString(),
        },
      });

      console.log(`Import complete: ${inserted} products, ${variationsInserted} variations, ${skipped} skipped`);

      return new Response(JSON.stringify({
        success: true,
        imported: inserted,
        variations: variationsInserted,
        skipped,
        total: allProducts.length,
        errors: importErrors.length > 0 ? importErrors : undefined,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? (error as Error).message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
