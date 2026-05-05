import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SELF_INVOKE_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function selfInvokeWithRetry(authHeader: string, jobId: string, startIndex: number) {
  const payload = JSON.stringify({ jobId, startIndex });
  for (let attempt = 1; attempt <= SELF_INVOKE_RETRIES; attempt++) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/publish-woocommerce`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: payload,
      });
      if (response.ok) return true;
      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable) {
        const body = await response.text();
        console.error(`Self-invoke non-retryable error: ${response.status} ${body}`);
        return false;
      }
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(`Self-invoke retry ${attempt}/${SELF_INVOKE_RETRIES} in ${delayMs}ms`);
      await sleep(delayMs);
    } catch (err: unknown) {
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(`Self-invoke exception retry ${attempt}/${SELF_INVOKE_RETRIES} in ${delayMs}ms`, err);
      await sleep(delayMs);
    }
  }
  console.error("Self-invoke failed after all retries");
  return false;
}

interface WooResult {
  id: string;
  status: string;
  woocommerce_id?: number;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // Workspace membership check for new publish jobs
    if (!body.jobId && body.workspaceId) {
      const { data: memberCheck } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (memberCheck) {
        const rank = { owner: 4, admin: 3, editor: 2, viewer: 1 }[memberCheck.role] || 0;
        if (rank < 3) {
          return new Response(JSON.stringify({ error: "Sem permissão para publicar neste workspace (mínimo: admin)" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ── MODE: Continue an existing job ──
    if (body.jobId && body.startIndex !== undefined) {
      const { jobId, startIndex } = body;

      const { data: job, error: jobErr } = await adminClient
        .from("publish_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      if (jobErr || !job) {
        return new Response(JSON.stringify({ error: "Job não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (job.status === "cancelled") {
        return new Response(JSON.stringify({ status: "cancelled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get WooCommerce settings (use user's supabase client for RLS)
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${authHeader?.replace("Bearer ", "")}` } } }
      );

      const wooConfig = await getWooConfig(supabase);
      if (!wooConfig) {
        await adminClient.from("publish_jobs").update({
          status: "failed",
          error_message: "Credenciais WooCommerce não configuradas.",
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
        return new Response(JSON.stringify({ error: "Credenciais WooCommerce não configuradas." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { baseUrl, auth } = wooConfig;
      
      // Get workspace SEO settings once per batch to avoid redundant DB calls
      let seoPlugin = 'rankmath';
      if (job.workspace_id) {
        const { data: wsSettings } = await adminClient
          .from("workspace_settings")
          .select("seo_plugin")
          .eq("workspace_id", job.workspace_id)
          .maybeSingle();
        if (wsSettings?.seo_plugin) seoPlugin = wsSettings.seo_plugin;
      }

      const fields = job.publish_fields && Array.isArray(job.publish_fields) && job.publish_fields.length > 0 ? new Set(job.publish_fields) : null;
      const has = (key: string) => !fields || fields.has(key);
      const pricing = job.pricing || {};
      const markupPercent = pricing?.markupPercent ?? 0;
      const discountPercent = pricing?.discountPercent ?? 0;

      const productIds = job.product_ids as string[];
      // BATCH_SIZE reduced to 5 to avoid resource exhaustion and WooCommerce API throttling
      // with the heavy parallel processing used below.
      const BATCH_SIZE = 5;
      const endIndex = Math.min(startIndex + BATCH_SIZE, productIds.length);
      const batchIds = productIds.slice(startIndex, endIndex);

      // Fetch products for this batch (keep original order from product_ids)
      const { data: batchProducts } = await supabase
        .from("products")
        .select("*")
        .in("id", batchIds);

      const batchById = new Map<string, any>((batchProducts || []).map((p: any) => [p.id, p]));
      const orderedBatchProducts = batchIds.map((id) => batchById.get(id)).filter(Boolean);

      if (!orderedBatchProducts || orderedBatchProducts.length === 0) {
        // Skip this batch
        if (endIndex >= productIds.length) {
          await finalizeJob(adminClient, jobId, job, user.id);
          return new Response(JSON.stringify({ status: "completed" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const existingResults = (job.results || []) as WooResult[];
      resetImageCache(); // Clear image resolution cache for each batch invocation

      // Re-check cancellation once before processing the batch in parallel
      const { data: preBatchJob } = await adminClient
        .from("publish_jobs")
        .select("status")
        .eq("id", jobId)
        .single();
      const cancelled = preBatchJob?.status === "cancelled";

      const forcePublish = !!(job.pricing as any)?.forcePublish;

      // Update current product name to indicate parallel processing
      if (!cancelled && orderedBatchProducts.length > 0) {
        const firstName = orderedBatchProducts[0].optimized_title || orderedBatchProducts[0].original_title || orderedBatchProducts[0].sku || orderedBatchProducts[0].id.slice(0, 8);
        const indicator = orderedBatchProducts.length > 1 ? `${firstName} (+${orderedBatchProducts.length - 1} em paralelo)` : firstName;
        await adminClient.from("publish_jobs").update({
          current_product_name: indicator,
          status: "processing",
          started_at: job.started_at || new Date().toISOString(),
        }).eq("id", jobId);
      }

      // Process products in PARALLEL (concurrency = BATCH_SIZE)
      const processOne = async (product: any): Promise<{ result: WooResult; itemStartedAt: string; durationMs: number }> => {
        const itemStartedAt = new Date().toISOString();
        const itemStartMs = Date.now();
...
        try {
          const result = await publishSingleProduct(
            product, supabase, adminClient, baseUrl, auth, has, markupPercent, discountPercent, seoPlugin
          );
          await adminClient.from("publish_job_items").insert({
            job_id: jobId,
            product_id: product.id,
            status: result.status === "error" ? "error" : "done",
            woocommerce_id: result.woocommerce_id || null,
            publish_fields: job.publish_fields || [],
            started_at: itemStartedAt,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - itemStartMs,
            error_message: result.error?.substring(0, 500) || null,
          });
          return { result, itemStartedAt, durationMs: Date.now() - itemStartMs };
        } catch (e: unknown) {
          const result: WooResult = {
            id: product.id,
            status: "error",
            error: (e as Error).message,
          };
          await adminClient.from("publish_job_items").insert({
            job_id: jobId,
            product_id: product.id,
            status: "error",
            started_at: itemStartedAt,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - itemStartMs,
            error_message: (e as Error).message?.substring(0, 500),
          });
          return { result, itemStartedAt, durationMs: Date.now() - itemStartMs };
        }
      };

      if (!cancelled && orderedBatchProducts.length > 0) {
        // Run the entire batch concurrently (concurrency = BATCH_SIZE)
        const batchResults = await Promise.all(orderedBatchProducts.map(processOne));

        // Preserve original order in results
        for (const { result } of batchResults) {
          existingResults.push(result);
        }

        const newFailed = batchResults.filter((r) => r.result.status === "error").length;
        await adminClient.from("publish_jobs").update({
          processed_products: startIndex + orderedBatchProducts.length,
          failed_products: (job.failed_products || 0) + newFailed,
          results: existingResults,
        }).eq("id", jobId);
      }

      // Update total processed
      const totalProcessedNow = endIndex;
      await adminClient.from("publish_jobs").update({
        processed_products: totalProcessedNow,
        results: existingResults,
      }).eq("id", jobId);

      // If more products to process, self-invoke with retry
      if (endIndex < productIds.length) {
        const { data: checkJob } = await adminClient
          .from("publish_jobs")
          .select("status")
          .eq("id", jobId)
          .single();
        if (checkJob?.status !== "cancelled") {
          // Fire-and-forget the next batch via background task to avoid the
          // 150s idle timeout — the parent invocation must return immediately.
          // EdgeRuntime.waitUntil keeps the runtime alive until the promise settles.
          // @ts-ignore -- EdgeRuntime is provided by the Supabase Edge runtime
          EdgeRuntime.waitUntil(selfInvokeWithRetry(authHeader!, jobId, endIndex));
        }
      } else {
        // Job complete
        await finalizeJob(adminClient, jobId, { ...job, results: existingResults }, user.id);
      }

      return new Response(JSON.stringify({ status: "processing", jobId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: Create a new job ──
    const { productIds, publishFields, pricing, scheduledFor, workspaceId, forcePublish } = body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum produto selecionado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Expand: variable parents → include children, variations → include parent + siblings
    const { data: selectedProducts } = await supabase
      .from("products")
      .select("id, product_type, parent_product_id")
      .in("id", productIds);

    const variableParentIds = (selectedProducts || [])
      .filter((p: any) => p.product_type === "variable")
      .map((p: any) => p.id);

    // Variations selected → find their parents
    const variationParentIds = (selectedProducts || [])
      .filter((p: any) => p.product_type === "variation" && p.parent_product_id)
      .map((p: any) => p.parent_product_id);

    const allFamilyParentIds = [...new Set([...variableParentIds, ...variationParentIds])];

    let allIds = [...productIds];
    if (allFamilyParentIds.length > 0) {
      // Include parents themselves + all their children
      const { data: children } = await supabase
        .from("products")
        .select("id")
        .in("parent_product_id", allFamilyParentIds);
      const childIds = (children || []).map((c: any) => c.id);
      allIds = [...new Set([...allIds, ...allFamilyParentIds, ...childIds])];
    }

    // Ensure parents are processed before variations to avoid "pai não publicado" errors
    const { data: allRows } = await supabase
      .from("products")
      .select("id, parent_product_id, product_type")
      .in("id", allIds);

    const rowById = new Map<string, any>((allRows || []).map((r: any) => [r.id, r]));
    const rank = (id: string) => {
      const r = rowById.get(id);
      if (!r) return 3;
      if (!r.parent_product_id && r.product_type === "variable") return 0; // variable parent
      if (!r.parent_product_id) return 1; // simple/parentless
      return 2; // variation
    };

    allIds = [...allIds].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });

    const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();
    const status = isScheduled ? "scheduled" : "queued";

    const { data: newJob, error: insertErr } = await adminClient
      .from("publish_jobs")
      .insert({
        user_id: user.id,
        workspace_id: workspaceId || null,
        status,
        total_products: allIds.length,
        product_ids: allIds,
        publish_fields: publishFields || [],
        pricing: { ...(pricing || {}), ...(forcePublish ? { forcePublish: true } : {}) },
        scheduled_for: scheduledFor || null,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    // If not scheduled, start processing immediately via self-invoke with retry.
    // Fire-and-forget so the client gets the jobId instantly and the worker
    // chain runs in background, immune to the 150s request idle timeout.
    if (!isScheduled) {
      // @ts-ignore -- EdgeRuntime is provided by the Supabase Edge runtime
      EdgeRuntime.waitUntil(selfInvokeWithRetry(authHeader!, newJob.id, 0));
    }

    return new Response(JSON.stringify({ jobId: newJob.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? (e as Error).message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Helpers ───

/**
 * Maps generic SEO field names to plugin-specific meta_data keys
 */
function getSeoFieldMapping(seoPlugin: string): {
  title: string;
  description: string;
  focusKeyword: string;
  robots?: string;
} | null {
  if (!seoPlugin || seoPlugin === 'none') return null;
  
  // RankMath Pro
  if (seoPlugin === 'rankmath') {
    return {
      title: 'rank_math_title',
      description: 'rank_math_description',
      focusKeyword: 'rank_math_focus_keyword',
      robots: 'rank_math_robots',
    };
  }
  
  // Yoast SEO
  if (seoPlugin === 'yoast') {
    return {
      title: '_yoast_wpseo_title',
      description: '_yoast_wpseo_metadesc',
      focusKeyword: '_yoast_wpseo_focuskw',
    };
  }
  
  // Custom plugin format: custom:prefix
  if (seoPlugin.startsWith('custom:')) {
    const prefix = seoPlugin.replace('custom:', '');
    return {
      title: `${prefix}_title`,
      description: `${prefix}_description`,
      focusKeyword: `${prefix}_focus_keyword`,
    };
  }
  
  console.warn(`Unknown seo_plugin value: ${seoPlugin}, skipping SEO meta injection`);
  return null;
}

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

class WooSkuConflictError extends Error {
  resourceId: number;
  constructor(resourceId: number, message: string) {
    super(message);
    this.resourceId = resourceId;
  }
}

class WooNotFoundError extends Error {
  constructor(endpoint: string) {
    super(`WooCommerce 404: resource not found at ${endpoint}`);
  }
}

async function wooFetch(baseUrl: string, auth: string, endpoint: string, method: string, body?: Record<string, unknown>) {
  const resp = await fetch(`${baseUrl}/wp-json/wc/v3${endpoint}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    if (resp.status === 404) {
      throw new WooNotFoundError(endpoint);
    }
    try {
      const parsed = JSON.parse(errBody);
      // Treat "invalid_id" (stale/non-existent WC IDs from other sites) as not-found
      if (parsed.code === "woocommerce_rest_product_invalid_id") {
        console.warn(`WooCommerce invalid_id at ${endpoint}, treating as not-found (stale ID from another site?)`);
        throw new WooNotFoundError(endpoint);
      }
      if (parsed.code === "product_invalid_sku" && parsed.data?.resource_id) {
        throw new WooSkuConflictError(parsed.data.resource_id, `SKU conflict: existing ID ${parsed.data.resource_id}`);
      }
    } catch (e: unknown) {
      if (e instanceof WooNotFoundError) throw e;
      if (e instanceof WooSkuConflictError) throw e;
    }
    throw new Error(`WooCommerce ${resp.status}: ${errBody.substring(0, 300)}`);
  }
  return resp.json();
}

// ── Brand/Attribute auto-creation cache (per request) ──
const _brandAttrCache = new Map<string, number>(); // brandValue -> termId

/**
 * Ensures the pa_marca (or pa_brand) attribute exists in WooCommerce.
 * Returns the attribute ID, or null if it couldn't be resolved.
 */
async function ensureWooBrandAttribute(baseUrl: string, auth: string): Promise<number | null> {
  try {
    // Check if pa_marca attribute already exists
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/attributes`, {
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    const attrs = await resp.json();
    const existing = (attrs as any[]).find((a: any) => {
      const slug = String(a.slug || "").toLowerCase();
      return slug === "pa_marca" || slug === "pa_brand" || slug === "marca" || slug === "brand";
    });
    if (existing) return existing.id;

    // Create it
    const createResp = await fetch(`${baseUrl}/wp-json/wc/v3/products/attributes`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Marca", slug: "pa_marca", type: "select", order_by: "menu_order", has_archives: true }),
    });
    if (!createResp.ok) {
      console.warn(`[brand] Failed to create pa_marca attribute: ${createResp.status}`);
      return null;
    }
    const created = await createResp.json();
    console.log(`[brand] Created pa_marca attribute with ID ${created.id}`);
    return created.id;
  } catch (e) {
    console.warn("[brand] Error ensuring attribute:", e);
    return null;
  }
}

/**
 * Ensures a brand term exists under the given attribute.
 * Creates it if missing. Returns the term ID, or null on failure.
 */
async function ensureWooBrandTerm(baseUrl: string, auth: string, attrId: number, brandName: string): Promise<number | null> {
  const cacheKey = `${attrId}:${brandName}`;
  if (_brandAttrCache.has(cacheKey)) return _brandAttrCache.get(cacheKey)!;
  
  try {
    // Search for existing term
    const searchResp = await fetch(
      `${baseUrl}/wp-json/wc/v3/products/attributes/${attrId}/terms?search=${encodeURIComponent(brandName)}&per_page=100`,
      { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" } }
    );
    if (searchResp.ok) {
      const terms = await searchResp.json();
      const match = (terms as any[]).find((t: any) => String(t.name).toLowerCase().trim() === brandName.toLowerCase().trim());
      if (match) {
        _brandAttrCache.set(cacheKey, match.id);
        return match.id;
      }
    }

    // Create the term
    const createResp = await fetch(`${baseUrl}/wp-json/wc/v3/products/attributes/${attrId}/terms`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: brandName }),
    });
    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => "");
      // If term already exists (slug conflict), try to find it
      if (createResp.status === 400 && errText.includes("term_exists")) {
        const parsed = JSON.parse(errText);
        if (parsed?.data?.resource_id) {
          _brandAttrCache.set(cacheKey, parsed.data.resource_id);
          return parsed.data.resource_id;
        }
      }
      console.warn(`[brand] Failed to create term "${brandName}": ${createResp.status} ${errText.substring(0, 200)}`);
      return null;
    }
    const created = await createResp.json();
    console.log(`[brand] Created brand term "${brandName}" with ID ${created.id}`);
    _brandAttrCache.set(cacheKey, created.id);
    return created.id;
  } catch (e) {
    console.warn(`[brand] Error ensuring term "${brandName}":`, e);
    return null;
  }
}

// ── PWB (Perfect WooCommerce Brands) taxonomy support ──
const _pwbBrandCache = new Map<string, number>();

/**
 * Ensures a brand term exists in the pwb-brand taxonomy (REST: /wp/v2/pwb-brand).
 * Returns the term ID so we can assign it to the product.
 */
async function ensurePwbBrand(baseUrl: string, auth: string, brandName: string): Promise<number | null> {
  if (!brandName) return null;
  const key = brandName.toLowerCase().trim();
  if (_pwbBrandCache.has(key)) return _pwbBrandCache.get(key)!;

  try {
    // Search existing PWB brands
    const searchResp = await fetch(
      `${baseUrl}/wp-json/wp/v2/pwb-brand?search=${encodeURIComponent(brandName)}&per_page=100`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    if (searchResp.ok) {
      const terms = await searchResp.json();
      const match = (terms as any[]).find(
        (t: any) => String(t.name).toLowerCase().trim() === key
      );
      if (match) {
        _pwbBrandCache.set(key, match.id);
        return match.id;
      }
    }

    // Create the brand term
    const createResp = await fetch(`${baseUrl}/wp-json/wp/v2/pwb-brand`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: brandName }),
    });
    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => "");
      if (createResp.status === 400 && errText.includes("term_exists")) {
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.data?.term_id) {
            _pwbBrandCache.set(key, parsed.data.term_id);
            return parsed.data.term_id;
          }
        } catch {}
      }
      console.warn(`[pwb-brand] Failed to create "${brandName}": ${createResp.status}`);
      return null;
    }
    const created = await createResp.json();
    console.log(`[pwb-brand] Created brand "${brandName}" with ID ${created.id}`);
    _pwbBrandCache.set(key, created.id);
    return created.id;
  } catch (e) {
    console.warn(`[pwb-brand] Error ensuring "${brandName}":`, e);
    return null;
  }
}

async function ensureBrandTaxonomy(baseUrl: string, auth: string, brandName: string): Promise<number | null> {
  if (!brandName) return null;
  const key = brandName.toLowerCase().trim();
  if (_pwbBrandCache.has(`brand:${key}`)) return _pwbBrandCache.get(`brand:${key}`)!;

  try {
    const searchResp = await fetch(
      `${baseUrl}/wp-json/wp/v2/brand?search=${encodeURIComponent(brandName)}&per_page=100`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    if (searchResp.ok) {
      const terms = await searchResp.json();
      const match = (terms as any[]).find((t: any) => String(t.name).toLowerCase().trim() === key);
      if (match) {
        _pwbBrandCache.set(`brand:${key}`, match.id);
        return match.id;
      }
    }

    const createResp = await fetch(`${baseUrl}/wp-json/wp/v2/brand`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: brandName }),
    });
    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => "");
      if (createResp.status === 400 && errText.includes("term_exists")) {
        try {
          const parsed = JSON.parse(errText);
          const termId = parsed?.data?.term_id || parsed?.data?.resource_id;
          if (termId) {
            _pwbBrandCache.set(`brand:${key}`, termId);
            return termId;
          }
        } catch {}
      }
      console.warn(`[brand-taxonomy] Failed to create "${brandName}": ${createResp.status}`);
      return null;
    }
    const created = await createResp.json();
    _pwbBrandCache.set(`brand:${key}`, created.id);
    return created.id;
  } catch (e) {
    console.warn(`[brand-taxonomy] Error ensuring "${brandName}":`, e);
    return null;
  }
}

function ensureBrandMeta(target: Record<string, unknown>, brandValue: string) {
  if (!brandValue) return;
  const existingMeta = Array.isArray(target.meta_data) ? target.meta_data as Array<{ key: string; value: string }> : [];
  const upsert = (key: string, value: string) => {
    const idx = existingMeta.findIndex((m) => String(m?.key || "") === key);
    if (idx >= 0) existingMeta[idx] = { key, value };
    else existingMeta.push({ key, value });
  };
  upsert("_brand", brandValue);
  upsert("xstore_brand", brandValue);
  upsert("brand_id", brandValue);
  target.meta_data = existingMeta;
}

function ensureModelMeta(target: Record<string, unknown>, modelValue: string) {

  if (!modelValue) return;
  const existingMeta = Array.isArray(target.meta_data) ? target.meta_data as Array<{ key: string; value: string }> : [];
  const upsert = (key: string, value: string) => {
    const idx = existingMeta.findIndex((m) => String(m?.key || "") === key);
    if (idx >= 0) existingMeta[idx] = { key, value };
    else existingMeta.push({ key, value });
  };
  upsert("_model", modelValue);
  upsert("xstore_model", modelValue);
  target.meta_data = existingMeta;
}


/**
 * Extracts brand value from product attributes array.
 */
function extractBrandFromAttributes(attributes: any): string | null {
  if (!attributes) return null;

  // Handle array format: [{name: "Marca", value: "CLIMA"}]
  if (Array.isArray(attributes)) {
    for (const attr of attributes) {
      const n = String(attr?.name || "").toLowerCase().trim();
      if (n === "marca" || n === "brand") {
        const rawValue = attr?.value ?? attr?.options?.[0] ?? (Array.isArray(attr?.values) ? attr.values[0] : null);
        return String(rawValue || "").trim() || null;
      }
    }
  } 
  // Handle flat object format: {"Marca": "CLIMA", "model": "..."}
  else if (typeof attributes === "object") {
    for (const [key, val] of Object.entries(attributes)) {
      const n = key.toLowerCase().trim();
      if (n === "marca" || n === "brand") {
        return String(val || "").trim() || null;
      }
    }
  }

  return null;
}


async function assignBrandToProductTaxonomies(baseUrl: string, auth: string, brandValue: string, target: Record<string, unknown>) {
  if (!brandValue) return;

  const assignedIds = new Set<number>();

  const brandTaxonomyId = await ensureBrandTaxonomy(baseUrl, auth, brandValue);
  if (brandTaxonomyId) {
    assignedIds.add(brandTaxonomyId);
    (target as any).brand = [brandTaxonomyId];
    console.log(`[brand-taxonomy] Assigned custom brand taxonomy "${brandValue}" (ID ${brandTaxonomyId})`);
  }

  const pwbId = await ensurePwbBrand(baseUrl, auth, brandValue);
  if (pwbId) {
    assignedIds.add(pwbId);
    target.brands = [pwbId];
    console.log(`[pwb-brand] Assigned PWB brand taxonomy "${brandValue}" (ID ${pwbId})`);
  }

  if (assignedIds.size > 0) {
    (target as any).brand = Array.from(assignedIds);
  }
}

function extractBrandValue(product: any, fallbackAttributes?: any[]): string | null {
  // 1. Try explicit brand column
  const fromColumn = String(product?.brand || "").trim();
  if (fromColumn) return fromColumn;

  // 2. Try primary attributes
  const fromPrimaryAttrs = extractBrandFromAttributes(Array.isArray(product?.attributes) ? product.attributes : []);
  if (fromPrimaryAttrs) return fromPrimaryAttrs;

  // 3. Try fallback attributes
  const fromFallbackAttrs = extractBrandFromAttributes(Array.isArray(fallbackAttributes) ? fallbackAttributes : []);
  if (fromFallbackAttrs) return fromFallbackAttrs;

  // 4. Try supplier_ref as last resort (often contains brand)
  const supplierRef = String(product?.supplier_ref || "").trim();
  if (supplierRef) return supplierRef;

  return null;
}

function extractModelValue(product: any, fallbackAttributes?: any): string | null {
  // 1. Try explicit model column
  const fromColumn = String(product?.model || "").trim();
  if (fromColumn) return fromColumn;

  // Helper to extract from attributes (handles both array and object formats)
  const fromAttrs = (attrs: any) => {
    if (!attrs) return null;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        const n = String(attr?.name || "").toLowerCase().trim();
        if (n === "modelo" || n === "model") {
          const rawValue = attr?.value ?? attr?.options?.[0] ?? (Array.isArray(attr?.values) ? attr.values[0] : null);
          if (rawValue) return String(rawValue).trim();
        }
      }
    } else if (typeof attrs === "object") {
      for (const [key, val] of Object.entries(attrs)) {
        const n = key.toLowerCase().trim();
        if (n === "modelo" || n === "model") {
          if (val) return String(val).trim();
        }
      }
    }
    return null;
  };

  // 2. Try primary attributes
  const modelFromPrimary = fromAttrs(product?.attributes);
  if (modelFromPrimary) return modelFromPrimary;

  // 3. Try fallback attributes
  const modelFromFallback = fromAttrs(fallbackAttributes);
  if (modelFromFallback) return modelFromFallback;

  return null;
}



async function findWooProductBySku(baseUrl: string, auth: string, sku: string | null): Promise<number | null> {
  if (!sku) return null;
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&per_page=1`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0 && data[0].id) {
      return data[0].id;
    }
  } catch { /* skip */ }
  return null;
}

async function findWooVariationBySku(baseUrl: string, auth: string, parentWooId: number, sku: string): Promise<number | null> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${parentWooId}/variations?sku=${encodeURIComponent(sku)}&per_page=1`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0 && data[0].id) {
      return data[0].id;
    }
  } catch { /* skip */ }
  return null;
}

