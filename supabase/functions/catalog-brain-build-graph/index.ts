import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get products that don't have brain entities yet
    const { data: products } = await supabase
      .from("products").select("id, original_title, category, category_id, workspace_id")
      .eq("workspace_id", workspaceId).limit(200);

    const { data: existingEntities } = await supabase
      .from("catalog_brain_entities").select("entity_id")
      .eq("workspace_id", workspaceId).eq("entity_type", "product");

    const existingIds = new Set((existingEntities || []).map((e: any) => e.entity_id));
    const newEntities: any[] = [];

    for (const p of (products || [])) {
      if (!existingIds.has(p.id)) {
        newEntities.push({
          workspace_id: workspaceId, entity_type: "product",
          entity_id: p.id, entity_label: p.original_title || p.id,
          metadata: { category: p.category, category_id: p.category_id },
        });
      }
    }

    if (newEntities.length) {
      await supabase.from("catalog_brain_entities").insert(newEntities);
    }

    // Build relations: same_category between products
    const { data: allEntities } = await supabase
      .from("catalog_brain_entities").select("id, entity_id, metadata, entity_type")
      .eq("workspace_id", workspaceId).eq("entity_type", "product");

    const byCategory: Record<string, any[]> = {};
    for (const e of (allEntities || [])) {
      const cat = e.metadata?.category;
      if (cat) { (byCategory[cat] = byCategory[cat] || []).push(e); }
    }

    let relationsCreated = 0;
    for (const cat in byCategory) {
      const group = byCategory[cat];
      if (group.length < 2 || group.length > 20) continue;
      for (let i = 0; i < Math.min(group.length, 5); i++) {
        for (let j = i + 1; j < Math.min(group.length, 5); j++) {
          const { error } = await supabase.from("catalog_brain_relations").insert({
            workspace_id: workspaceId,
            source_entity_id: group[i].id, target_entity_id: group[j].id,
            relation_type: "same_category", weight: 0.8,
            metadata: { category: cat },
          });
          if (!error) relationsCreated++;
        }
      }
    }

    // Build product DNA profiles
    const { data: prods } = await supabase
      .from("products").select("*").eq("workspace_id", workspaceId).limit(100);

    let dnaCreated = 0;
    for (const p of (prods || [])) {
      const { data: existing } = await supabase
        .from("product_dna_profiles").select("id").eq("product_id", p.id).maybeSingle();
      if (existing) continue;

      const hasTitle = !!(p.optimized_title || p.original_title);
      const hasDesc = !!p.optimized_description;
      const hasImages = !!(p.image_urls?.length);
      const hasSeo = !!(p.meta_title && p.meta_description);
      const hasPrice = !!(p.optimized_price || p.original_price);
      const completeness = [hasTitle, hasDesc, hasImages, hasSeo, hasPrice].filter(Boolean).length * 20;

      await supabase.from("product_dna_profiles").insert({
        workspace_id: workspaceId, product_id: p.id,
        technical_dna: { sku: p.sku, attributes: p.attributes, specs: p.technical_specs },
        commercial_dna: { price: p.optimized_price || p.original_price, sale_price: p.sale_price, category: p.category },
        visual_dna: { image_count: p.image_urls?.length || 0, has_alt_text: !!p.image_alt_texts },
        linguistic_dna: { has_optimized_title: !!p.optimized_title, has_seo: hasSeo, has_faq: !!(p.faq?.length) },
        channel_dna: { woocommerce_id: p.woocommerce_id },
        completeness_score: completeness,
        quality_score: p.seo_score || 0,
      });
      dnaCreated++;
    }

    return new Response(JSON.stringify({
      entities_created: newEntities.length,
      relations_created: relationsCreated,
      dna_profiles_created: dnaCreated,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
