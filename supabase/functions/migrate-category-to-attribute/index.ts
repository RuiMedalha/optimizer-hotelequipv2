import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

    // Get the woocommerce_id of the source category
    const { data: catData } = await adminClient.from("categories").select("woocommerce_id").eq("id", sourceCategoryId).maybeSingle();
    const wooCategoryId = catData?.woocommerce_id;
    if (!wooCategoryId) {
      await adminClient.from("category_architect_rules").update({ migration_status: "error", error_message: "Categoria sem woocommerce_id" }).eq("id", ruleId);
      return new Response(JSON.stringify({ error: "Categoria sem woocommerce_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch all products in the category (paginated)
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
    await adminClient.from("category_architect_rules").update({
      migration_status: "migrating",
      migration_progress: 0,
      migration_total: total,
    }).eq("id", ruleId);

    let updated = 0;
    let errors = 0;

    for (const product of allProducts) {
      try {
        // Get existing attributes
        const existingAttrs = Array.isArray(product.attributes) ? product.attributes : [];
        const existingSlugs = existingAttrs.map((a: any) => a.slug || a.name);

        // Determine value from category name or first available value
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

        const patchResp = await fetch(`${woo.baseUrl}/wp-json/wc/v3/products/${product.id}`, {
          method: "PUT",
          headers: { Authorization: `Basic ${woo.auth}`, "Content-Type": "application/json" },
          body: JSON.stringify({ attributes: newAttrs }),
        });

        if (patchResp.ok) {
          updated++;
        } else {
          errors++;
          console.warn(`Failed to update product ${product.id}:`, await patchResp.text());
        }
      } catch (err) {
        errors++;
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
    await adminClient.from("category_architect_rules").update({
      migration_status: finalStatus,
      migration_progress: updated + errors,
      error_message: errors > 0 ? `${errors} erros durante a migração` : null,
    }).eq("id", ruleId);

    return new Response(JSON.stringify({ success: true, updated, errors, total }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    console.error("migrate-category-to-attribute error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