async function deleteWooProduct(baseUrl: string, auth: string, productId: number): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${productId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`Falha a eliminar produto ${productId} no WooCommerce: ${resp.status} ${body.substring(0, 200)}`);
    }
    return resp.ok;
  } catch (e: unknown) {
    console.warn(`Exceção ao eliminar produto ${productId} no WooCommerce:`, e);
    return false;
  }
}

async function deleteWooVariation(baseUrl: string, auth: string, parentWooId: number, variationWooId: number): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${parentWooId}/variations/${variationWooId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(
        `Falha a eliminar variação ${variationWooId} (pai ${parentWooId}) no WooCommerce: ${resp.status} ${body.substring(0, 200)}`
      );
    }
    return resp.ok;
  } catch (e: unknown) {
    console.warn(`Exceção ao eliminar variação ${variationWooId} (pai ${parentWooId}) no WooCommerce:`, e);
    return false;
  }
}

async function getWooResource(baseUrl: string, auth: string, resourceId: number): Promise<any | null> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${resourceId}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function getWooVariation(baseUrl: string, auth: string, parentWooId: number, variationWooId: number): Promise<any | null> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${parentWooId}/variations/${variationWooId}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function handleVariationSkuConflict(
  baseUrl: string,
  auth: string,
  parentWooId: number,
  childId: string,
  sku: string,
  variationPayload: Record<string, unknown>,
  skuErr: WooSkuConflictError,
  supabase: any
): Promise<any> {
  const realVarId = await findWooVariationBySku(baseUrl, auth, parentWooId, sku);
  if (realVarId) {
    console.log(`Found existing variation ${realVarId} under parent ${parentWooId} for child ${childId}`);
    const varWooData = await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations/${realVarId}`, "PUT", variationPayload);
    await supabase.from("products").update({ woocommerce_id: realVarId }).eq("id", childId);
    return varWooData;
  }

  const directVar = await getWooVariation(baseUrl, auth, parentWooId, skuErr.resourceId);
  if (directVar?.id) {
    console.log(`SKU conflict resource_id ${skuErr.resourceId} já é variação do pai ${parentWooId}; a atualizar.`);
    const varWooData = await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations/${skuErr.resourceId}`, "PUT", variationPayload);
    await supabase.from("products").update({ woocommerce_id: skuErr.resourceId }).eq("id", childId);
    return varWooData;
  }

  const resource = await getWooResource(baseUrl, auth, skuErr.resourceId);

  if (resource?.type === "variation" && resource?.parent_id) {
    const otherParentId = Number(resource.parent_id);
    if (otherParentId === parentWooId) {
      const varWooData = await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations/${skuErr.resourceId}`, "PUT", variationPayload);
      await supabase.from("products").update({ woocommerce_id: skuErr.resourceId }).eq("id", childId);
      return varWooData;
    }

    console.log(`SKU conflict: resource_id ${skuErr.resourceId} é variação do produto ${otherParentId}; a tentar eliminar e recriar sob ${parentWooId}.`);
    const deleted = await deleteWooVariation(baseUrl, auth, otherParentId, skuErr.resourceId);
    if (!deleted) {
      throw new Error(`SKU conflict: o SKU já existe na variação #${skuErr.resourceId} (pai #${otherParentId}) e não foi possível remover automaticamente.`);
    }
  } else {
    console.log(`SKU conflict resource_id ${skuErr.resourceId} não é variação do pai ${parentWooId}. A tentar eliminar produto standalone e criar como variação.`);
    const deleted = await deleteWooProduct(baseUrl, auth, skuErr.resourceId);
    if (!deleted) {
      throw new Error(`SKU conflict: o SKU já existe no produto #${skuErr.resourceId} e não foi possível remover automaticamente.`);
    }
  }

  try {
    return await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations`, "POST", variationPayload);
  } catch (e: unknown) {
    if (e instanceof WooSkuConflictError) {
      throw new Error(`SKU conflict persistente: o SKU continua a existir no WooCommerce (ID #${e.resourceId}).`);
    }
    throw e;
  }
}

