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

    const { workspace_id, canonical_product_id, product_id, supplier_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    const conflicts: any[] = [];

    // Check canonical product fields for source value conflicts
    if (canonical_product_id) {
      const { data: candidates } = await supabase
        .from("canonical_product_candidates")
        .select("*")
        .eq("canonical_product_id", canonical_product_id);

      const { data: fields } = await supabase
        .from("canonical_product_fields")
        .select("*")
        .eq("canonical_product_id", canonical_product_id);

      // Detect low confidence fields
      for (const field of (fields || [])) {
        if ((field.confidence_score || 0) < 0.6) {
          conflicts.push({
            workspace_id,
            canonical_product_id,
            product_id,
            supplier_id,
            conflict_type: "source_value_conflict",
            conflict_scope: "field",
            severity: (field.confidence_score || 0) < 0.3 ? "critical" : "high",
            requires_human_review: (field.confidence_score || 0) < 0.4,
          });
        }
      }

      // Detect identity conflicts
      const { data: canonical } = await supabase
        .from("canonical_products")
        .select("product_identity_status")
        .eq("id", canonical_product_id)
        .single();

      if (canonical?.product_identity_status === "review_required") {
        conflicts.push({
          workspace_id,
          canonical_product_id,
          product_id,
          supplier_id,
          conflict_type: "identity_conflict",
          conflict_scope: "product",
          severity: "high",
          requires_human_review: true,
        });
      }
    }

    // Check product-level issues
    if (product_id) {
      const { data: product } = await supabase
        .from("products")
        .select("optimized_price, original_price, image_urls, category_id, seo_score")
        .eq("id", product_id)
        .single();

      if (product) {
        const price = product.optimized_price || product.original_price;
        if (!price || price <= 0) {
          conflicts.push({
            workspace_id, canonical_product_id, product_id, supplier_id,
            conflict_type: "pricing_conflict",
            conflict_scope: "product",
            severity: "critical",
            requires_human_review: true,
          });
        }

        if (!product.image_urls || product.image_urls.length === 0) {
          conflicts.push({
            workspace_id, canonical_product_id, product_id, supplier_id,
            conflict_type: "asset_conflict",
            conflict_scope: "asset_set",
            severity: "high",
            requires_human_review: false,
          });
        }
      }
    }

    // Insert conflict cases
    const created = [];
    for (const c of conflicts) {
      const { data, error } = await supabase
        .from("conflict_cases")
        .insert(c)
        .select()
        .single();
      if (data) created.push(data);
    }

    return new Response(JSON.stringify({ conflicts_detected: created.length, conflicts: created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
