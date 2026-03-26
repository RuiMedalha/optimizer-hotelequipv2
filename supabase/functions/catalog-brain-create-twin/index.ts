import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId, twinName, description } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Create snapshot
    const { data: products } = await supabase.from("products").select("id, sku, original_title, optimized_title, category, status, attributes").eq("workspace_id", workspaceId).limit(500);
    const { data: snapshot } = await supabase.from("catalog_twin_snapshots").insert({
      workspace_id: workspaceId,
      snapshot_name: `Snapshot ${new Date().toISOString().slice(0, 16)}`,
      snapshot_metadata: { product_count: products?.length || 0, created_at: new Date().toISOString() },
    }).select().single();

    // 2. Create twin
    const { data: twin } = await supabase.from("catalog_twins").insert({
      workspace_id: workspaceId,
      twin_name: twinName || `Twin ${new Date().toISOString().slice(0, 10)}`,
      description: description || "Digital twin auto-generated",
      source_snapshot_id: snapshot?.id,
      created_by: "system",
    }).select().single();

    // 3. Copy entities
    const entities = (products || []).map((p: any) => ({
      twin_id: twin!.id,
      entity_type: "product",
      entity_id: p.id,
      canonical_data: { sku: p.sku, title: p.optimized_title || p.original_title, category: p.category, status: p.status },
      channel_data: {},
      metadata: p.attributes || {},
    }));
    if (entities.length > 0) {
      await supabase.from("catalog_twin_entities").insert(entities);
    }

    // 4. Copy relations (parent-child)
    const parents = (products || []).filter((p: any) => p.parent_product_id);
    if (parents.length > 0) {
      const relations = parents.map((p: any) => ({
        twin_id: twin!.id,
        from_entity_id: p.parent_product_id,
        to_entity_id: p.id,
        relation_type: "parent_child",
      }));
      await supabase.from("catalog_twin_relations").insert(relations);
    }

    return new Response(JSON.stringify({ twin_id: twin!.id, snapshot_id: snapshot!.id, entities_count: entities.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