async function resolveSkusToWooIds(supabase: any, adminClient: any, baseUrl: string, auth: string, skus: any[]): Promise<number[]> {
  if (!skus || skus.length === 0) return [];
  const skuList = skus.map((s: any) => typeof s === "string" ? s : s.sku).filter(Boolean);
  if (skuList.length === 0) return [];

  const { data: found } = await supabase
    .from("products")
    .select("sku, woocommerce_id")
    .in("sku", skuList)
    .not("woocommerce_id", "is", null);

  const resolvedIds: number[] = [];
  const resolvedSkus = new Set<string>();

  for (const p of (found || [])) {
    if (p.woocommerce_id) {
      resolvedIds.push(p.woocommerce_id);
      resolvedSkus.add(p.sku);
    }
  }

  const unresolvedSkus = skuList.filter((s: string) => !resolvedSkus.has(s));
  for (const sku of unresolvedSkus) {
    const wooId = await findWooProductBySku(baseUrl, auth, sku);
    if (wooId) {
      resolvedIds.push(wooId);
      await supabase
        .from("products")
        .update({ woocommerce_id: wooId })
        .eq("sku", sku)
        .is("woocommerce_id", null);
    }
  }

  return resolvedIds;
}

// ── Enrich product images from `images` table ──
// Replaces original URLs with optimized versions and adds any extra processed images
// Lifestyle images are inserted as 2nd/3rd position (never first)
async function enrichProductImages(product: any, supabase: any, opts?: { skipOriginals?: boolean; skipLifestyle?: boolean }): Promise<any> {
  const { data: imageRows } = await supabase
    .from("images")
    .select("original_url, optimized_url, sort_order, s3_key, alt_text")
    .eq("product_id", product.id)
    .eq("status", "done")
    .not("optimized_url", "is", null)
    .order("sort_order", { ascending: true });

  if (!imageRows || imageRows.length === 0) return product;

  const urls: string[] = Array.isArray(product.image_urls) ? [...product.image_urls] : [];

  // Separate lifestyle from regular optimized images
  const lifestyleUrls: string[] = [];
  const optimizedMap = new Map<string, string>();

  // Build alt text migration map: when original→optimized, carry over alt text
  const existingAlts = product.image_alt_texts && typeof product.image_alt_texts === "object" && !Array.isArray(product.image_alt_texts)
    ? { ...product.image_alt_texts } : {};

  for (const row of imageRows) {
    const isLifestyle = row.s3_key && String(row.s3_key).includes("lifestyle");
    if (isLifestyle && row.optimized_url) {
      lifestyleUrls.push(row.optimized_url);
      // Add alt text for lifestyle images from images table
      if (row.alt_text) existingAlts[row.optimized_url] = row.alt_text;
    } else if (row.original_url && row.optimized_url) {
      optimizedMap.set(row.original_url, row.optimized_url);
      // Migrate alt text from original URL to optimized URL
      if (existingAlts[row.original_url] && !existingAlts[row.optimized_url]) {
        existingAlts[row.optimized_url] = existingAlts[row.original_url];
      }
      // Also use alt_text from images table if available
      if (row.alt_text && !existingAlts[row.optimized_url]) {
        existingAlts[row.optimized_url] = row.alt_text;
      }
    }
  }

  const skipOriginals = opts?.skipOriginals ?? false;
  const skipLifestyle = opts?.skipLifestyle ?? false;

  // Replace originals with optimized versions
  let enriched: string[];
  if (skipOriginals && optimizedMap.size > 0) {
    // Only include URLs that have optimized versions (skip originals that weren't optimized)
    enriched = urls
      .map((url: string) => optimizedMap.get(url) || (optimizedMap.has(url) ? null : null))
      .filter(Boolean) as string[];
    // Actually: keep URLs that have an optimized replacement, drop originals without one
    enriched = [];
    for (const url of urls) {
      const opt = optimizedMap.get(url);
      if (opt) enriched.push(opt); // Use optimized version
      // Skip original if skipOriginals is true and an optimized version exists for any image
    }
  } else {
    enriched = urls.map((url: string) => optimizedMap.get(url) || url);
  }

  // Add any non-lifestyle optimized URLs not already in the list
  for (const row of imageRows) {
    const isLifestyle = row.s3_key && String(row.s3_key).includes("lifestyle");
    if (!isLifestyle && row.optimized_url && !enriched.includes(row.optimized_url)) {
      enriched.push(row.optimized_url);
    }
  }

  // Insert lifestyle images as 2nd/3rd position (after the first/main image)
  let finalList = enriched;
  if (!skipLifestyle && lifestyleUrls.length > 0 && enriched.length > 0) {
    const firstImage = enriched[0];
    const rest = enriched.slice(1);
    const newLifestyle = lifestyleUrls.filter(u => !enriched.includes(u));
    finalList = [firstImage, ...newLifestyle, ...rest];
    console.log(`[enrichProductImages] Product ${product.id}: ${urls.length} original → ${finalList.length} enriched (${lifestyleUrls.length} lifestyle, skipOrig=${skipOriginals}, skipLife=${skipLifestyle})`);
  } else {
    console.log(`[enrichProductImages] Product ${product.id}: ${urls.length} original → ${enriched.length} enriched (skipOrig=${skipOriginals}, skipLife=${skipLifestyle})`);
  }

  return { ...product, image_urls: finalList, image_alt_texts: existingAlts };
}

// ── Image reference resolution ──
const IMAGE_EXTENSIONS = /\.(webp|jpeg|jpg|png|gif|svg|bmp|avif|tiff|tif)$/i;
const imageCache = new Map<string, Record<string, unknown>>();

function resetImageCache() {
  imageCache.clear();
}

async function searchWPMediaByFilename(baseUrl: string, auth: string, filename: string): Promise<number | null> {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
  if (!nameWithoutExt) return null;

  try {
    const resp = await fetch(
      `${baseUrl}/wp-json/wp/v2/media?search=${encodeURIComponent(nameWithoutExt)}&per_page=20`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    if (!resp.ok) {
      console.warn(`WP Media search failed: ${resp.status}`);
      return null;
    }
    const items = await resp.json();
    if (!Array.isArray(items) || items.length === 0) return null;

    const filenameLower = filename.toLowerCase();
    for (const item of items) {
      const srcUrl = String(item.source_url || "");
      const srcFilename = srcUrl.split("/").pop()?.toLowerCase() || "";
      if (srcFilename === filenameLower) return item.id;
    }

    const nameWithoutExtLower = nameWithoutExt.toLowerCase();
    for (const item of items) {
      const slug = String(item.slug || "").toLowerCase();
      if (slug === nameWithoutExtLower) return item.id;
      const title = String(item.title?.rendered || "").toLowerCase().replace(/<[^>]*>/g, "").trim();
      if (title === nameWithoutExtLower) return item.id;
    }

    if (items.length === 1) return items[0].id;

    return null;
  } catch (e: unknown) {
    console.warn(`WP Media search exception for "${filename}":`, e);
    return null;
  }
}

const SUPABASE_STORAGE_PATTERN = /supabase\.co\/storage\/v1\/object\/public\//;

async function uploadImageToWPMedia(
  sourceUrl: string,
  baseUrl: string,
  auth: string,
  filename?: string
): Promise<number | null> {
  try {
    const resp = await fetch(sourceUrl);
    if (!resp.ok) {
      console.warn(`Failed to download image from ${sourceUrl}: ${resp.status}`);
      return null;
    }
    const blob = await resp.blob();
    const contentType = resp.headers.get("content-type") || "image/webp";

    const fname = filename || sourceUrl.split("/").pop() || `image_${Date.now()}.webp`;

    const formData = new FormData();
    formData.append("file", new File([blob], fname, { type: contentType }));

    const uploadResp = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      body: formData,
    });

    if (!uploadResp.ok) {
      const errText = await uploadResp.text().catch(() => "");
      console.warn(`Failed to upload image to WP Media: ${uploadResp.status} ${errText.substring(0, 200)}`);
      return null;
    }

    const mediaData = await uploadResp.json();
    console.log(`✅ Uploaded image to WP Media: ID ${mediaData.id}, filename ${fname}`);
    return mediaData.id;
  } catch (e: unknown) {
    console.warn(`Exception uploading image to WP Media:`, e);
    return null;
  }
}

async function resolveImageRef(
  ref: string,
  position: number,
  baseUrl: string,
  auth: string,
  altText?: string,
  hasAlt?: boolean
): Promise<Record<string, unknown> | null> {
  const trimmed = String(ref || "").trim();
  if (!trimmed) return null;

  const img: Record<string, unknown> = { position };

  if (/^\d+$/.test(trimmed)) {
    img.id = parseInt(trimmed, 10);
    if (hasAlt && altText) img.alt = altText;
    return img;
  }

  if (trimmed.startsWith("http")) {
    if (SUPABASE_STORAGE_PATTERN.test(trimmed)) {
      const cached = imageCache.get(trimmed);
      if (cached) {
        const result = { ...cached, position };
        if (hasAlt && altText) result.alt = altText;
        return result;
      }

      const mediaId = await uploadImageToWPMedia(trimmed, baseUrl, auth);
      if (mediaId) {
        const entry: Record<string, unknown> = { id: mediaId };
        imageCache.set(trimmed, entry);
        img.id = mediaId;
        if (hasAlt && altText) img.alt = altText;
        console.log(`✅ Supabase image uploaded to WP Media: ${trimmed} → ID ${mediaId}`);
        return img;
      }
      console.warn(`⚠️ Failed to upload Supabase image to WP, falling back to src: ${trimmed}`);
    }

    img.src = trimmed;
    if (hasAlt && altText) img.alt = altText;
    return img;
  }

  if (IMAGE_EXTENSIONS.test(trimmed)) {
    const cached = imageCache.get(trimmed);
    if (cached) {
      const result = { ...cached, position };
      if (hasAlt && altText) result.alt = altText;
      return result;
    }

    const mediaId = await searchWPMediaByFilename(baseUrl, auth, trimmed);
    if (mediaId) {
      const entry: Record<string, unknown> = { id: mediaId };
      imageCache.set(trimmed, entry);
      img.id = mediaId;
      if (hasAlt && altText) img.alt = altText;
      console.log(`✅ Resolved image "${trimmed}" → WP Media ID ${mediaId}`);
      return img;
    }

    const fallbackUrl = `${baseUrl}/wp-content/uploads/${trimmed}`;
    const entry: Record<string, unknown> = { src: fallbackUrl };
    imageCache.set(trimmed, entry);
    img.src = fallbackUrl;
    if (hasAlt && altText) img.alt = altText;
    console.warn(`⚠️ Image "${trimmed}" not found in Media Library, using fallback: ${fallbackUrl}`);
    return img;
  }

  img.src = trimmed;
  if (hasAlt && altText) img.alt = altText;
  return img;
}

function buildImageEntry(ref: string, position: number, altText?: string, hasAlt?: boolean): Record<string, unknown> {
  const trimmed = String(ref || "").trim();
  const img: Record<string, unknown> = { position };
  if (/^\d+$/.test(trimmed)) {
    img.id = parseInt(trimmed, 10);
  } else {
    img.src = trimmed;
  }
  if (hasAlt && altText) img.alt = altText;
  return img;
}

// ── FAQ HTML builder ──
function buildFaqHtml(faq: any[]): string {
  if (!Array.isArray(faq) || faq.length === 0) return "";
  const items = faq.slice(0, 4).map((item: any) => {
    const q = typeof item === "string" ? item : (item?.question || item?.q || "");
    const a = typeof item === "string" ? "" : (item?.answer || item?.a || "");
    if (!q) return "";
    return `<div style="margin-bottom:12px;"><p style="font-weight:bold;color:#00526d;margin:0 0 4px 0;">${q}</p>${a ? `<p style="color:#6b7280;font-style:italic;margin:0;">${a}</p>` : ""}</div>`;
  }).filter(Boolean);
  if (items.length === 0) return "";
  return `<!-- HOTELEQUIP:FAQ_START --><div class="hotelequip-faq" style="margin-top:24px;"><h3 style="color:#00526d;font-size:18px;margin-bottom:12px;">Perguntas Frequentes</h3>${items.join("")}</div><!-- HOTELEQUIP:FAQ_END -->`;
}

// ── FAQ JSON for custom field (Yoast/RankMath Schema) ──
function buildFaqSchemaJson(faq: any[]): string {
  if (!Array.isArray(faq) || faq.length === 0) return "[]";
  const entries = faq.slice(0, 4).map((item: any) => ({
    question: typeof item === "string" ? item : (item?.question || item?.q || ""),
    answer: typeof item === "string" ? "" : (item?.answer || item?.a || ""),
  })).filter(e => e.question);
  return JSON.stringify(entries);
}

