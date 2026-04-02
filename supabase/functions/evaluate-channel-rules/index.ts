import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { product_id, channel_id, feed_profile_id, workspace_id } = await req.json();
    if (!product_id || !channel_id) throw new Error("product_id and channel_id required");

    // 1. Load product
    const { data: product, error: pErr } = await supabase.from("products").select("*").eq("id", product_id).single();
    if (pErr) throw pErr;

    // 2. Load field mappings
    const { data: fieldMappings } = await supabase.from("channel_field_mappings").select("*").eq("channel_id", channel_id);

    // 3. Load attribute mappings
    const { data: attrMappings } = await supabase.from("channel_attribute_mappings").select("*").eq("channel_id", channel_id);

    // 4. Load category mappings
    const { data: catMappings } = await supabase.from("channel_category_mappings").select("*").eq("channel_id", channel_id);

    // 5. Load active rules sorted by priority
    const { data: rules } = await supabase
      .from("channel_rules")
      .select("*")
      .eq("channel_id", channel_id)
      .eq("is_active", true)
      .order("priority", { ascending: true });

    // 6. Load feed profile if specified
    let feedProfile: any = null;
    if (feed_profile_id) {
      const { data } = await supabase.from("channel_feed_profiles").select("*").eq("id", feed_profile_id).single();
      feedProfile = data;
    }

    // Build base payload from field mappings
    const payload: Record<string, any> = {};
    const fieldMap: Record<string, string> = {
      title: product.optimized_title || product.original_title,
      description: product.optimized_description || product.original_description,
      short_description: product.optimized_short_description || product.short_description,
      meta_title: product.meta_title,
      meta_description: product.meta_description,
      seo_slug: product.seo_slug,
      price: product.optimized_price || product.original_price,
      sale_price: product.optimized_sale_price || product.sale_price,
      sku: product.sku,
      category: product.category,
      tags: product.tags,
      images: product.image_urls,
      attributes: product.attributes,
      faq: product.faq,
    };

    for (const fm of fieldMappings || []) {
      let value = fieldMap[fm.canonical_field] ?? null;
      if (fm.transformation_rules) {
        value = applyTransformation(value, fm.transformation_rules);
      }
      payload[fm.channel_field] = value;
    }

    // Apply attribute mappings
    if (product.attributes && attrMappings) {
      const attrs: Record<string, any> = typeof product.attributes === "object" ? product.attributes : {};
      for (const am of attrMappings) {
        if (attrs[am.attribute_name] !== undefined) {
          let val = attrs[am.attribute_name];
          if (am.transformation_rules) val = applyTransformation(val, am.transformation_rules);
          payload[am.channel_attribute_name] = val;
        }
      }
    }

    // Apply category mappings
    if (product.category && catMappings) {
      const match = catMappings.find((cm: any) => cm.internal_category === product.category);
      if (match) payload._channel_category = match.channel_category;
    }

    // Evaluate rules
    const appliedRules: string[] = [];
    const warnings: string[] = [];
    const blocks: string[] = [];

    for (const rule of rules || []) {
      const conditionMet = evaluateCondition(rule.conditions, product, payload);
      if (!conditionMet) continue;

      appliedRules.push(rule.rule_name);

      switch (rule.rule_type) {
        case "exclude_product":
          blocks.push(`Blocked by rule: ${rule.rule_name}`);
          break;
        case "require_attribute": {
          const attr = rule.actions?.attribute;
          if (!payload[attr] && !product.attributes?.[attr]) {
            warnings.push(`Missing required attribute: ${attr}`);
          }
          break;
        }
        case "fallback_attribute": {
          const { field, fallback_field } = rule.actions || {};
          if (!payload[field] && fieldMap[fallback_field]) {
            payload[field] = fieldMap[fallback_field];
          }
          break;
        }
        case "price_adjustment": {
          const { adjustment_type, value } = rule.actions || {};
          if (payload.price || payload._price) {
            const key = payload.price ? "price" : "_price";
            const price = parseFloat(payload[key]);
            if (!isNaN(price)) {
              payload[key] = adjustment_type === "percentage" ? price * (1 + value / 100) : price + value;
            }
          }
          break;
        }
        case "title_template": {
          const template = rule.actions?.template || "";
          payload.title = template.replace("{title}", payload.title || "").replace("{sku}", product.sku || "").replace("{category}", product.category || "");
          break;
        }
        case "description_template": {
          const template = rule.actions?.template || "";
          payload.description = template.replace("{description}", payload.description || "").replace("{title}", payload.title || "");
          break;
        }
        case "validation_rule": {
          const { field, min_length, max_length } = rule.actions || {};
          const val = payload[field];
          if (val && min_length && String(val).length < min_length) warnings.push(`${field} too short (min ${min_length})`);
          if (val && max_length && String(val).length > max_length) warnings.push(`${field} too long (max ${max_length})`);
          break;
        }
        default:
          break;
      }
    }

    // Apply feed profile overrides
    if (feedProfile) {
      if (feedProfile.title_template && payload.title) {
        payload.title = feedProfile.title_template.replace("{title}", payload.title).replace("{sku}", product.sku || "");
      }
      if (feedProfile.description_template && payload.description) {
        payload.description = feedProfile.description_template.replace("{description}", payload.description);
      }
      if (feedProfile.attribute_blacklist?.length) {
        for (const bl of feedProfile.attribute_blacklist) delete payload[bl];
      }
    }

    return new Response(JSON.stringify({ payload, warnings, blocks, applied_rules: appliedRules }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function applyTransformation(value: any, rules: any): any {
  if (!value || !rules) return value;
  if (rules.prefix) value = rules.prefix + value;
  if (rules.suffix) value = value + rules.suffix;
  if (rules.strip_html) value = String(value).replace(/<[^>]*>/g, "");
  if (rules.max_length) value = String(value).slice(0, rules.max_length);
  if (rules.uppercase) value = String(value).toUpperCase();
  if (rules.lowercase) value = String(value).toLowerCase();
  return value;
}

function evaluateCondition(conditions: any, product: any, payload: any): boolean {
  if (!conditions || Object.keys(conditions).length === 0) return true;
  if (conditions.category && product.category !== conditions.category) return false;
  if (conditions.product_type && product.product_type !== conditions.product_type) return false;
  if (conditions.has_attribute && !product.attributes?.[conditions.has_attribute]) return false;
  if (conditions.missing_attribute && product.attributes?.[conditions.missing_attribute]) return false;
  if (conditions.price_above && (parseFloat(product.optimized_price || product.original_price) || 0) <= conditions.price_above) return false;
  if (conditions.price_below && (parseFloat(product.optimized_price || product.original_price) || 0) >= conditions.price_below) return false;
  return true;
}
