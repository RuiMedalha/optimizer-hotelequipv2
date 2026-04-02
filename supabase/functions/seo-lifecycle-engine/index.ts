import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface LifecycleRecord {
  id: string;
  product_id: string;
  sku: string | null;
  lifecycle_phase: string;
  discontinued_at: string | null;
  days_before_redirect: number | null;
  redirect_target_type: string | null;
  redirect_target_url: string | null;
  current_url: string | null;
  previous_url: string | null;
  workspace_id: string;
  alternative_product_ids: string[] | null;
}

async function log(
  admin: any,
  workspaceId: string,
  productId: string | null,
  eventType: string,
  oldPhase: string | null,
  newPhase: string | null,
  details: Record<string, unknown> = {}
) {
  await admin.from("seo_lifecycle_logs").insert({
    workspace_id: workspaceId,
    product_id: productId,
    event_type: eventType,
    old_phase: oldPhase,
    new_phase: newPhase,
    details,
  });
}

// ─── Action: Discontinue a product ───
async function discontinueProduct(
  admin: any,
  productId: string,
  workspaceId: string,
  opts: { redirectTargetUrl?: string; daysOverride?: number } = {}
) {
  // Get product info
  const { data: product } = await admin
    .from("products")
    .select("id, sku, seo_slug, woocommerce_id, category_id, original_title, optimized_title")
    .eq("id", productId)
    .single();

  if (!product) return { error: "Product not found" };

  // Get workspace config
  const { data: config } = await admin
    .from("seo_lifecycle_config")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single();

  const daysBeforeRedirect = opts.daysOverride ?? config?.default_days_before_redirect ?? 10;

  // Build current URL from WooCommerce permalink pattern
  const slug = product.seo_slug || product.sku || productId;
  const currentUrl = `/produto/${slug}/`;

  // Upsert lifecycle record
  const { error: upsertErr } = await admin
    .from("product_seo_lifecycle")
    .upsert(
      {
        product_id: productId,
        sku: product.sku,
        lifecycle_phase: "discontinued",
        discontinued_at: new Date().toISOString(),
        days_before_redirect: daysBeforeRedirect,
        current_url: currentUrl,
        previous_url: currentUrl,
        redirect_target_url: opts.redirectTargetUrl || null,
        redirect_target_type: opts.redirectTargetUrl ? "manual" : (config?.default_redirect_target_type || "category"),
        workspace_id: workspaceId,
      },
      { onConflict: "product_id" }
    );

  if (upsertErr) return { error: upsertErr.message };

  await log(admin, workspaceId, productId, "phase_transition", "active", "discontinued", {
    sku: product.sku,
    days_before_redirect: daysBeforeRedirect,
  });

  // Find alternative products (same category, fallback)
  const alternatives = await findAlternatives(admin, product, workspaceId);
  if (alternatives.length > 0) {
    await admin
      .from("product_seo_lifecycle")
      .update({ alternative_product_ids: alternatives })
      .eq("product_id", productId);
  }

  return { status: "discontinued", product_id: productId, alternatives };
}

async function findAlternatives(admin: any, product: any, workspaceId: string): Promise<string[]> {
  if (!product.category_id) return [];

  const { data: similar } = await admin
    .from("products")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("category_id", product.category_id)
    .neq("id", product.id)
    .neq("status", "discontinued")
    .limit(4);

  return (similar || []).map((p: any) => p.id);
}

// ─── Action: Determine redirect destination ───
async function resolveRedirectDestination(
  admin: any,
  lifecycle: LifecycleRecord
): Promise<string> {
  // Priority 1: Manual URL
  if (lifecycle.redirect_target_url) return lifecycle.redirect_target_url;

  // Priority 2: Replacement product URL
  if (lifecycle.alternative_product_ids?.length) {
    const { data: alt } = await admin
      .from("products")
      .select("seo_slug, sku")
      .eq("id", lifecycle.alternative_product_ids[0])
      .single();
    if (alt) return `/produto/${alt.seo_slug || alt.sku}/`;
  }

  // Priority 3: Primary category URL
  const { data: product } = await admin
    .from("products")
    .select("category_id")
    .eq("id", lifecycle.product_id)
    .single();

  if (product?.category_id) {
    const { data: cat } = await admin
      .from("categories")
      .select("slug, name")
      .eq("id", product.category_id)
      .single();
    if (cat) return `/product-category/${cat.slug || cat.name}/`;
  }

  // Priority 4: Workspace fallback
  const { data: config } = await admin
    .from("seo_lifecycle_config")
    .select("fallback_redirect_url")
    .eq("workspace_id", lifecycle.workspace_id)
    .single();

  return config?.fallback_redirect_url || "/loja/";
}