// ── Uso Profissional HTML builder ──
// Mirrors the format used in src/components/UsoProfissionalTab.tsx (buildUsoHtml)
// so o WooCommerce mostra exatamente o mesmo conteúdo do preview da otimização.
function buildUsoProfissionalHtml(data: any): string {
  if (!data) return "";

  const intro: string = data.intro || "";
  const useCases = Array.isArray(data.use_cases) ? data.use_cases : [];
  const tips = Array.isArray(data.professional_tips) ? data.professional_tips : [];
  const profiles = Array.isArray(data.target_profiles) ? data.target_profiles : [];

  // Need at least intro or use cases or tips to render anything meaningful
  if (!intro && useCases.length === 0 && tips.length === 0 && profiles.length === 0) return "";

  const sections: string[] = [];

  // Heading
  sections.push(
    `<h3 style="font-size:1.1em;font-weight:600;margin-bottom:0.75em;color:#00526d;">Como é usado por profissionais</h3>`
  );

  // Intro
  if (intro) {
    sections.push(`<p style="color:#374151;line-height:1.7;margin:0 0 1em;">${intro}</p>`);
  }

  // Use Cases — list with "Title: Description" inline (formato do preview)
  if (useCases.length > 0) {
    const items = useCases
      .map((uc: any) => {
        const title = uc.context || uc.title || uc.name || "";
        const desc = uc.description || uc.text || "";
        if (!title && !desc) return "";
        if (title && desc) {
          return `<li style="margin-bottom:0.5em;"><strong>${title}:</strong> ${desc}</li>`;
        }
        return `<li style="margin-bottom:0.5em;">${title || desc}</li>`;
      })
      .filter(Boolean);
    if (items.length > 0) {
      sections.push(`<h4 style="font-weight:600;margin:1em 0 0.5em;color:#00526d;">Contextos de utilização</h4>`);
      sections.push(`<ul style="padding-left:1.25em;color:#374151;line-height:1.6;">${items.join("")}</ul>`);
    }
  }

  // Professional tips
  if (tips.length > 0) {
    const items = tips
      .map((t: any) => {
        const text = typeof t === "string" ? t : (t?.tip || t?.text || "");
        return text ? `<li style="margin-bottom:0.25em;">${text}</li>` : "";
      })
      .filter(Boolean);
    if (items.length > 0) {
      sections.push(`<h4 style="font-weight:600;margin:1em 0 0.5em;color:#00526d;">Dicas de profissionais</h4>`);
      sections.push(`<ul style="padding-left:1.25em;color:#374151;line-height:1.6;">${items.join("")}</ul>`);
    }
  }

  // Target profiles (mantém — útil para HORECA, mas opcional)
  if (profiles.length > 0) {
    const items = profiles
      .map((p: any) => (typeof p === "string" ? p : p?.name || ""))
      .filter(Boolean);
    if (items.length > 0) {
      sections.push(`<h4 style="font-weight:600;margin:1em 0 0.5em;color:#00526d;">Perfis Profissionais</h4>`);
      sections.push(`<p style="color:#374151;line-height:1.6;margin:0;">${items.join(" · ")}</p>`);
    }
  }

  return `<!-- HOTELEQUIP:USO_PROFISSIONAL_START --><div class="uso-profissional-hotelequip" style="margin-top:2em;padding-top:1.5em;border-top:1px solid #e5e7eb;">${sections.join("")}</div><!-- HOTELEQUIP:USO_PROFISSIONAL_END -->`;
}

// ── Uso Profissional JSON for custom field (_product_conselhos repeater) ──
function buildUsoProfissionalJson(data: any): string {
  if (!data) return "[]";
  const repeater: Array<{ title: string; description: string }> = [];

  // Add intro as first item if present
  if (data.intro) {
    repeater.push({ title: "Introdução", description: String(data.intro) });
  }

  // Add use cases (context = title in the DB)
  if (Array.isArray(data.use_cases)) {
    for (const uc of data.use_cases) {
      if (typeof uc === "string") {
        repeater.push({ title: "Caso de Uso", description: uc });
      } else if (uc && typeof uc === "object") {
        repeater.push({ title: String(uc.context || uc.title || uc.name || "Caso de Uso"), description: String(uc.description || uc.text || "") });
      }
    }
  }

  // Add professional tips
  if (Array.isArray(data.professional_tips)) {
    for (const tip of data.professional_tips) {
      if (typeof tip === "string") {
        repeater.push({ title: "Dica Profissional", description: tip });
      } else if (tip && typeof tip === "object") {
        repeater.push({ title: String(tip.title || tip.name || "Dica Profissional"), description: String(tip.description || tip.text || "") });
      }
    }
  }

  // Add target profiles
  if (Array.isArray(data.target_profiles)) {
    for (const tp of data.target_profiles) {
      if (typeof tp === "string") {
        repeater.push({ title: "Perfil Alvo", description: tp });
      } else if (tp && typeof tp === "object") {
        repeater.push({ title: String(tp.title || tp.name || "Perfil Alvo"), description: String(tp.description || tp.text || "") });
      }
    }
  }

  return JSON.stringify(repeater);
}

// ── Inject or replace a block in description using HTML markers ──
function injectOrReplaceBlock(description: string, startMarker: string, endMarker: string, newBlock: string): string {
  const startIdx = description.indexOf(startMarker);
  const endIdx = description.indexOf(endMarker);
  if (startIdx >= 0 && endIdx >= 0) {
    return description.substring(0, startIdx) + newBlock + description.substring(endIdx + endMarker.length);
  }
  return description + newBlock;
}

