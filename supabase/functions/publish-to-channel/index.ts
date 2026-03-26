import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { product_id, channel_id, workspace_id, user_id, locale } = await req.json();

    // 1. Fetch product
    const { data: product, error: pErr } = await supabase.from("products").select("*").eq("id", product_id).single();
    if (pErr || !product) throw new Error("Product not found");

    // 2. Fetch channel
    const { data: channel } = await supabase.from("channels").select("*").eq("id", channel_id).single();
    if (!channel) throw new Error("Channel not found");

    // 3. Check publish locks
    const { data: locks } = await supabase.from("publish_locks").select("*").eq("product_id", product_id).eq("is_active", true);
    if (locks && locks.length > 0) {
      return new Response(JSON.stringify({ error: "Product has active publish locks", locks }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Build payload
    const payload = await buildChannelPayload(supabase, product, channel, workspace_id, locale);

    // 5. Validate required fields
    const { data: fieldMappings } = await supabase
      .from("channel_field_mappings")
      .select("*")
      .eq("channel_id", channel_id)
      .eq("required", true);

    const missingFields = (fieldMappings || []).filter((fm: any) => {
      const val = payload[fm.channel_field];
      return val === null || val === undefined || val === "";
    });

    if (missingFields.length > 0) {
      return new Response(JSON.stringify({
        error: "Missing required fields",
        missing: missingFields.map((f: any) => f.channel_field),
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 6. Send to channel API
    let result: any = { success: true, external_id: null };
    const { data: connection } = await supabase
      .from("channel_connections")
      .select("*")
      .eq("channel_id", channel_id)
      .eq("status", "connected")
      .limit(1)
      .single();

    if (channel.channel_type === "woocommerce" && connection) {
      result = await publishToWooCommerce(connection, payload, product);
    } else if (channel.channel_type === "csv_export") {
      result = { success: true, external_id: `csv-${Date.now()}` };
    } else if (channel.channel_type === "api_endpoint" && connection) {
      result = await publishToGenericAPI(connection, payload);
    }
    // shopify, amazon, google_merchant — prepared but not active yet

    // 7. Save snapshot
    await supabase.from("channel_product_data").upsert({
      workspace_id,
      product_id,
      channel_id,
      payload,
      status: result.success ? "published" : "failed",
      external_id: result.external_id,
      last_published_at: result.success ? new Date().toISOString() : null,
    }, { onConflict: "product_id,channel_id" });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("publish-to-channel error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? (e as Error).message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function buildChannelPayload(supabase: any, product: any, channel: any, workspaceId: string, locale?: string) {
  // Get field mappings
  const { data: fieldMappings } = await supabase
    .from("channel_field_mappings")
    .select("*")
    .eq("channel_id", channel.id);

  // Get category mappings
  const { data: catMappings } = await supabase
    .from("channel_category_mappings")
    .select("*")
    .eq("channel_id", channel.id)
    .eq("internal_category", product.category || "");

  // Get attribute mappings
  const { data: attrMappings } = await supabase
    .from("channel_attribute_mappings")
    .select("*")
    .eq("channel_id", channel.id);

  // Get localization if locale specified
  let localization: any = null;
  if (locale) {
    const { data: loc } = await supabase
      .from("product_localizations")
      .select("*")
      .eq("product_id", product.id)
      .eq("locale", locale)
      .single();
    localization = loc;
  }

  // Get images
  const { data: images } = await supabase.rpc("get_product_assets", {
    _product_id: product.id,
    _channel_id: channel.id,
  });

  // Build canonical payload
  const canonical: Record<string, any> = {
    title: localization?.translated_title || product.optimized_title || product.original_title,
    description: localization?.translated_description || product.optimized_description || product.original_description,
    short_description: localization?.translated_short_description || product.optimized_short_description || product.short_description,
    meta_title: localization?.translated_meta_title || product.meta_title,
    meta_description: localization?.translated_meta_description || product.meta_description,
    slug: localization?.translated_slug || product.seo_slug,
    price: product.optimized_price || product.original_price,
    sale_price: product.optimized_sale_price || product.sale_price,
    sku: product.sku,
    category: product.category,
    tags: localization?.translated_tags || product.tags,
    images: (images || []).map((img: any) => img.public_url).filter(Boolean),
    image_urls: product.image_urls,
    attributes: product.attributes,
    faq: localization?.translated_faq || product.faq,
  };

  // Apply field mappings
  const payload: Record<string, any> = {};
  if (fieldMappings && fieldMappings.length > 0) {
    for (const mapping of fieldMappings) {
      let value = canonical[mapping.canonical_field];
      if (mapping.transformation_rules) {
        value = applyTransformation(value, mapping.transformation_rules);
      }
      payload[mapping.channel_field] = value;
    }
    // Include unmapped canonical fields
    for (const [key, val] of Object.entries(canonical)) {
      if (!fieldMappings.find((m: any) => m.canonical_field === key)) {
        payload[key] = val;
      }
    }
  } else {
    Object.assign(payload, canonical);
  }

  // Apply category mapping
  if (catMappings && catMappings.length > 0) {
    payload.channel_category = catMappings[0].channel_category;
  }

  // Apply attribute mappings
  if (attrMappings && attrMappings.length > 0 && product.attributes) {
    const mappedAttrs: Record<string, any> = {};
    for (const am of attrMappings) {
      const val = (product.attributes as any)?.[am.attribute_name];
      if (val !== undefined) {
        let transformed = val;
        if (am.transformation_rules) transformed = applyTransformation(val, am.transformation_rules);
        mappedAttrs[am.channel_attribute_name] = transformed;
      }
    }
    payload.mapped_attributes = mappedAttrs;
  }

  return payload;
}

function applyTransformation(value: any, rules: any): any {
  if (!rules || !value) return value;
  if (rules.prefix && typeof value === "string") value = rules.prefix + value;
  if (rules.suffix && typeof value === "string") value = value + rules.suffix;
  if (rules.max_length && typeof value === "string") value = value.slice(0, rules.max_length);
  if (rules.strip_html && typeof value === "string") value = value.replace(/<[^>]*>/g, "");
  if (rules.uppercase && typeof value === "string") value = value.toUpperCase();
  if (rules.lowercase && typeof value === "string") value = value.toLowerCase();
  return value;
}

async function publishToWooCommerce(connection: any, payload: any, product: any) {
  const creds = connection.credentials || {};
  const storeUrl = creds.store_url || connection.settings?.store_url;
  const consumerKey = creds.consumer_key || creds.api_key;
  const consumerSecret = creds.consumer_secret || creds.secret;

  if (!storeUrl || !consumerKey || !consumerSecret) {
    return { success: false, error: "Missing WooCommerce credentials" };
  }

  const wooPayload: any = {
    name: payload.title,
    description: payload.description,
    short_description: payload.short_description,
    regular_price: payload.price?.toString(),
    sale_price: payload.sale_price?.toString() || "",
    sku: payload.sku,
    categories: payload.channel_category ? [{ name: payload.channel_category }] : [],
    images: (payload.images || payload.image_urls || []).map((url: string) => ({ src: url })),
    tags: (payload.tags || []).map((t: string) => ({ name: t })),
    meta_data: [
      { key: "_yoast_wpseo_title", value: payload.meta_title || "" },
      { key: "_yoast_wpseo_metadesc", value: payload.meta_description || "" },
    ],
  };

  const endpoint = product.woocommerce_id
    ? `${storeUrl}/wp-json/wc/v3/products/${product.woocommerce_id}`
    : `${storeUrl}/wp-json/wc/v3/products`;

  const method = product.woocommerce_id ? "PUT" : "POST";

  const resp = await fetch(endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${consumerKey}:${consumerSecret}`),
    },
    body: JSON.stringify(wooPayload),
  });

  const data = await resp.json();
  if (!resp.ok) return { success: false, error: data.message || "WooCommerce API error", external_id: null };
  return { success: true, external_id: String(data.id) };
}

async function publishToGenericAPI(connection: any, payload: any) {
  const creds = connection.credentials || {};
  const endpoint = creds.endpoint_url || connection.settings?.endpoint_url;
  if (!endpoint) return { success: false, error: "No endpoint URL configured" };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds.api_key) headers["Authorization"] = `Bearer ${creds.api_key}`;

  const resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await resp.text();
  if (!resp.ok) return { success: false, error: `API error ${resp.status}: ${text}` };

  try {
    const data = JSON.parse(text);
    return { success: true, external_id: data.id || data.external_id || null };
  } catch {
    return { success: true, external_id: null };
  }
}
