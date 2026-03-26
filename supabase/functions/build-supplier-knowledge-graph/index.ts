import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, workspace_id } = await req.json();

    if (!supplier_id || !workspace_id) {
      return new Response(JSON.stringify({ error: "supplier_id and workspace_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get supplier info
    const { data: supplier } = await supabase.from("supplier_profiles").select("*").eq("id", supplier_id).single();
    if (!supplier) throw new Error("Supplier not found");

    // Get patterns
    const { data: patterns } = await supabase.from("supplier_patterns").select("*").eq("supplier_id", supplier_id);

    // Get products for category links
    const { data: products } = await supabase
      .from("products")
      .select("id, category, sku, original_title")
      .eq("workspace_id", workspace_id)
      .eq("supplier_ref", supplier_id)
      .limit(200);

    // Clear old graph for this supplier
    await supabase.from("supplier_knowledge_graph").delete().eq("supplier_id", supplier_id).eq("workspace_id", workspace_id);

    const edges = [];

    // Supplier → Product Family edges (from sku_prefix patterns)
    const skuPatterns = (patterns || []).filter((p: any) => p.pattern_type === "sku_prefix");
    for (const p of skuPatterns) {
      edges.push({
        supplier_id, workspace_id,
        node_type: "supplier", node_id: supplier_id, node_label: supplier.supplier_name,
        related_node_type: "product_family", related_node_id: p.pattern_key, related_node_label: `Family ${p.pattern_key}`,
        relationship_type: "has_family",
        weight: p.confidence,
        metadata: { member_count: p.pattern_value?.member_count },
      });
    }

    // Product Family → Category edges
    const categories = new Set<string>();
    for (const product of (products || [])) {
      if (product.category) categories.add(product.category);
    }
    for (const cat of categories) {
      edges.push({
        supplier_id, workspace_id,
        node_type: "supplier", node_id: supplier_id, node_label: supplier.supplier_name,
        related_node_type: "category", related_node_id: cat, related_node_label: cat,
        relationship_type: "supplies_category",
        weight: 0.8,
      });
    }

    // Supplier → Attribute edges
    const attrPatterns = (patterns || []).filter((p: any) => p.pattern_type === "recurring_attribute");
    for (const p of attrPatterns) {
      edges.push({
        supplier_id, workspace_id,
        node_type: "supplier", node_id: supplier_id, node_label: supplier.supplier_name,
        related_node_type: "attribute", related_node_id: p.pattern_key, related_node_label: p.pattern_key,
        relationship_type: "uses_attribute",
        weight: p.confidence,
        metadata: { occurrences: p.occurrences },
      });
    }

    if (edges.length) {
      await supabase.from("supplier_knowledge_graph").insert(edges);
    }

    // Also save to Catalog Brain as observation
    await supabase.from("catalog_brain_observations").insert({
      workspace_id,
      observation_type: "supplier_knowledge_graph",
      payload: {
        supplier_id,
        supplier_name: supplier.supplier_name,
        families: skuPatterns.length,
        categories: categories.size,
        attributes: attrPatterns.length,
        total_edges: edges.length,
      },
    });

    return new Response(JSON.stringify({ edges_created: edges.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