// ── Enrich WooCommerce payload with FAQ & Uso Profissional ──
async function enrichWithExtraContent(
  wooProduct: Record<string, unknown>,
  product: any,
  supabase: any,
  adminClient: any,
  has: (k: string) => boolean,
  seoPlugin: string = 'rankmath'
) {
  const ensureMeta = (): Array<{ key: string; value: string }> => {
    if (!Array.isArray(wooProduct.meta_data)) wooProduct.meta_data = [];
    return wooProduct.meta_data as Array<{ key: string; value: string }>;
  };

  // ── FAQ ──
  const faq = Array.isArray(product.faq) ? product.faq : [];
  if (faq.length > 0) {
    const wantsFaqCustom = has("faq_custom_field");
    const wantsFaqInDesc = has("faq_in_description");

    // --- FAQ STRIPPING (Default: remove from description if not explicitly requested) ---
    if (!wantsFaqInDesc) {
      let desc = String(wooProduct.description || product.optimized_description || product.original_description || "");
      if (desc.includes("product-faq")) {
        desc = desc.replace(/<div\s+class=["']product-faq["'][\s\S]*?<\/div>\s*<\/div>/gi, "");
        console.log(`[enrichExtraContent] Inline FAQ div stripped by default for ${product.id}`);
      }
      wooProduct.description = desc;
    }
    if (wantsFaqInDesc && !wantsFaqCustom) {
      const faqHtml = buildFaqHtml(faq);
      if (faqHtml) {
        const currentDesc = String(wooProduct.description || product.optimized_description || product.original_description || "");
        wooProduct.description = injectOrReplaceBlock(
          currentDesc,
          "<!-- HOTELEQUIP:FAQ_START -->",
          "<!-- HOTELEQUIP:FAQ_END -->",
          faqHtml
        );
        console.log(`[enrichExtraContent] FAQ injected in description for ${product.id}`);
      }
    } else if (wantsFaqCustom && wantsFaqInDesc) {
      // Both selected: still inject in description AND send to custom field
      const faqHtml = buildFaqHtml(faq);
      if (faqHtml) {
        const currentDesc = String(wooProduct.description || product.optimized_description || product.original_description || "");
        wooProduct.description = injectOrReplaceBlock(
          currentDesc,
          "<!-- HOTELEQUIP:FAQ_START -->",
          "<!-- HOTELEQUIP:FAQ_END -->",
          faqHtml
        );
        console.log(`[enrichExtraContent] FAQ injected in description for ${product.id}`);
      }
    } else if (wantsFaqCustom) {
      // Custom field only — strip FAQ from description if present
      let desc = String(wooProduct.description || "");
      // Strip marker-based FAQ blocks
      if (desc.includes("<!-- HOTELEQUIP:FAQ_START -->")) {
        desc = injectOrReplaceBlock(desc, "<!-- HOTELEQUIP:FAQ_START -->", "<!-- HOTELEQUIP:FAQ_END -->", "");
        console.log(`[enrichExtraContent] FAQ markers removed from description for ${product.id}`);
      }
      // Also strip inline product-faq divs (embedded by optimize-product)
      if (desc.includes('class="product-faq"') || desc.includes("product-faq")) {
        desc = desc.replace(/<div\s+class=["']product-faq["'][\s\S]*?<\/div>\s*<\/div>/gi, "");
        console.log(`[enrichExtraContent] Inline FAQ div removed from description for ${product.id}`);
      }
      // Strip "Perguntas Frequentes" h3 sections that might be standalone
      desc = desc.replace(/<h3[^>]*>Perguntas Frequentes<\/h3>[\s\S]*?(?=<h3|<div class="hotelequip|<!-- HOTELEQUIP|$)/gi, (match) => {
        // Only strip if it looks like an FAQ section (has Q&A patterns)
        if (match.includes("font-weight:bold") || match.includes("font-style:italic")) {
          console.log(`[enrichExtraContent] Standalone FAQ h3 section removed from description for ${product.id}`);
          return "";
        }
        return match;
      });
      wooProduct.description = desc.trim();
    }

    // FAQ to custom field
    if (wantsFaqCustom) {
      const meta = ensureMeta();
      meta.push({ key: "_product_faq", value: buildFaqSchemaJson(faq) });
      meta.push({ key: "_product_faqs", value: buildFaqSchemaJson(faq) }); // Backward compat
      meta.push({ key: "_yoast_wpseo_schema_page_type", value: "FAQPage" });
      console.log(`[enrichExtraContent] FAQ sent to custom meta field for ${product.id}`);
    }
  }

  // ── SEO Short Description (clean text for og:description) ──
  if (has("short_description") || has("meta_description")) {
    const cleanShort = product.seo_short_description || product.optimized_short_description || product.short_description || "";
    if (cleanShort) {
      // Get SEO plugin config
      const { data: wsSettings } = await adminClient
        .from("workspace_settings")
        .select("seo_plugin")
        .eq("workspace_id", product.workspace_id)
        .maybeSingle();

      const seoPlugin = wsSettings?.seo_plugin || 'rankmath';

      if (seoPlugin === 'rankmath') {
        const meta = ensureMeta();
        meta.push({ 
          key: 'rank_math_snippet_description', 
          value: cleanShort.substring(0, 160)
        });
        console.log(`[seo-short] Injected clean short_description for RankMath`);
      } else if (seoPlugin === 'yoast') {
        const meta = ensureMeta();
        meta.push({ 
          key: '_yoast_wpseo_metadesc', 
          value: cleanShort.substring(0, 160)
        });
        console.log(`[seo-short] Injected clean short_description for Yoast`);
      }
    }
  }

  // ── Uso Profissional ──
  const wantsUsoInDesc = has("uso_profissional_in_description");
  const wantsUsoCustom = has("uso_profissional_custom_field");

  if (wantsUsoInDesc || wantsUsoCustom) {
    // Prefer the pre-rendered HTML content directly from the product row if available
    let usoHtml = product.professional_use_content || "";
    let usoData: any = null;

    if (!usoHtml || wantsUsoCustom) {
      const { data } = await adminClient
        .from("product_uso_profissional")
        .select("intro, use_cases, professional_tips, target_profiles, publish_enabled, placement")
        .eq("product_id", product.id)
        .maybeSingle();
      usoData = data;
      if (usoData && !usoHtml) {
        usoHtml = buildUsoProfissionalHtml(usoData);
      }
    }

    if (usoHtml || (usoData && usoData.publish_enabled)) {
      // Inject in description — ONLY if explicitly selected AND custom field is NOT selected (avoid duplication)
      // If both are selected, inject in both places
      const shouldInjectInDesc = wantsUsoInDesc && (!wantsUsoCustom || (wantsUsoInDesc && wantsUsoCustom));

      if (shouldInjectInDesc) {
        const usoHtml = buildUsoProfissionalHtml(usoData);
        if (usoHtml) {
          let currentDesc = String(wooProduct.description || product.optimized_description || product.original_description || "");
          const placement = usoData.placement || "before_faq";
          if (placement === "before_faq" && currentDesc.includes("<!-- HOTELEQUIP:FAQ_START -->")) {
            const faqIdx = currentDesc.indexOf("<!-- HOTELEQUIP:FAQ_START -->");
            currentDesc = currentDesc.substring(0, faqIdx) + usoHtml + currentDesc.substring(faqIdx);
            currentDesc = currentDesc.replace(/<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->[\s\S]*?<!-- HOTELEQUIP:USO_PROFISSIONAL_END -->/g, "");
            wooProduct.description = injectOrReplaceBlock(
              currentDesc.replace(usoHtml, ""),
              "<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->",
              "<!-- HOTELEQUIP:USO_PROFISSIONAL_END -->",
              ""
            );
            const desc = String(wooProduct.description);
            const faqPos = desc.indexOf("<!-- HOTELEQUIP:FAQ_START -->");
            if (faqPos >= 0) {
              wooProduct.description = desc.substring(0, faqPos) + usoHtml + desc.substring(faqPos);
            } else {
              wooProduct.description = desc + usoHtml;
            }
          } else {
            wooProduct.description = injectOrReplaceBlock(
              currentDesc,
              "<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->",
              "<!-- HOTELEQUIP:USO_PROFISSIONAL_END -->",
              usoHtml
            );
          }
          console.log(`[enrichExtraContent] Uso Profissional injected in description for ${product.id} (placement: ${placement})`);
        }
      } else if (wantsUsoCustom && !wantsUsoInDesc) {
        // Custom field only — strip Uso Profissional from description if present
        if (wooProduct.description && String(wooProduct.description).includes("<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->")) {
          wooProduct.description = injectOrReplaceBlock(
            String(wooProduct.description),
            "<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->",
            "<!-- HOTELEQUIP:USO_PROFISSIONAL_END -->",
            ""
          );
          console.log(`[enrichExtraContent] Uso Profissional removed from description for ${product.id} (custom field only)`);
        }
      }

      if (wantsUsoCustom) {
        const meta = ensureMeta() as any[];
        const existingIdx = meta.findIndex(m => m.key === '_product_conselhos');
        if (existingIdx === -1) {
          meta.push({ key: "_product_conselhos", value: buildUsoProfissionalJson(usoData) });
          console.log(`[enrichExtraContent] Uso Profissional sent to custom meta field for ${product.id}`);
        } else {
          console.log(`[enrichExtraContent] _product_conselhos already set, skipping legacy JSON injection`);
        }
      }
    }
  }
}

async function buildBasePayload(
  product: any,
  supabase: any,
  baseUrl: string,
  auth: string,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number
): Promise<Record<string, unknown>> {
  const wooProduct: Record<string, unknown> = {};

  if (has("title")) {
    wooProduct.name = product.optimized_title || product.original_title || "Sem título";
  }

  if (has("description")) {
    wooProduct.description = product.optimized_description || product.original_description || "";
  }

  if (has("short_description")) {
    const rawShort = product.optimized_short_description || product.short_description || "";
    // Style the short description with a highlighted box for WooCommerce
    if (rawShort) {
      wooProduct.short_description = `<div class="hotelequip-short-description" style="background:linear-gradient(135deg,#eef6fb 0%,#e8f1f8 100%);border-left:4px solid #0077b6;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:12px;"><p style="color:#1a3a4a;font-size:15px;line-height:1.7;margin:0;">${rawShort}</p></div>`;
    } else {
      wooProduct.short_description = "";
    }
  }

  if (has("price")) {
    let basePrice = parseFloat(product.optimized_price || product.original_price || "0") || 0;
    if (markupPercent > 0) basePrice = basePrice * (1 + markupPercent / 100);
    wooProduct.regular_price = basePrice.toFixed(2);

    if (has("sale_price") && discountPercent > 0) {
      wooProduct.sale_price = (basePrice * (1 - discountPercent / 100)).toFixed(2);
    }
  }

  if (has("sale_price") && !wooProduct.sale_price) {
    const sp = product.optimized_sale_price ?? product.sale_price;
    if (sp != null) wooProduct.sale_price = String(sp);
  }

  if (has("sku")) {
    wooProduct.sku = product.sku || undefined;
  }

  if (has("stock") && product.stock !== undefined && product.stock !== null) {
    wooProduct.manage_stock = true;
    wooProduct.stock_quantity = parseInt(String(product.stock), 10);
    wooProduct.stock_status = wooProduct.stock_quantity > 0 ? "instock" : "outofstock";
  }

  // IMPORTANT: Never overwrite the WooCommerce slug/permalink.
  // The seo_slug is metadata only (for Yoast/RankMath); the product URL must remain stable.
  // If you need to set slug on first publish, use the original WooCommerce slug or SKU-based fallback.
  // if (has("slug")) { ... } — intentionally disabled to preserve URL stability.

  if (has("images")) {
    if (product.image_urls && product.image_urls.length > 0) {
      // image_alt_texts can be: object {url: altText}, array [{url, alt_text}], or array [string]
      const rawAlts = product.image_alt_texts;
      const altMap = new Map<string, string>();
      if (rawAlts && typeof rawAlts === "object" && !Array.isArray(rawAlts)) {
        // Object format: { "https://...image.jpg": "alt text" }
        for (const [url, alt] of Object.entries(rawAlts)) {
          if (typeof alt === "string") altMap.set(url, alt);
        }
      } else if (Array.isArray(rawAlts)) {
        for (const item of rawAlts) {
          if (typeof item === "object" && item?.url && item?.alt_text) {
            altMap.set(item.url, item.alt_text);
          }
        }
      }
      // Fallback alt text: optimized_title or original_title (ensures every image has alt for SEO)
      const fallbackAlt: string = String(
        product.optimized_title || product.meta_title || product.original_title || product.sku || ""
      ).trim();
      const wantsAlt = has("image_alt_text");
      const imagePromises = product.image_urls.map((ref: string, i: number) => {
        // Look up alt text by URL key (works with both original and optimized URLs)
        let altStr = altMap.get(ref) || "";
        if (!altStr && wantsAlt && fallbackAlt) {
          // Use product title as fallback so we never publish images without alt
          altStr = i === 0 ? fallbackAlt : `${fallbackAlt} - imagem ${i + 1}`;
        }
        return resolveImageRef(ref, i, baseUrl, auth, altStr, wantsAlt && !!altStr);
      });
      const resolved = await Promise.all(imagePromises);
      const filteredImages = resolved.filter(Boolean);
      // NEVER send images:[] — omit the field entirely if no images resolved
      if (filteredImages.length > 0) {
        wooProduct.images = filteredImages;
      }
      console.log(`[buildBasePayload] Product images: ${product.image_urls.length} input → ${filteredImages.length} resolved, alt texts found: ${altMap.size}`);
    }
  }

  if (has("categories")) {
    if (product.category_id) {
      const { data: catRow } = await supabase
        .from("categories")
        .select("woocommerce_id, name, parent_id")
        .eq("id", product.category_id)
        .single();
      if (catRow?.woocommerce_id) {
        const catIds: Array<{ id: number }> = [{ id: catRow.woocommerce_id }];
        let parentId = catRow.parent_id;
        while (parentId) {
          const { data: parentCat } = await supabase
            .from("categories")
            .select("woocommerce_id, parent_id")
            .eq("id", parentId)
            .single();
          if (parentCat?.woocommerce_id) catIds.push({ id: parentCat.woocommerce_id });
          parentId = parentCat?.parent_id || null;
        }
        wooProduct.categories = catIds;
      } else if (catRow) {
        wooProduct.categories = [{ name: catRow.name }];
      }
    } else if (product.category) {
      const parts = product.category.split(/>/).map((s: string) => s.trim()).filter(Boolean);
      const resolveCatName = async (name: string): Promise<number | null> => {
        const { data: localCats } = await supabase
          .from("categories")
          .select("woocommerce_id")
          .ilike("name", name)
          .not("woocommerce_id", "is", null)
          .limit(1);
        if (localCats && localCats.length > 0 && localCats[0].woocommerce_id) {
          return localCats[0].woocommerce_id;
        }
        try {
          const searchResp = await fetch(
            `${baseUrl}/wp-json/wc/v3/products/categories?search=${encodeURIComponent(name)}&per_page=10`,
            { headers: { Authorization: `Basic ${auth}` } }
          );
          if (searchResp.ok) {
            const wooCats = await searchResp.json();
            const exactMatch = wooCats.find((c: any) => c.name.toLowerCase() === name.toLowerCase());
            if (exactMatch) return exactMatch.id;
          }
        } catch {
          /* skip */
        }
        return null;
      };

      const resolvedCatIds: Array<{ id: number }> = [];
      for (const part of parts) {
        const wcId = await resolveCatName(part);
        if (wcId) resolvedCatIds.push({ id: wcId });
      }
      if (resolvedCatIds.length > 0) wooProduct.categories = resolvedCatIds;
    }
  }

  if (has("tags")) {
    let rawTags: string[] = [];
    if (Array.isArray(product.tags)) {
      rawTags = product.tags;
    } else if (typeof product.tags === "string") {
      try { rawTags = JSON.parse(product.tags); } catch { rawTags = product.tags.split(",").map((s: string) => s.trim()); }
    }
    const cleanTags = rawTags
      .map((t: any) => typeof t === "string" ? t.trim() : typeof t === "object" && t?.name ? String(t.name).trim() : "")
      .filter((t: string) => t.length > 0);
    if (cleanTags.length > 0) {
      wooProduct.tags = cleanTags.map((name: string) => ({ name }));
      console.log(`[publish] Tags for ${product.id}: ${cleanTags.join(", ")}`);
    }
  }

  // ── SEO Meta (RankMath / Yoast / Custom) ──
  if (has("meta_title") || has("meta_description") || has("focus_keyword")) {
    // Get workspace SEO plugin config (default: rankmath)
    const { data: wsSettings } = await adminClient
      .from("workspace_settings")
      .select("seo_plugin")
      .eq("workspace_id", product.workspace_id) // Fix: use product.workspace_id instead of undefined job.workspace_id
      .maybeSingle();
    
    const seoPlugin = wsSettings?.seo_plugin || 'rankmath';
    const fieldMap = getSeoFieldMapping(seoPlugin);
    
    if (fieldMap) {
      const seoMeta: Array<{ key: string; value: any }> = [];
      
      if (has("meta_title") && product.meta_title) {
        seoMeta.push({ key: fieldMap.title, value: product.meta_title });
      }
      
      if (has("meta_description") && product.meta_description) {
        seoMeta.push({ key: fieldMap.description, value: product.meta_description });
      }
      
      if (has("focus_keyword") && (product.focus_keyword || product.seo_keywords?.[0])) {
        seoMeta.push({ 
          key: fieldMap.focusKeyword, 
          value: product.focus_keyword || (Array.isArray(product.seo_keywords) ? product.seo_keywords[0] : "") 
        });
      }
      
      // RankMath-specific: robots meta (serialized PHP array)
      if (fieldMap.robots && seoPlugin === 'rankmath') {
        seoMeta.push({ key: fieldMap.robots, value: "a:1:{i:0;s:5:\"index\";}" });
      }
      
      // Merge with existing meta_data
      if (!Array.isArray(wooProduct.meta_data)) wooProduct.meta_data = [];
      wooProduct.meta_data.push(...seoMeta);
      
      console.log(`[seo-meta] Injected ${seoMeta.length} fields for plugin: ${seoPlugin}`);
    } else {
      console.log(`[seo-meta] Skipped (plugin: ${seoPlugin})`);
    }
  }

  // ── Certifications Meta ──
  if (Array.isArray(product.certifications) && product.certifications.length > 0) {
    if (!Array.isArray(wooProduct.meta_data)) wooProduct.meta_data = [];
    
    wooProduct.meta_data.push({
      key: '_product_certifications',
      value: JSON.stringify(product.certifications)
    });
    
    console.log(`[certifications] Injected ${product.certifications.length} certifications`);
  }


  // ── Professional Use Content as Editorial Review (Schema) ──
  if (product.professional_use_content && product.professional_use_content.trim().length > 0) {
    // Strip HTML to get clean text for Schema reviewBody
    let cleanReview = product.professional_use_content
      .replace(/<script[^>]*>.*?<\/script>/gis, '')  // Remove any script tags
      .replace(/<style[^>]*>.*?<\/style>/gis, '')    // Remove style blocks
      .replace(/<[^>]+>/g, ' ')                       // Remove all HTML tags
      .replace(/&nbsp;/g, ' ')                        // Replace &nbsp;
      .replace(/&[a-z]+;/gi, '')                      // Remove other HTML entities
      .replace(/\s+/g, ' ')                           // Normalize whitespace
      .trim();
    
    // Limit to reasonable length for review (1000 chars is typical for editorial reviews)
    cleanReview = cleanReview.substring(0, 1000);
    
    // Only inject if we have substantive content (min 100 chars)
    if (cleanReview.length >= 100) {
      if (!Array.isArray(wooProduct.meta_data)) {
        wooProduct.meta_data = [];
      }
      
      // Check if already exists to avoid duplicates
      const meta = wooProduct.meta_data as any[];
      const existingIdx = meta.findIndex(m => m.key === '_product_conselhos');
      if (existingIdx >= 0) {
        meta[existingIdx].value = cleanReview;
      } else {
        meta.push({
          key: '_product_conselhos',
          value: cleanReview
        });
      }
      
      console.log(`[schema-review] Injected professional use content as editorial review (${cleanReview.length} chars)`);
    } else {
      console.log(`[schema-review] Skipped - content too short (${cleanReview.length} chars, min: 100)`);
    }
  } else {
    console.log('[schema-review] No professional_use_content available');
  }


  if (product.product_type !== "variable" && !product.parent_product_id) {
    let productAttrs: any[] = [];
    if (Array.isArray(product.attributes)) {
      productAttrs = [...product.attributes];
    } else if (product.attributes && typeof product.attributes === "object") {
      // Convert flat object to array format
      productAttrs = Object.entries(product.attributes).map(([name, value]) => ({
        name,
        value: String(value)
      }));
    }

    
    // Inject Marca and Modelo from top-level columns if they are missing from attributes
    const hasMarca = productAttrs.some(a => {
      const n = String(a?.name || "").toLowerCase().trim();
      return n === "marca" || n === "brand";
    });
    if (!hasMarca && product.brand) {
      productAttrs.push({ name: "Marca", value: product.brand, variation: false, visible: true });
    }

    const hasModelo = productAttrs.some(a => {
      const n = String(a?.name || "").toLowerCase().trim();
      return n === "modelo" || n === "model";
    });
    if (!hasModelo && product.model) {
      productAttrs.push({ name: "Modelo", value: product.model, variation: false, visible: true });
    }

    if (productAttrs.length > 0) {
      const attrPayload: Array<{ name: string; options: string[]; visible: boolean; variation: boolean }> = [];
      for (const attr of productAttrs) {
        const n = String(attr?.name || "").trim();
        if (!n) continue;
        const values: string[] = [];
        if (attr?.value) values.push(String(attr.value));
        if (Array.isArray(attr?.values)) for (const v of attr.values) values.push(String(v));
        if (Array.isArray(attr?.options)) for (const v of attr.options) values.push(String(v));
        if (values.length === 0) continue;
        attrPayload.push({
          name: n,
          options: [...new Set(values)],
          visible: true,
          variation: false,
        });
      }
      if (attrPayload.length > 0) {
        wooProduct.attributes = attrPayload;
      }
    }


    // Add brand meta for simple products too (XStore compatibility)
    if (Array.isArray(product.attributes)) {
      for (const attr of product.attributes) {
        const n = String(attr?.name || "").toLowerCase().trim();
        if (n === "marca" || n === "brand") {
          const brandVal = String(attr?.value || attr?.options?.[0] || "").trim();
          if (brandVal) {
            const existingMeta = Array.isArray(wooProduct.meta_data) ? wooProduct.meta_data as any[] : [];
            existingMeta.push({ key: "_brand", value: brandVal });
            existingMeta.push({ key: "xstore_brand", value: brandVal });
            existingMeta.push({ key: "brand_id", value: brandVal });
            wooProduct.meta_data = existingMeta;
          }
          break;
        }
      }
    }
  }

  return wooProduct;
}

const TECHNICAL_ATTR_NAMES = new Set([
  "marca",
  "brand",
  "ean",
  "ean13",
  "gtin",
  "barcode",
  "modelo",
  "model",
]);

const SIZE_LIKE_ATTR_NAMES = new Set(["tamanho", "capacidade", "volume", "size", "capacity"]);

const isTechnicalAttrName = (name: string) => TECHNICAL_ATTR_NAMES.has(String(name || "").toLowerCase().trim());
const isSizeLikeAttrName = (name: string) => SIZE_LIKE_ATTR_NAMES.has(String(name || "").toLowerCase().trim());

const isEanLikeValue = (val: string): boolean => /^\d{8,14}$/.test(String(val || "").trim());

const SIZE_PATTERN = /\b(\d+[\.,]?\d*)\s*(cm|mm|m|ml|cl|l|lt|kg|g|oz|"|''|pol)\b/i;

// Dimension-like attribute names (used to enrich dropdown labels)
const DIMENSION_ATTR_NAMES = new Set([
  "dimensões", "dimensoes", "dimensions", "medidas", "medida",
  "dimensões (lxpxa)", "dimensões (cxlxa)", "dim", "measures",
]);

const DIMENSION_VALUE_PATTERN = /(\d+(?:[.,]\d+)?\s*(?:x|×)\s*\d+(?:[.,]\d+)?(?:\s*(?:x|×)\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m))/i;

function isDimensionAttrName(name: string): boolean {
  const n = String(name || "").toLowerCase().trim();
  return DIMENSION_ATTR_NAMES.has(n) || n.startsWith("dimensõ") || n.startsWith("dimenso") || n.startsWith("medida");
}

function stripHtml(value: string): string {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract dimension value from a variation's attributes */
function extractDimensionFromAttrs(attrs: any[]): string | null {
  if (!Array.isArray(attrs)) return null;
  for (const attr of attrs) {
    const n = String(attr?.name || "").trim();
    if (!isDimensionAttrName(n)) continue;

    const candidates = [
      attr?.value,
      ...(Array.isArray(attr?.values) ? attr.values : []),
      ...(Array.isArray(attr?.options) ? attr.options : []),
    ];

    for (const candidate of candidates) {
      const parsed = extractDimensionFromText(String(candidate || ""));
      if (parsed) return parsed;
    }
  }
  return null;
}

function extractDimensionFromText(text: string): string | null {
  const plain = stripHtml(text);
  if (!plain) return null;

  const match = plain.match(DIMENSION_VALUE_PATTERN);
  if (!match?.[1]) return null;

  return match[1].replace(/\s+/g, " ").trim();
}

function extractDimensionFromHtmlTable(html: string): string | null {
  if (!html || !html.includes("<tr")) return null;

  const rowMatches = html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const row of rowMatches) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripHtml(m[1]));
    if (cells.length < 2) continue;

    const label = cells[0];
    const value = cells[1];
    if (!isDimensionAttrName(label) || !value) continue;

    return extractDimensionFromText(value) || value;
  }

  return null;
}

function extractDimensionForVariation(variation: any): string | null {
  const attrs = Array.isArray(variation?.attributes) ? variation.attributes : [];
  const fromAttrs = extractDimensionFromAttrs(attrs);
  if (fromAttrs) return fromAttrs;

  const sources = [
    variation?.optimized_description,
    variation?.original_description,
    variation?.technical_specs,
    variation?.optimized_short_description,
    variation?.short_description,
    variation?.optimized_title,
    variation?.original_title,
  ];

  for (const source of sources) {
    const raw = String(source || "");
    if (!raw) continue;

    const fromTable = extractDimensionFromHtmlTable(raw);
    if (fromTable) return fromTable;

    const fromText = extractDimensionFromText(raw);
    if (fromText) return fromText;
  }

  return null;
}

/** Enrich an option value with dimensions if available, e.g. "1.8L" → "1.8L - 22,5 x 15 x 10,5 cm" */
function enrichOptionWithDimensions(option: string, dimensions: string | null): string {
  if (!dimensions) return option;
  // Avoid duplicating if already present
  if (option.includes(dimensions)) return option;
  return `${option} - ${dimensions}`;
}

const SIZE_WORDS = new Set(["pequeno","medio","médio","grande","extra","xs","s","m","l","xl","xxl","xxxl","2xl","3xl","4xl","pp","p","g","gg","xg","xxg"]);
const COLOR_WORDS = new Set([
  "preto","branco","azul","vermelho","verde","amarelo","laranja","roxo","rosa",
  "cinza","cinzento","castanho","dourado","prateado","violeta","bege","coral",
  "turquesa","creme","bordeaux","borgonha","fucsia","magenta","caqui","salmon",
  "salmão","marfim","champanhe","nude","terracota","índigo","indigo","lima",
  "black","white","blue","red","green","yellow","orange","purple","pink",
  "gray","grey","brown","gold","silver","beige","navy","teal","olive",
  "inox","aço","cromado","natural","transparente","multicolor"
]);

function inferAttrNameFromOption(option: string): string {
  const lower = option.toLowerCase().trim();
  if (SIZE_PATTERN.test(lower)) return "Tamanho";
  const words = lower.split(/[\s\-\/]+/).map(w => w.trim()).filter(Boolean);
  if (words.length <= 2 && words.some(w => SIZE_WORDS.has(w))) return "Tamanho";
  if (words.some(w => COLOR_WORDS.has(w))) return "Cor";
  if (/^\d+[\.,]?\d*$/.test(lower)) return "Tamanho";
  return "Opção";
}

function tokenizeTitle(s: string): string[] {
  return String(s || "")
    .replace(/[()\[\]{}]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[^\p{L}\p{N}\-\.]+/gu, ""))
    .filter(Boolean);
}

function inferVariationOptionFromTitle(parentTitle: string, childTitle: string): string | null {
  const rawChild = String(childTitle || "").trim();
  const rawParent = String(parentTitle || "").trim();
  if (!rawChild) return null;

  const suffix = extractTitleSuffix(rawParent, rawChild);
  if (suffix && suffix !== rawChild && suffix.length <= 80 && suffix.length > 0) {
    const cleaned = suffix.replace(/^[-–—:,\s]+/, "").trim();
    if (cleaned && cleaned.length <= 80) return cleaned;
  }

  const pTokens = new Set(tokenizeTitle(rawParent).map((t) => t.toLowerCase()));
  const remaining = tokenizeTitle(rawChild).filter((t) => !pTokens.has(t.toLowerCase()));
  const candidate = remaining.join(" ").trim();
  if (candidate && candidate.length <= 80) return candidate;

  return null;
}

function mergeWooAttributes(existing: any[], incoming: any[]): any[] {
  const byName = new Map<string, any>();
  const norm = (n: string) => String(n || "").toLowerCase().trim();

  for (const a of (existing || [])) {
    if (!a?.name) continue;
    const key = norm(a.name);
    if (!key) continue;
    byName.set(key, { ...a, options: Array.isArray(a.options) ? a.options : [] });
  }

  for (const a of (incoming || [])) {
    if (!a?.name) continue;
    const key = norm(a.name);
    if (!key) continue;

    const inOptions = Array.isArray(a.options) ? a.options : [];

    const current = byName.get(key);
    if (!current) {
      byName.set(key, { ...a, options: inOptions });
      continue;
    }

    // For variation attributes, replace options so stale old labels don't persist.
    if (a.variation === true) {
      current.options = inOptions.length > 0 ? inOptions : (current.options || []);
      current.variation = true;
      if (typeof a.visible === "boolean") current.visible = a.visible;
      continue;
    }

    const set = new Set<string>([...(current.options || []), ...inOptions].map((v) => String(v)));
    current.options = Array.from(set);

    if (typeof a.visible === "boolean") current.visible = a.visible;
    if (typeof a.variation === "boolean") current.variation = a.variation;
  }

  const merged = Array.from(byName.values());

  // Prevent duplicate variation dropdowns for synonyms like "Tamanho" and "Capacidade"
  const preferredSizeName = (incoming || [])
    .find((a: any) => a?.variation === true && isSizeLikeAttrName(a?.name))
    ?.name;
  const sizeLikeVariationAttrs = merged.filter((a) => a?.variation === true && isSizeLikeAttrName(a?.name));

  if (sizeLikeVariationAttrs.length > 1) {
    const primary = sizeLikeVariationAttrs.find((a) => preferredSizeName && norm(a.name) === norm(preferredSizeName)) || sizeLikeVariationAttrs[0];

    const allOptions = new Set<string>();
    for (const attr of sizeLikeVariationAttrs) {
      for (const opt of (Array.isArray(attr.options) ? attr.options : [])) {
        allOptions.add(String(opt));
      }
    }
    primary.options = Array.from(allOptions);

    const removeNames = new Set(
      sizeLikeVariationAttrs
        .filter((a) => a !== primary)
        .map((a) => norm(a.name))
    );

    return merged.filter((a) => !(a?.variation === true && removeNames.has(norm(a?.name))));
  }

  return merged;
}

async function buildVariationPayload(
  variation: any,
  parent: any,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number,
  baseUrl: string,
  auth: string
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};

  const upsertMeta = (key: string, value: string) => {
    if (!key || value === undefined || value === null) return;
    const existingMeta = Array.isArray(payload.meta_data)
      ? (payload.meta_data as Array<{ key: string; value: string }>)
      : [];
    const idx = existingMeta.findIndex((m) => String(m?.key || "") === key);
    if (idx >= 0) {
      existingMeta[idx] = { key, value };
    } else {
      existingMeta.push({ key, value });
    }
    payload.meta_data = existingMeta;
  };

  // Keep variation text only in dropdown labels (no inline block under selector).
  if (has("description")) {
    payload.description = "";
    upsertMeta("_variation_description", "");
    upsertMeta("variation_description", "");
    upsertMeta("_variation_tab_description", "");
    upsertMeta("variation_tab_description", "");
  }

  // ── Pass variation title for themes that support title swapping (XStore) ──
  if (has("title")) {
    const varTitle = variation.optimized_title || variation.original_title || "";
    if (varTitle) {
      payload.name = varTitle;
      upsertMeta("_variation_title", varTitle);
      upsertMeta("variation_title", varTitle);
    }
  }

  // ── Brand meta on variations too (XStore compatibility) ──
  // Check parent attributes for brand
  let brandValue: string | null = null;
  if (Array.isArray(parent?.attributes)) {
    for (const attr of parent.attributes) {
      const n = String(attr?.name || "").toLowerCase().trim();
      if (n === "marca" || n === "brand") {
        brandValue = String(attr?.value || attr?.options?.[0] || "").trim() || null;
        break;
      }
    }
  }
  if (brandValue) {
    upsertMeta("_brand", brandValue);
    upsertMeta("xstore_brand", brandValue);
    upsertMeta("brand_id", brandValue);
  }

  if (has("price")) {
    let basePrice = parseFloat(variation.optimized_price || variation.original_price || "0") || 0;
    if (markupPercent > 0) basePrice = basePrice * (1 + markupPercent / 100);
    payload.regular_price = basePrice.toFixed(2);

    if (has("sale_price") && discountPercent > 0) {
      payload.sale_price = (basePrice * (1 - discountPercent / 100)).toFixed(2);
    }
  }

  if (has("sale_price") && !payload.sale_price) {
    const sp = variation.optimized_sale_price ?? variation.sale_price;
    if (sp != null) payload.sale_price = String(sp);
  }

  if (has("sku")) {
    payload.sku = variation.sku || undefined;
  }

  if (has("images")) {
    const urls: string[] = Array.isArray(variation.image_urls) ? variation.image_urls : [];
    if (urls.length > 0) {
      const resolved = await resolveImageRef(urls[0], 0, baseUrl, auth);
      if (resolved) payload.image = resolved;
    }
  }

  // Only variation-defining attributes go on the variation payload.
  let variationAttrs = buildVariationAttributes(variation, parent);

  // Consolidate size-like attribute names to match the parent's chosen name
  const SIZE_ATTR_NAMES_VAR = new Set(["tamanho", "capacidade", "volume", "size", "capacity"]);
  if (variationAttrs.length > 1) {
    const sizeAttrs = variationAttrs.filter(a => SIZE_ATTR_NAMES_VAR.has(a.name.toLowerCase().trim()));
    if (sizeAttrs.length > 1) {
      const primaryName = sizeAttrs[0].name;
      variationAttrs = variationAttrs.filter(a => !(SIZE_ATTR_NAMES_VAR.has(a.name.toLowerCase().trim()) && a.name !== primaryName));
    }
  }

  // If nothing came from structured attrs, infer a safe default
  if (variationAttrs.length === 0) {
    const parentTitle = parent?.optimized_title || parent?.original_title || "";
    const childTitle = variation.optimized_title || variation.original_title || "";
    const option = inferVariationOptionFromTitle(parentTitle, childTitle);
    if (option) variationAttrs = [{ name: inferAttrNameFromOption(option), option }];
  }

  if (variationAttrs.length > 0) payload.attributes = variationAttrs;

  return payload;
}

// Extract the unique suffix from a child title compared to the parent title
function extractTitleSuffix(parentTitle: string, childTitle: string): string {
  const p = String(parentTitle || "").toLowerCase().trim();
  const c = String(childTitle || "").toLowerCase().trim();
  let i = 0;
  while (i < p.length && i < c.length && p[i] === c[i]) i++;
  const suffix = String(childTitle || "").trim().substring(i).trim();
  return suffix || String(childTitle || "").trim();
}

function buildAttributesForParent(
  parent: any,
  variations: any[]
): Array<{ name: string; options: string[]; variation: boolean; visible: boolean }> {
  const attrMap = new Map<string, Set<string>>();

  const parentTitle = parent?.optimized_title || parent?.original_title || "";

  const nameCandidates = new Set<string>();
  for (const v of variations) {
    const attrs = v?.attributes;
    if (!Array.isArray(attrs)) continue;
    for (const attr of attrs) {
      const n = String(attr?.name || "").trim();
      if (!n) continue;
      if (attr?.variation === false) continue;
      if (isTechnicalAttrName(n)) continue;
      nameCandidates.add(n);
    }
  }

  let defaultAttrName = "Opção";
  if (nameCandidates.size === 0 && variations.length > 0) {
    const firstChild = variations[0];
    const firstChildTitle = firstChild?.optimized_title || firstChild?.original_title || "";
    const firstOption = inferVariationOptionFromTitle(parentTitle, firstChildTitle);
    if (firstOption) defaultAttrName = inferAttrNameFromOption(firstOption);
  }
  const names = nameCandidates.size > 0 ? Array.from(nameCandidates) : (variations.length > 0 ? [defaultAttrName] : []);

  const add = (name: string, value: string) => {
    const n = String(name || "").trim();
    const v = String(value || "").trim();
    if (!n || !v) return;
    if (isTechnicalAttrName(n)) return;
    if (isEanLikeValue(v)) return;
    if (!attrMap.has(n)) attrMap.set(n, new Set());
    attrMap.get(n)!.add(v);
  };

  for (const v of variations) {
    const childTitle = v?.optimized_title || v?.original_title || "";
    const attrs = Array.isArray(v?.attributes) ? v.attributes : [];
    const dims = extractDimensionForVariation(v);

    for (const name of names) {
      const found = attrs.find((a: any) => String(a?.name || "").toLowerCase().trim() === String(name).toLowerCase().trim());
      const raw = String(found?.value || "").trim();
      let option = (raw && !isEanLikeValue(raw)) ? raw : inferVariationOptionFromTitle(parentTitle, childTitle);
      if (option) {
        // Enrich with dimensions in the dropdown label
        option = enrichOptionWithDimensions(option, dims);
        const effectiveName = (!raw || isEanLikeValue(raw)) ? inferAttrNameFromOption(option) : name;
        add(effectiveName, option);
      }
    }
  }

  // Only keep attributes where there are 2+ distinct values (i.e., values actually vary across variations)
  // If only 1 unique value, it's static and should NOT be a variation attribute (no dropdown needed)
  let result = Array.from(attrMap.entries())
    .filter(([_, values]) => values.size > 1)
    .map(([name, values]) => ({
      name,
      options: Array.from(values),
      variation: true,
      visible: true,
    }));

  // If ALL attributes were removed (all had 1 value), fall back to title-based inference
  if (result.length === 0 && variations.length > 1) {
    const inferredMap = new Map<string, Set<string>>();
    for (const v of variations) {
      const childTitle = v?.optimized_title || v?.original_title || "";
      const option = inferVariationOptionFromTitle(parentTitle, childTitle);
      if (option) {
        const attrName = inferAttrNameFromOption(option);
        if (!inferredMap.has(attrName)) inferredMap.set(attrName, new Set());
        inferredMap.get(attrName)!.add(option);
      }
    }
    result = Array.from(inferredMap.entries())
      .filter(([_, values]) => values.size > 1)
      .map(([name, values]) => ({
        name,
        options: Array.from(values),
        variation: true,
        visible: true,
      }));
  }

  // Consolidate duplicate size-like attributes at the parent level
  const SIZE_ATTR_NAMES_PARENT = new Set(["tamanho", "capacidade", "volume", "size", "capacity"]);
  const sizeResults = result.filter(a => SIZE_ATTR_NAMES_PARENT.has(a.name.toLowerCase().trim()));
  if (sizeResults.length > 1) {
    const primary = sizeResults[0];
    const allOpts = new Set<string>(primary.options);
    for (let i = 1; i < sizeResults.length; i++) {
      for (const opt of sizeResults[i].options) allOpts.add(opt);
    }
    primary.options = Array.from(allOpts);
    const dupNames = new Set(sizeResults.slice(1).map(a => a.name));
    return result.filter(a => !dupNames.has(a.name));
  }

  return result;
}

function buildStaticAttributesForParent(
  parent: any,
  variations: any[]
): Array<{ name: string; options: string[]; variation: boolean; visible: boolean }> {
  const map = new Map<string, Set<string>>();

  const add = (name: string, value: string) => {
    const n = String(name || "").trim();
    const v = String(value || "").trim();
    if (!n || !v) return;
    if (!map.has(n)) map.set(n, new Set());
    map.get(n)!.add(v);
  };

  const collect = (attrs: any) => {
    if (!attrs) return;
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        const n = String(attr?.name || "").trim();
        if (!n) continue;
        const isTechnical = attr?.variation === false || isTechnicalAttrName(n);
        if (!isTechnical) continue;

        if (attr?.value) add(n, attr.value);
        if (Array.isArray(attr.values)) for (const v of attr.values) add(n, v);
        if (Array.isArray(attr.options)) for (const v of attr.options) add(n, v);
      }
    } else if (typeof attrs === "object") {
      for (const [name, value] of Object.entries(attrs)) {
        if (!name) continue;
        const isTechnical = isTechnicalAttrName(name);
        if (!isTechnical) continue;
        if (value) add(name, String(value));
      }
    }
  };


  collect(parent.attributes || []);
  
  // Inject parent brand and model if present
  if (parent.brand) add("Marca", parent.brand);
  if (parent.model) add("Modelo", parent.model);

  for (const v of variations) collect(v.attributes || []);


  return Array.from(map.entries()).map(([name, values]) => ({
    name,
    options: Array.from(values),
    variation: false,
    visible: true,
  }));
}