// ─── Action: Create redirect and transition ───
async function transitionToRedirected(admin: any, lifecycle: LifecycleRecord) {
  const destinationUrl = await resolveRedirectDestination(admin, lifecycle);
  const sourceUrl = lifecycle.current_url || lifecycle.previous_url || `/produto/${lifecycle.sku}/`;

  // Validate: prevent redirect loops
  if (sourceUrl === destinationUrl) {
    await log(admin, lifecycle.workspace_id, lifecycle.product_id, "redirect_loop_prevented", "pending_redirect", null, {
      source: sourceUrl,
      destination: destinationUrl,
    });
    return { error: "Redirect loop detected", product_id: lifecycle.product_id };
  }

  // Check for duplicate redirects
  const { data: existing } = await admin
    .from("product_redirects")
    .select("id")
    .eq("source_url", sourceUrl)
    .eq("workspace_id", lifecycle.workspace_id)
    .eq("status", "pending")
    .maybeSingle();

  if (!existing) {
    await admin.from("product_redirects").insert({
      product_id: lifecycle.product_id,
      source_url: sourceUrl,
      destination_url: destinationUrl,
      redirect_type: 301,
      status: "pending",
      reason: "auto_lifecycle_transition",
      workspace_id: lifecycle.workspace_id,
    });
  }

  // Update lifecycle phase
  await admin
    .from("product_seo_lifecycle")
    .update({
      lifecycle_phase: "redirected",
      noindex_at: new Date().toISOString(),
      redirect_target_url: destinationUrl,
    })
    .eq("id", lifecycle.id);

  await log(admin, lifecycle.workspace_id, lifecycle.product_id, "phase_transition", "pending_redirect", "redirected", {
    source_url: sourceUrl,
    destination_url: destinationUrl,
  });

  return { status: "redirected", product_id: lifecycle.product_id, source: sourceUrl, destination: destinationUrl };
}

// ─── CRON: Process pending transitions ───
async function processCronTransitions(admin: any) {
  // Find discontinued products ready for redirect
  const { data: ready } = await admin
    .from("product_seo_lifecycle")
    .select("*")
    .eq("lifecycle_phase", "discontinued")
    .order("discontinued_at", { ascending: true });

  const results: any[] = [];
  const now = Date.now();

  for (const lifecycle of ready || []) {
    const discontinuedAt = new Date(lifecycle.discontinued_at).getTime();
    const days = lifecycle.days_before_redirect || 10;
    const thresholdMs = days * 24 * 60 * 60 * 1000;

    if (now - discontinuedAt < thresholdMs) continue;

    // Transition to pending_redirect first
    await admin
      .from("product_seo_lifecycle")
      .update({
        lifecycle_phase: "pending_redirect",
        pending_redirect_at: new Date().toISOString(),
      })
      .eq("id", lifecycle.id);

    await log(admin, lifecycle.workspace_id, lifecycle.product_id, "phase_transition", "discontinued", "pending_redirect", {
      days_elapsed: Math.floor((now - discontinuedAt) / (24 * 60 * 60 * 1000)),
      threshold_days: days,
    });

    // Immediately create redirect
    const result = await transitionToRedirected(admin, { ...lifecycle, lifecycle_phase: "pending_redirect" });
    results.push(result);
  }

  return { processed: results.length, results };
}

