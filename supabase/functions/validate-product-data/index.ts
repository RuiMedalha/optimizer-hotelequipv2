import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product } = await req.json();
    if (!workspace_id || !product) throw new Error("workspace_id and product are required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const missing: string[] = [];
    const warnings: string[] = [];

    const title = product.optimized_title || product.original_title || "";
    const desc = product.optimized_description || product.original_description || "";
    const shortDesc = product.optimized_short_description || product.short_description || "";
    const price = product.optimized_price || product.original_price;
    const images = product.image_urls || [];
    const category = product.category || product.category_id;
    const sku = product.sku || "";

    // Required fields
    if (!title.trim()) missing.push("title");
    if (!sku.trim()) missing.push("sku");
    if (!category) missing.push("category");
    if (!price || Number(price) <= 0) missing.push("price");

    // Description checks
    if (!desc.trim()) {
      missing.push("description");
    } else if (desc.trim().length < 50) {
      warnings.push("description_too_short");
    }

    // Short description
    if (!shortDesc.trim()) warnings.push("missing_short_description");

    // Images
    if (!images.length) {
      missing.push("images");
    } else if (images.length < 2) {
      warnings.push("only_one_image");
    }

    // SEO fields
    if (!product.meta_title) warnings.push("missing_meta_title");
    if (!product.meta_description) warnings.push("missing_meta_description");
    if (!product.seo_slug) warnings.push("missing_seo_slug");

    // Tags
    if (!product.tags || !product.tags.length) warnings.push("missing_tags");

    // Attributes
    if (!product.attributes || Object.keys(product.attributes).length === 0) {
      warnings.push("no_attributes");
    }

    // Check schema-based required attributes if category exists
    if (product.category_id) {
      const { data: schema } = await supabase
        .from("category_schemas")
        .select("schema_fields")
        .eq("workspace_id", workspace_id)
        .eq("category_id", product.category_id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (schema?.schema_fields && Array.isArray(schema.schema_fields)) {
        for (const field of schema.schema_fields as any[]) {
          if (field.required) {
            const val = product.attributes?.[field.name];
            if (val === undefined || val === null || val === "") {
              missing.push(`attribute:${field.name}`);
            }
          }
        }
      }
    }

    const validationStatus = missing.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid";
    const readyForPublish = missing.length === 0;

    const result = {
      validation_status: validationStatus,
      missing_fields: missing,
      warnings,
      ready_for_publish: readyForPublish,
      checked_fields: ["title", "sku", "category", "price", "description", "short_description", "images", "meta_title", "meta_description", "seo_slug", "tags", "attributes"],
    };

    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "data_validation",
      status: "completed",
      input_payload: { product_id: product.id, sku: product.sku },
      output_payload: result,
      confidence_score: readyForPublish ? 1 : missing.length > 3 ? 0.2 : 0.6,
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