function buildVariationAttributes(product: any, parent?: any): Array<{ name: string; option: string }> {
  const attrs = Array.isArray(product?.attributes) ? product.attributes : [];
  const parentTitle = parent?.optimized_title || parent?.original_title || "";
  const childTitle = product?.optimized_title || product?.original_title || "";
  const dims = extractDimensionForVariation(product);

  const out: Array<{ name: string; option: string }> = [];

  for (const attr of attrs) {
    const n = String(attr?.name || "").trim();
    if (!n) continue;
    if (attr?.variation === false) continue;
    if (isTechnicalAttrName(n)) continue;

    const raw = String(attr?.value || "").trim();
    if (isEanLikeValue(raw)) continue;
    let option = raw || inferVariationOptionFromTitle(parentTitle, childTitle);
    if (option && !isEanLikeValue(option)) {
      option = enrichOptionWithDimensions(option, dims);
      out.push({ name: n, option });
    }
  }

  if (out.length > 0) return out;

  if (parent && Array.isArray(parent.attributes) && parent.attributes.length > 0) {
    const childLower = String(childTitle || "").toLowerCase();
    for (const attr of parent.attributes) {
      const n = String(attr?.name || "").trim();
      if (!n) continue;
      if (attr?.variation === false) continue;
      if (isTechnicalAttrName(n)) continue;

      const values: string[] = (attr.values || attr.options || []).map((v: any) => String(v));
      const sorted = [...values].sort((a, b) => b.length - a.length);
      for (const val of sorted) {
        if (val && childLower.includes(val.toLowerCase())) {
          return [{ name: n, option: val }];
        }
      }
    }
  }

  const option = inferVariationOptionFromTitle(parentTitle, childTitle);
  if (option) return [{ name: inferAttrNameFromOption(option), option }];
  return [];
}

