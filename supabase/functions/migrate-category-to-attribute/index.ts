import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type WooCategory = {
  id: number;
  parent: number;
  name?: string;
  slug?: string;
};

async function getWooConfig(supabase: any) {
  const { data: settings } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);
  const map: Record<string, string> = {};
  settings?.forEach((s: any) => { map[s.key] = s.value; });
  const url = map["woocommerce_url"];
  const key = map["woocommerce_consumer_key"];
  const secret = map["woocommerce_consumer_secret"];
  if (!url || !key || !secret) return null;
  return { baseUrl: url.replace(/\/+$/, ""), auth: btoa(`${key}:${secret}`) };
}

async function fetchWooCategory(
  woo: { baseUrl: string; auth: string },
  categoryId: number,
  cache: Map<number, WooCategory | null>
): Promise<WooCategory | null> {
  if (cache.has(categoryId)) return cache.get(categoryId) ?? null;

  const resp = await fetch(
    `${woo.baseUrl}/wp-json/wc/v3/products/categories/${categoryId}`,
    { headers: { Authorization: `Basic ${woo.auth}` } }
  );

  if (!resp.ok) {
    cache.set(categoryId, null);
    return null;
  }

  const cat = await resp.json();
  cache.set(categoryId, cat);
  return cat;
}

async function getWooCategoryChain(
  woo: { baseUrl: string; auth: string },
  startCategoryId: number,
  cache: Map<number, WooCategory | null>
): Promise<number[]> {
  const chain: number[] = [];
  const visited = new Set<number>();
  let currentId: number | null = startCategoryId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const cat = await fetchWooCategory(woo, currentId, cache);
    if (!cat) break;

    chain.push(cat.id);
    currentId = cat.parent && cat.parent !== 0 ? cat.parent : null;
  }

  return chain;
}