// ─── Action: Force redirect now ───
async function forceRedirectNow(admin: any, productId: string, workspaceId: string, destinationUrl?: string) {
  const { data: lifecycle } = await admin
    .from("product_seo_lifecycle")
    .select("*")
    .eq("product_id", productId)
    .single();

  if (!lifecycle) return { error: "No lifecycle record found" };

  if (destinationUrl) {
    await admin
      .from("product_seo_lifecycle")
      .update({ redirect_target_url: destinationUrl, redirect_target_type: "manual" })
      .eq("id", lifecycle.id);
    lifecycle.redirect_target_url = destinationUrl;
  }

  // Skip to pending_redirect then redirected
  await admin
    .from("product_seo_lifecycle")
    .update({ lifecycle_phase: "pending_redirect", pending_redirect_at: new Date().toISOString() })
    .eq("id", lifecycle.id);

  const result = await transitionToRedirected(admin, { ...lifecycle, lifecycle_phase: "pending_redirect" });
  return result;
}

// ─── Action: Restore to active ───
async function restoreToActive(admin: any, productId: string, workspaceId: string) {
  const { data: lifecycle } = await admin
    .from("product_seo_lifecycle")
    .select("*")
    .eq("product_id", productId)
    .single();

  if (!lifecycle) return { error: "No lifecycle record found" };

  const oldPhase = lifecycle.lifecycle_phase;

  await admin
    .from("product_seo_lifecycle")
    .update({
      lifecycle_phase: "active",
      discontinued_at: null,
      pending_redirect_at: null,
      noindex_at: null,
      redirect_target_url: null,
      redirect_target_type: null,
    })
    .eq("id", lifecycle.id);

  // Cancel pending redirects
  await admin
    .from("product_redirects")
    .update({ status: "cancelled" })
    .eq("product_id", productId)
    .eq("status", "pending");

  await log(admin, workspaceId, productId, "phase_transition", oldPhase, "active", { restored: true });

  return { status: "active", product_id: productId };
}

// ─── Bulk Import ───
async function processBulkImport(admin: any, workspaceId: string, items: any[]) {
  const results: any[] = [];

  for (const item of items) {
    const { sku, action, redirect_target_url, days_before_redirect } = item;

    // Find product by SKU
    const { data: product } = await admin
      .from("products")
      .select("id")
      .eq("sku", sku)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!product) {
      results.push({ sku, status: "error", error: "Product not found" });
      continue;
    }

    try {
      if (action === "discontinue") {
        const r = await discontinueProduct(admin, product.id, workspaceId, {
          redirectTargetUrl: redirect_target_url,
          daysOverride: days_before_redirect,
        });
        results.push({ sku, ...r });
      } else if (action === "redirect_now") {
        const r = await forceRedirectNow(admin, product.id, workspaceId, redirect_target_url);
        results.push({ sku, ...r });
      } else if (action === "restore") {
        const r = await restoreToActive(admin, product.id, workspaceId);
        results.push({ sku, ...r });
      } else {
        results.push({ sku, status: "error", error: `Unknown action: ${action}` });
      }
    } catch (err: any) {
      results.push({ sku, status: "error", error: err.message });
    }
  }

  return { processed: results.length, results };
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const { action, workspace_id, product_id, items, destination_url, days_override } = body;

    // Auth check for non-cron requests
    if (action !== "cron") {
      const authHeader = req.headers.get("Authorization");
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader! } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Não autenticado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check workspace membership
      if (workspace_id) {
        const { data: member } = await admin
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", workspace_id)
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle();

        if (!member) {
          return new Response(JSON.stringify({ error: "Sem acesso ao workspace" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    let result: any;

    switch (action) {
      case "cron":
        result = await processCronTransitions(admin);
        break;

      case "discontinue":
        if (!product_id || !workspace_id) throw new Error("product_id and workspace_id required");
        result = await discontinueProduct(admin, product_id, workspace_id, {
          redirectTargetUrl: destination_url,
          daysOverride: days_override,
        });
        break;

      case "force_redirect":
        if (!product_id || !workspace_id) throw new Error("product_id and workspace_id required");
        result = await forceRedirectNow(admin, product_id, workspace_id, destination_url);
        break;

      case "restore":
        if (!product_id || !workspace_id) throw new Error("product_id and workspace_id required");
        result = await restoreToActive(admin, product_id, workspace_id);
        break;

      case "bulk_import":
        if (!workspace_id || !items) throw new Error("workspace_id and items required");
        result = await processBulkImport(admin, workspace_id, items);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("seo-lifecycle-engine error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