async function publishSingleProduct(
  product: any,
  supabase: any,
  adminClient: any,
  baseUrl: string,
  auth: string,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number,
  seoPlugin: string = 'rankmath'
): Promise<WooResult> {
  const enrichedProduct = has("images") ? await enrichProductImages(product, supabase, { skipOriginals: has("skip_original_images"), skipLifestyle: has("skip_lifestyle_images") }) : product;

  if (enrichedProduct.product_type === "variable") {
    return await publishVariableProduct(enrichedProduct, supabase, adminClient, baseUrl, auth, has, markupPercent, discountPercent, seoPlugin);
  }

  if (enrichedProduct.parent_product_id) {
    return await publishVariation(enrichedProduct, supabase, adminClient, baseUrl, auth, has, markupPercent, discountPercent, seoPlugin);
  }

  const wooProduct = await buildBasePayload(enrichedProduct, supabase, baseUrl, auth, has, markupPercent, discountPercent, seoPlugin);

  // If product is discontinued, force it to be a draft with 0 stock in WooCommerce
  if (enrichedProduct.is_discontinued) {
    console.log(`[publish] Product ${enrichedProduct.id} is discontinued. Forcing draft status and 0 stock.`);
    wooProduct.status = "draft";
    wooProduct.manage_stock = true;
    wooProduct.stock_quantity = 0;
    wooProduct.stock_status = "outofstock";
  }

  // ── FAQ & Uso Profissional Content Routing ──
  await enrichWithExtraContent(wooProduct, enrichedProduct, supabase, adminClient, has, seoPlugin);

  // ── SEO Lifecycle integration ──
  // Check if product has a lifecycle record and enrich WooCommerce payload accordingly
  try {
    const { data: lifecycle } = await adminClient
      .from("product_seo_lifecycle")
      .select("lifecycle_phase, alternative_product_ids, redirect_target_url")
      .eq("product_id", enrichedProduct.id)
      .maybeSingle();

    if (lifecycle) {
      const existingMeta = Array.isArray(wooProduct.meta_data) ? wooProduct.meta_data as any[] : [];

      if (lifecycle.lifecycle_phase === "discontinued") {
        // Set stock to 0, keep published
        wooProduct.manage_stock = true;
        wooProduct.stock_quantity = 0;
        wooProduct.stock_status = "outofstock";
        wooProduct.status = "publish"; // Keep page live

        // Add discontinued notice to short description
        const currentShort = String(wooProduct.short_description || enrichedProduct.optimized_short_description || "");
        const notice = '<div class="discontinued-notice" style="background:#fff3cd;border:1px solid #ffc107;padding:12px;border-radius:6px;margin-bottom:16px;"><strong>⚠️ Produto descontinuado</strong> — Este produto já não se encontra disponível. Veja alternativas abaixo.</div>';
        if (!currentShort.includes("discontinued-notice")) {
          wooProduct.short_description = notice + currentShort;
        }

        // Add alternatives block to description if available
        if (lifecycle.alternative_product_ids?.length) {
          const { data: altProducts } = await adminClient
            .from("products")
            .select("sku, optimized_title, original_title, woocommerce_id")
            .in("id", lifecycle.alternative_product_ids)
            .limit(4);

          if (altProducts?.length) {
            const altLinks = altProducts
              .map((p: any) => `<li>${p.optimized_title || p.original_title || p.sku}</li>`)
              .join("");
            const altBlock = `<div class="seo-alternatives" style="background:#f8f9fa;border:1px solid #dee2e6;padding:16px;border-radius:6px;margin-top:20px;"><h4>Veja alternativas disponíveis nesta categoria</h4><ul>${altLinks}</ul></div>`;
            const currentDesc = String(wooProduct.description || enrichedProduct.optimized_description || "");
            if (!currentDesc.includes("seo-alternatives")) {
              wooProduct.description = currentDesc + altBlock;
            }
          }
        }

        // Keep indexed during transition period
        existingMeta.push({ key: "_yoast_wpseo_meta-robots-noindex", value: "0" });
      }

      if (lifecycle.lifecycle_phase === "redirected") {
        // Set noindex
        existingMeta.push({ key: "_yoast_wpseo_meta-robots-noindex", value: "1" });
        // Rank Math redirect meta
        if (lifecycle.redirect_target_url) {
          existingMeta.push({ key: "rank_math_redirection_url_to", value: lifecycle.redirect_target_url });
          existingMeta.push({ key: "rank_math_redirection_header_code", value: "301" });
        }
      }

      if (existingMeta.length > 0) {
        wooProduct.meta_data = existingMeta;
      }
    }
  } catch (seoErr: unknown) {
    console.warn(`[publish] SEO lifecycle check failed for ${enrichedProduct.id}:`, seoErr);
    // Non-fatal — continue publishing
  }

  if (has("upsells")) {
    const upsellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, enrichedProduct.upsell_skus || []);
    if (upsellIds.length > 0) wooProduct.upsell_ids = upsellIds;
  }
  if (has("crosssells")) {
    const crosssellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, enrichedProduct.crosssell_skus || []);
    if (crosssellIds.length > 0) wooProduct.cross_sell_ids = crosssellIds;
  }

  if (Object.keys(wooProduct).length === 0) {
    return { id: enrichedProduct.id, status: "skipped" };
  }

  wooProduct.type = "simple";

  // ── Ensure brand attribute/term + PWB brand taxonomy ──
  // Look in canonical product.attributes (not just wooProduct.attributes), since
  // attributes may not be in the publish payload but the brand should still be assigned.
  const sourceAttrs: any[] = Array.isArray(enrichedProduct.attributes)
    ? enrichedProduct.attributes
    : (Array.isArray(wooProduct.attributes) ? wooProduct.attributes as any[] : []);

  const brandVal = extractBrandValue(enrichedProduct, sourceAttrs);

  if (brandVal) {
    const attrId = await ensureWooBrandAttribute(baseUrl, auth);
    if (attrId) {
      await ensureWooBrandTerm(baseUrl, auth, attrId, brandVal);
    }
    await assignBrandToProductTaxonomies(baseUrl, auth, brandVal, wooProduct);
    // XStore / theme compatibility meta fields
    ensureBrandMeta(wooProduct, brandVal);
  }

  const modelVal = extractModelValue(enrichedProduct, sourceAttrs);
  if (modelVal) {
    ensureModelMeta(wooProduct, modelVal);
  }


  let existingWooId = enrichedProduct.woocommerce_id;
  if (!existingWooId && enrichedProduct.sku) {
    existingWooId = await findWooProductBySku(baseUrl, auth, enrichedProduct.sku);
  }

  let action: "created" | "updated" = existingWooId ? "updated" : "created";
  let wooData;
  try {
    wooData = existingWooId
      ? await wooFetch(baseUrl, auth, `/products/${existingWooId}`, "PUT", wooProduct)
      : await wooFetch(baseUrl, auth, `/products`, "POST", wooProduct);
  } catch (err: unknown) {
    if (err instanceof WooNotFoundError && existingWooId) {
      console.warn(`Product ${enrichedProduct.id} WC#${existingWooId} not found (deleted?), creating new.`);
      await supabase.from("products").update({ woocommerce_id: null }).eq("id", enrichedProduct.id);
      wooData = await wooFetch(baseUrl, auth, `/products`, "POST", wooProduct);
      action = "created";
    } else if (err instanceof WooSkuConflictError) {
      console.log(`SKU conflict for product ${enrichedProduct.id}, retrying PUT with resource_id ${err.resourceId}`);
      wooData = await wooFetch(baseUrl, auth, `/products/${err.resourceId}`, "PUT", wooProduct);
      action = "updated";
    } else {
      throw err;
    }
  }

  await supabase
    .from("products")
    .update({ 
      woocommerce_id: wooData.id, 
      status: "published" as any,
      workflow_state: "published" as any 
    })
    .eq("id", enrichedProduct.id);

  return { id: enrichedProduct.id, status: action, woocommerce_id: wooData.id };
}