// Find the "base" category — walk up the tree from sourceWooCategoryId,
// collecting IDs of all intermediate subcategories that are being converted.
// The base is the first ancestor that is NOT in the set of converted subcategories.
async function findParentWooCategoryId(
  woo: { baseUrl: string; auth: string },
  sourceWooCategoryId: number,
  allConvertedWooIds: Set<number>,
  cache: Map<number, WooCategory | null>
): Promise<number | null> {
  let currentId = sourceWooCategoryId;
  const visited = new Set<number>();

  while (true) {
    if (visited.has(currentId)) return null; // avoid infinite loop
    visited.add(currentId);

    const cat = await fetchWooCategory(woo, currentId, cache);
    if (!cat) return null;

    const parentId = cat.parent;
    if (!parentId || parentId === 0) {
      // Source is already top-level; no parent to move to
      return null;
    }

    // If the parent is NOT one of the converted subcategories, it's the target
    if (!allConvertedWooIds.has(parentId)) {
      return parentId;
    }

    // Otherwise, keep walking up
    currentId = parentId;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader! } } });
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { workspaceId, ruleId, sourceCategoryId, attributeSlug, attributeValues } = body;

    if (!workspaceId || !ruleId || !sourceCategoryId || !attributeSlug) {
      return new Response(JSON.stringify({ error: "Parâmetros em falta" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: member } = await adminClient.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (!member) {
      return new Response(JSON.stringify({ error: "Sem acesso ao workspace" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const woo = await getWooConfig(supabase);
    if (!woo) {
      return new Response(JSON.stringify({ error: "Credenciais WooCommerce não configuradas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const categoryCache = new Map<number, WooCategory | null>();

    // Get the woocommerce_id of the source category
    const { data: catData } = await adminClient.from("categories").select("woocommerce_id").eq("id", sourceCategoryId).maybeSingle();
    const wooCategoryId = catData?.woocommerce_id;
    if (!wooCategoryId) {
      await adminClient.from("category_architect_rules").update({ migration_status: "error", error_message: "Categoria sem woocommerce_id" }).eq("id", ruleId);
      return new Response(JSON.stringify({ error: "Categoria sem woocommerce_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get ALL convert_to_attribute rules for this workspace to know which subcategories are being removed
    const { data: allRules } = await adminClient
      .from("category_architect_rules")
      .select("source_category_id")
      .eq("workspace_id", workspaceId)
      .eq("action", "convert_to_attribute");

    // Resolve woocommerce_ids for all converted categories
    const convertedSourceIds = (allRules || []).map((r: any) => r.source_category_id).filter(Boolean);
    const { data: convertedCats } = await adminClient
      .from("categories")
      .select("woocommerce_id")
      .in("id", convertedSourceIds.length > 0 ? convertedSourceIds : ["00000000-0000-0000-0000-000000000000"]);

    const allConvertedWooIds = new Set<number>(
      (convertedCats || []).map((c: any) => c.woocommerce_id).filter(Boolean)
    );

    // Prefer an explicit merge target for this category when one exists.
    const { data: companionMergeRule } = await adminClient
      .from("category_architect_rules")
      .select("target_category_id")
      .eq("workspace_id", workspaceId)
      .eq("source_category_id", sourceCategoryId)
      .eq("action", "merge_into")
      .not("target_category_id", "is", null)
      .limit(1)
      .maybeSingle();

    let targetWooCategoryId: number | null = null;
    if (companionMergeRule?.target_category_id) {
      const { data: mergeTargetCategory } = await adminClient
        .from("categories")
        .select("woocommerce_id")
        .eq("id", companionMergeRule.target_category_id)
        .maybeSingle();

      targetWooCategoryId = mergeTargetCategory?.woocommerce_id ?? null;
    }

    if (!targetWooCategoryId) {
      targetWooCategoryId = await findParentWooCategoryId(woo, wooCategoryId, allConvertedWooIds, categoryCache);
    }

    const sourceChain = await getWooCategoryChain(woo, wooCategoryId, categoryCache);
    const targetChain = targetWooCategoryId
      ? await getWooCategoryChain(woo, targetWooCategoryId, categoryCache)
      : [];

    const branchIdsToRemove = new Set<number>(
      targetChain.length > 0
        ? sourceChain.filter((id) => !targetChain.includes(id))
        : [wooCategoryId]
    );

    console.log(
      `Source WC category ${wooCategoryId} → target ${targetWooCategoryId}; sourceChain=${sourceChain.join(",")}; targetChain=${targetChain.join(",")}`
    );

    // Fetch all products in the source category (paginated)
    let allProducts: any[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const resp = await fetch(`${woo.baseUrl}/wp-json/wc/v3/products?category=${wooCategoryId}&per_page=${perPage}&page=${page}`, {
        headers: { Authorization: `Basic ${woo.auth}` },
      });
      if (!resp.ok) break;
      const products = await resp.json();
      if (!Array.isArray(products) || products.length === 0) break;
      allProducts = allProducts.concat(products);
      if (products.length < perPage) break;
      page++;
    }

    const total = allProducts.length;

    // Check which products already have snapshots (for resume after timeout)
    const { data: existingSnapshots } = await adminClient
      .from("category_architect_snapshots")
      .select("woo_product_id")
      .eq("rule_id", ruleId);
    const alreadyProcessed = new Set<number>(
      (existingSnapshots || []).map((s: any) => s.woo_product_id)
    );

    const remainingProducts = allProducts.filter((p: any) => !alreadyProcessed.has(p.id));
    const previouslyDone = total - remainingProducts.length;

    console.log(`Total: ${total}, already processed: ${previouslyDone}, remaining: ${remainingProducts.length}`);

    await adminClient.from("category_architect_rules").update({
      migration_status: "migrating",
      migration_progress: previouslyDone,
      migration_total: total,
    }).eq("id", ruleId);

    let updated = previouslyDone;
    let errors = 0;
    const migratedProducts: { id: number; name: string; sku: string; status: string }[] = [];
    const failedProducts: { id: number; name: string; sku: string; error: string }[] = [];

    for (const product of remainingProducts) {
      try {
        // --- 0. Save snapshot BEFORE any changes ---
        const existingCategories: { id: number }[] = Array.isArray(product.categories) ? product.categories : [];
        const existingAttrs = Array.isArray(product.attributes) ? product.attributes : [];

        await adminClient.from("category_architect_snapshots").upsert({
          rule_id: ruleId,
          workspace_id: workspaceId,
          woo_product_id: product.id,
          product_name: product.name || product.title || "Sem nome",
          product_sku: product.sku || "",
          original_categories: existingCategories,
          original_attributes: existingAttrs,
          rollback_status: "pending",
        }, { onConflict: "rule_id,woo_product_id", ignoreDuplicates: false });

        // --- 1. Build new attributes list ---
        const existingSlugs = existingAttrs.map((a: any) => a.slug || a.name);
        const valueToAssign = Array.isArray(attributeValues) && attributeValues.length > 0 ? attributeValues[0] : "";

        let newAttrs;
        if (existingSlugs.includes(attributeSlug)) {
          newAttrs = existingAttrs;
        } else {
          newAttrs = [...existingAttrs, {
            name: attributeSlug,
            slug: attributeSlug,
            visible: true,
            variation: false,
            options: [valueToAssign],
          }];
        }

        // --- 2. Build new categories list ---
        let newCategories = existingCategories.filter(
          (c: any) => !allConvertedWooIds.has(c.id) && !branchIdsToRemove.has(c.id)
        );

        if (targetWooCategoryId && !newCategories.some((c: any) => c.id === targetWooCategoryId)) {
          newCategories.push({ id: targetWooCategoryId });
        }

        if (newCategories.length === 0) {
          newCategories = existingCategories.filter((c: any) => c.id !== wooCategoryId);
        }

        // --- 3. Update product in WooCommerce ---
        const updatePayload: any = { attributes: newAttrs };

        const origIds = new Set(existingCategories.map((c: any) => c.id));
        const newIds = new Set(newCategories.map((c: any) => c.id));
        const categoriesChanged = origIds.size !== newIds.size || [...origIds].some(id => !newIds.has(id));

        if (categoriesChanged) {
          updatePayload.categories = newCategories.map((c: any) => ({ id: c.id }));
        }

        const patchResp = await fetch(`${woo.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
          method: "PUT",
          headers: { Authorization: `Basic ${woo.auth}`, "Content-Type": "application/json" },
          body: JSON.stringify(updatePayload),
        });

        if (patchResp.ok) {
          updated++;
          const statusLabel = categoriesChanged
            ? "moved_and_attributed"
            : existingSlugs.includes(attributeSlug) ? "already_had" : "attributed";
          migratedProducts.push({
            id: product.id,
            name: product.name || product.title || "Sem nome",
            sku: product.sku || "",
            status: statusLabel,
          });
        } else {
          const errText = await patchResp.text();
          errors++;
          failedProducts.push({
            id: product.id,
            name: product.name || product.title || "Sem nome",
            sku: product.sku || "",
            error: errText.substring(0, 200),
          });
          console.warn(`Failed to update product ${product.id}:`, errText);
        }
      } catch (err) {
        errors++;
        failedProducts.push({
          id: product.id,
          name: product.name || product.title || "Sem nome",
          sku: product.sku || "",
          error: String(err).substring(0, 200),
        });
        console.error(`Error updating product ${product.id}:`, err);
      }

      // Update progress
      await adminClient.from("category_architect_rules").update({
        migration_progress: updated + errors,
      }).eq("id", ruleId);

      // Rate limit
      await sleep(200);
    }

    // Final status
    const finalStatus = errors > 0 && updated === 0 ? "error" : "migrated";
    const migrationSummary = errors > 0 ? `${errors} erros durante a migração` : null;

    await adminClient.from("category_architect_rules").update({
      migration_status: finalStatus,
      migration_progress: updated + errors,
      error_message: migrationSummary,
    }).eq("id", ruleId);

    return new Response(JSON.stringify({
      success: true,
      updated,
      errors,
      total,
      parentCategoryId: targetWooCategoryId,
      categoriesReassigned: targetWooCategoryId ? true : false,
      migratedProducts,
      failedProducts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    console.error("migrate-category-to-attribute error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
