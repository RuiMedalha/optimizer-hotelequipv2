import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { twinId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: twin } = await supabase.from("catalog_twins").select("*").eq("id", twinId).single();
    if (!twin) throw new Error("Twin não encontrado");

    // Delete old entities and re-copy
    await supabase.from("catalog_twin_entities").delete().eq("twin_id", twinId);
    await supabase.from("catalog_twin_relations").delete().eq("twin_id", twinId);

    const { data: products } = await supabase.from("products").select("id, sku, original_title, optimized_title, category, status, attributes, parent_product_id").eq("workspace_id", twin.workspace_id).limit(500);

    const entities = (products || []).map((p: any) => ({
      twin_id: twinId,
      entity_type: "product",
      entity_id: p.id,
      canonical_data: { sku: p.sku, title: p.optimized_title || p.original_title, category: p.category, status: p.status },
      metadata: p.attributes || {},
    }));

    if (entities.length > 0) await supabase.from("catalog_twin_entities").insert(entities);

    await supabase.from("catalog_twins").update({ updated_at: new Date().toISOString() }).eq("id", twinId);

    return new Response(JSON.stringify({ synced: entities.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