async function publishVariableProduct(
  parent: any,
  supabase: any,
  adminClient: any,
  baseUrl: string,
  auth: string,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number
): Promise<WooResult> {
  const { data: rawChildren } = await supabase
    .from("products")
    .select("*")
    .eq("parent_product_id", parent.id);

  const children: any[] = [];
  if (rawChildren && rawChildren.length > 0 && has("images")) {
    for (const child of rawChildren) {
      children.push(await enrichProductImages(child, supabase, { skipOriginals: has("skip_original_images"), skipLifestyle: has("skip_lifestyle_images") }));
    }
  } else {
    children.push(...(rawChildren || []));
  }

  console.log(`[publish-variable] Parent ${parent.id} has ${children.length} children, image_urls=${JSON.stringify(parent.image_urls)}, title=${parent.optimized_title}`);

  const parentPayload = await buildBasePayload(parent, supabase, baseUrl, auth, has, markupPercent, discountPercent);
  parentPayload.type = "variable";

  // ── FAQ & Uso Profissional Content Routing for variable parent ──
  await enrichWithExtraContent(parentPayload, parent, supabase, adminClient, has);

  // If the parent has no images, aggregate unique images from children for the gallery
  if (has("images") && (!parent.image_urls || parent.image_urls.length === 0) && children.length > 0) {
    const childImagePromises: Array<Promise<Record<string, unknown> | null>> = [];
    const seenRefs = new Set<string>();
    for (const child of children) {
      const refs: string[] = Array.isArray(child.image_urls) ? child.image_urls : [];
      // Build alt text map from child's image_alt_texts (object or array format)
      const rawAlts = child.image_alt_texts;
      const childAltMap = new Map<string, string>();
      if (rawAlts && typeof rawAlts === "object" && !Array.isArray(rawAlts)) {
        for (const [url, alt] of Object.entries(rawAlts)) {
          if (typeof alt === "string") childAltMap.set(url, alt);
        }
      } else if (Array.isArray(rawAlts)) {
        for (const item of rawAlts) {
          if (typeof item === "object" && item?.url && item?.alt_text) {
            childAltMap.set(item.url, item.alt_text);
          }
        }
      }
      for (let i = 0; i < refs.length; i++) {
        const ref = String(refs[i] || "").trim();
        if (ref && !seenRefs.has(ref)) {
          seenRefs.add(ref);
          const pos = childImagePromises.length;
          const altStr = childAltMap.get(ref) || "";
          childImagePromises.push(resolveImageRef(ref, pos, baseUrl, auth, altStr, has("image_alt_text") && !!altStr));
        }
      }
    }
    const childImages = (await Promise.all(childImagePromises)).filter(Boolean);
    if (childImages.length > 0) {
      parentPayload.images = childImages;
      console.log(`[publish-variable] Aggregated ${childImages.length} images from children for parent`);
    }
  }

  let variationAttributes = buildAttributesForParent(parent, children || []);
  const staticAttributes = buildStaticAttributesForParent(parent, children || []);

  // Consolidate duplicate size-like attributes (e.g., "Tamanho" + "Capacidade") into a single attribute
  const SIZE_ATTR_NAMES = new Set(["tamanho", "capacidade", "volume", "size", "capacity"]);
  const sizeAttrs = variationAttributes.filter(a => SIZE_ATTR_NAMES.has(a.name.toLowerCase().trim()));
  if (sizeAttrs.length > 1) {
    const primary = sizeAttrs[0];
    const allOptions = new Set<string>(primary.options);
    for (let i = 1; i < sizeAttrs.length; i++) {
      for (const opt of sizeAttrs[i].options) allOptions.add(opt);
    }
    primary.options = Array.from(allOptions);
    const sizeNames = new Set(sizeAttrs.slice(1).map(a => a.name));
    variationAttributes = variationAttributes.filter(a => !sizeNames.has(a.name));
    console.log(`[publish-variable] Consolidated ${sizeAttrs.length} size attributes into "${primary.name}" with ${primary.options.length} options`);
  }

  // Extract brand and model from static attributes for XStore meta_data
  const brandValue = extractBrandValue(parent, staticAttributes);
  const modelValue = extractModelValue(parent, staticAttributes);


  if (variationAttributes.length > 0 || staticAttributes.length > 0) {
    const merged: any[] = [...variationAttributes];
    const byName = new Map<string, any>(merged.map((a) => [a.name, a]));

    for (const s of staticAttributes) {
      const existing = byName.get(s.name);
      if (!existing) {
        merged.push(s);
        byName.set(s.name, s);
      } else {
        const set = new Set<string>([...(existing.options || []), ...(s.options || [])]);
        existing.options = Array.from(set);
      }
    }

    parentPayload.attributes = merged;
  }

  // Add XStore brand/model meta_data
  if (brandValue) {
    ensureBrandMeta(parentPayload, brandValue);
    console.log(`[publish-variable] Added brand meta: ${brandValue}`);
  }
  if (modelValue) {
    ensureModelMeta(parentPayload, modelValue);
    console.log(`[publish-variable] Added model meta: ${modelValue}`);
  }


  console.log(`[publish-variable] Payload keys: ${Object.keys(parentPayload).join(", ")}, name=${parentPayload.name}, images=${Array.isArray(parentPayload.images) ? (parentPayload.images as any[]).length : 0}, attrs=${JSON.stringify(parentPayload.attributes)}`);

  if (has("upsells")) {
    const upsellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, parent.upsell_skus || []);
    if (upsellIds.length > 0) parentPayload.upsell_ids = upsellIds;
  }
  if (has("crosssells")) {
    const crosssellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, parent.crosssell_skus || []);
    if (crosssellIds.length > 0) parentPayload.cross_sell_ids = crosssellIds;
  }

  // Variable parents must not have prices; prices live on variations
  delete parentPayload.regular_price;
  delete parentPayload.sale_price;

  // ── Ensure brand attribute/term + PWB brand taxonomy for variable products ──
  // Look in canonical parent.attributes first, fallback to parentPayload.attributes
  const sourceAttrsVar: any[] = Array.isArray(parent.attributes)
    ? parent.attributes
    : (Array.isArray((parentPayload as any).attributes) ? (parentPayload as any).attributes : []);

  let brandValVar = extractBrandValue(parent, sourceAttrsVar);
  // Fallback to brandValue captured earlier in this function (from buildAttributesForParent)
  if (!brandValVar && typeof brandValue === "string" && brandValue) {
    brandValVar = brandValue;
  }

  if (brandValVar) {
    const attrId = await ensureWooBrandAttribute(baseUrl, auth);
    if (attrId) {
      await ensureWooBrandTerm(baseUrl, auth, attrId, brandValVar);
    }
    await assignBrandToProductTaxonomies(baseUrl, auth, brandValVar, parentPayload);
  }

  let existingParentWooId = parent.woocommerce_id;
  if (!existingParentWooId && parent.sku) {
    existingParentWooId = await findWooProductBySku(baseUrl, auth, parent.sku);
  }

  let parentAction: "created" | "updated" = existingParentWooId ? "updated" : "created";

  // Ao atualizar, preserva atributos já existentes no WooCommerce (ex.: Marca/Modelo/EAN) para não os "apagar".
  if (existingParentWooId && Array.isArray((parentPayload as any).attributes)) {
    try {
      const existingWoo = await wooFetch(baseUrl, auth, `/products/${existingParentWooId}`, "GET");
      if (Array.isArray(existingWoo?.attributes)) {
        (parentPayload as any).attributes = mergeWooAttributes(existingWoo.attributes, (parentPayload as any).attributes);
      }
    } catch (e: unknown) {
      if (e instanceof WooNotFoundError) {
        console.warn(`Variable parent ${parent.id} WC#${existingParentWooId} not found, will create new.`);
        await supabase.from("products").update({ woocommerce_id: null }).eq("id", parent.id);
        existingParentWooId = null;
        parentAction = "created";
      } else {
        console.warn("Não foi possível ler atributos existentes do WooCommerce; a continuar.", e);
      }
    }
  }

  console.log(`[publish-variable] Sending ${parentAction} to WC#${existingParentWooId || 'new'}, final payload: ${JSON.stringify(parentPayload).substring(0, 1500)}`);

  let parentWooData;
  try {
    parentWooData = existingParentWooId
      ? await wooFetch(baseUrl, auth, `/products/${existingParentWooId}`, "PUT", parentPayload)
      : await wooFetch(baseUrl, auth, `/products`, "POST", parentPayload);
  } catch (err: unknown) {
    if (err instanceof WooNotFoundError && existingParentWooId) {
      console.warn(`Variable parent ${parent.id} WC#${existingParentWooId} not found on PUT, creating new.`);
      await supabase.from("products").update({ woocommerce_id: null }).eq("id", parent.id);
      parentWooData = await wooFetch(baseUrl, auth, `/products`, "POST", parentPayload);
      parentAction = "created";
    } else {
      throw err;
    }
  }

  const parentWooId = parentWooData.id;
  console.log(`[publish-variable] WC response: id=${parentWooId}, name=${parentWooData.name}, images=${parentWooData.images?.length || 0}, attrs=${parentWooData.attributes?.length || 0}`);

  await supabase
    .from("products")
    .update({ 
      woocommerce_id: parentWooId, 
      status: "published" as any,
      workflow_state: "published" as any 
    })
    .eq("id", parent.id);

  return { id: parent.id, status: parentAction, woocommerce_id: parentWooId };
}

async function publishVariation(
  variation: any,
  supabase: any,
  adminClient: any,
  baseUrl: string,
  auth: string,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number
): Promise<WooResult> {
  const { data: parentRow } = await supabase
    .from("products")
    .select("woocommerce_id, attributes, optimized_title, original_title, optimized_description, original_description")
    .eq("id", variation.parent_product_id)
    .single();

  const parentWooId = parentRow?.woocommerce_id;

  if (parentWooId) {
    const variationPayload = await buildVariationPayload(variation, parentRow, has, markupPercent, discountPercent, baseUrl, auth);
    console.log(`[publish-variation] Variation ${variation.id} (sku=${variation.sku}), title=${variation.optimized_title}, image_urls=${JSON.stringify(variation.image_urls)}, attrs=${JSON.stringify(variation.attributes)}`);
    console.log(`[publish-variation] Payload: ${JSON.stringify(variationPayload).substring(0, 1000)}`);

    let existingVarWooId = variation.woocommerce_id;
    if (!existingVarWooId && variation.sku) {
      existingVarWooId = await findWooVariationBySku(baseUrl, auth, parentWooId, variation.sku);
      if (existingVarWooId) {
        await supabase
          .from("products")
          .update({ woocommerce_id: existingVarWooId })
          .eq("id", variation.id);
      }
    }

    let action: "created" | "updated" = existingVarWooId ? "updated" : "created";
    let varWooData;

    try {
      varWooData = existingVarWooId
        ? await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations/${existingVarWooId}`, "PUT", variationPayload)
        : await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations`, "POST", variationPayload);
    } catch (err: unknown) {
      if (err instanceof WooNotFoundError && existingVarWooId) {
        console.warn(`Variation ${variation.id} WC#${existingVarWooId} not found, creating new.`);
        await supabase.from("products").update({ woocommerce_id: null }).eq("id", variation.id);
        varWooData = await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations`, "POST", variationPayload);
        action = "created";
      } else if (err instanceof WooSkuConflictError) {
        console.log(`SKU conflict for standalone variation ${variation.id}, handling properly`);
        varWooData = await handleVariationSkuConflict(
          baseUrl,
          auth,
          parentWooId,
          variation.id,
          variation.sku || "",
          variationPayload,
          err,
          supabase
        );
        action = "updated";
      } else {
        throw err;
      }
    }

    await supabase
      .from("products")
      .update({ 
        woocommerce_id: varWooData.id, 
        status: "published" as any,
        workflow_state: "published" as any 
      })
      .eq("id", variation.id);

    return { id: variation.id, status: action, woocommerce_id: varWooData.id };
  } else {
    return {
      id: variation.id,
      status: "error",
      error: "O produto pai ainda não foi publicado no WooCommerce.",
    };
  }
}

async function finalizeJob(adminClient: any, jobId: string, job: any, userId: string) {
  const results = (job.results || []) as WooResult[];
  const published = results.filter((r: WooResult) => r.status === "created" || r.status === "updated").length;
  const errors = results.filter((r: WooResult) => r.status === "error").length;

  try {
    await resolveUpsellCrosssellPass(adminClient, job, userId);
  } catch (e: unknown) {
    console.warn("Upsell/crosssell second pass failed:", e);
  }

  await adminClient.from("publish_jobs").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    current_product_name: null,
  }).eq("id", jobId);

  await adminClient.from("activity_log").insert({
    user_id: userId,
    action: "publish" as any,
    details: {
      total: results.length,
      published,
      errors,
      job_id: jobId,
    },
  });
}

async function resolveUpsellCrosssellPass(adminClient: any, job: any, userId: string) {
  const productIds = job.product_ids as string[];
  if (!productIds || productIds.length === 0) return;

  const { data: settings } = await adminClient
    .from("settings")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);

  const settingsMap: Record<string, string> = {};
  settings?.forEach((s: any) => { settingsMap[s.key] = s.value; });
  const wooUrl = settingsMap["woocommerce_url"];
  const wooKey = settingsMap["woocommerce_consumer_key"];
  const wooSecret = settingsMap["woocommerce_consumer_secret"];
  if (!wooUrl || !wooKey || !wooSecret) return;

  const baseUrl = wooUrl.replace(/\/+$/, "");
  const auth = btoa(`${wooKey}:${wooSecret}`);

  const { data: products } = await adminClient
    .from("products")
    .select("id, sku, woocommerce_id, upsell_skus, crosssell_skus, parent_product_id, product_type")
    .in("id", productIds)
    .not("woocommerce_id", "is", null);

  if (!products || products.length === 0) return;

  for (const product of products) {
    const upsellSkus = product.upsell_skus || [];
    const crosssellSkus = product.crosssell_skus || [];
    if (upsellSkus.length === 0 && crosssellSkus.length === 0) continue;
    if (product.parent_product_id) continue;

    const updates: Record<string, unknown> = {};

    if (upsellSkus.length > 0) {
      const skuList = upsellSkus.map((s: any) => typeof s === "string" ? s : s.sku).filter(Boolean);
      const { data: found } = await adminClient
        .from("products")
        .select("woocommerce_id")
        .in("sku", skuList)
        .not("woocommerce_id", "is", null);
      const ids = (found || []).map((f: any) => f.woocommerce_id).filter(Boolean);
      if (ids.length > 0) {
        // Validate IDs exist in WooCommerce before sending
        const validIds: number[] = [];
        for (const wid of ids) {
          try {
            await wooFetch(baseUrl, auth, `/products/${wid}`, "GET");
            validIds.push(wid);
          } catch {
            console.warn(`Upsell WC#${wid} not found in WooCommerce, skipping.`);
          }
        }
        if (validIds.length > 0) updates.upsell_ids = validIds;
      }
    }

    if (crosssellSkus.length > 0) {
      const skuList = crosssellSkus.map((s: any) => typeof s === "string" ? s : s.sku).filter(Boolean);
      const { data: found } = await adminClient
        .from("products")
        .select("woocommerce_id")
        .in("sku", skuList)
        .not("woocommerce_id", "is", null);
      const ids = (found || []).map((f: any) => f.woocommerce_id).filter(Boolean);
      if (ids.length > 0) {
        const validIds: number[] = [];
        for (const wid of ids) {
          try {
            await wooFetch(baseUrl, auth, `/products/${wid}`, "GET");
            validIds.push(wid);
          } catch {
            console.warn(`Crosssell WC#${wid} not found in WooCommerce, skipping.`);
          }
        }
        if (validIds.length > 0) updates.cross_sell_ids = validIds;
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        // Validate the target product itself exists before updating
        await wooFetch(baseUrl, auth, `/products/${product.woocommerce_id}`, "GET");
        await wooFetch(baseUrl, auth, `/products/${product.woocommerce_id}`, "PUT", updates);
        console.log(`✅ Updated upsell/crosssell for WC#${product.woocommerce_id}`);
      } catch (e: unknown) {
        console.warn(`Skipped upsell/crosssell for WC#${product.woocommerce_id} (product may not exist on WooCommerce):`, (e as Error).message || e);
        // Clear stale woocommerce_id if product doesn't exist
        if (e instanceof WooNotFoundError || ((e as Error).message || "").includes("invalid_id")) {
          await adminClient.from("products").update({ woocommerce_id: null }).eq("id", product.id);
          console.warn(`🧹 Cleared stale woocommerce_id for product ${product.id} (WC#${product.woocommerce_id})`);
        }
      }
    }
  }
}
