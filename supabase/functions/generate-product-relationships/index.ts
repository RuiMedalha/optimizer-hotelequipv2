import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: products } = await supabase.from("products").select("id, category, original_title, optimized_title, attributes, tags").eq("workspace_id", workspaceId).limit(500);
    if (!products?.length) return new Response(JSON.stringify({ relationships: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const rels: any[] = [];
    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < Math.min(i + 20, products.length); j++) {
        const a = products[i], b = products[j];
        if (a.category && a.category === b.category) {
          const aPrice = Number((a as any).original_price || 0), bPrice = Number((b as any).original_price || 0);
          let type = "complementary", conf = 40 + Math.random() * 30;
          if (aPrice > 0 && bPrice > 0 && bPrice > aPrice * 1.5) { type = "upsell"; conf += 10; }
          else if (aPrice > 0 && bPrice > 0 && bPrice < aPrice * 0.5) { type = "accessory"; conf += 5; }
          const aTags = new Set((a.tags || []).map((t: string) => t.toLowerCase()));
          const bTags = new Set((b.tags || []).map((t: string) => t.toLowerCase()));
          const shared = [...aTags].filter(t => bTags.has(t)).length;
          if (shared >= 2) { type = "bundle_candidate"; conf += 15; }
          rels.push({ workspace_id: workspaceId, product_a_id: a.id, product_b_id: b.id, relationship_type: type, confidence: Math.min(95, Math.round(conf)), source: "auto_detection" });
        }
      }
    }
    if (rels.length > 0) await supabase.from("product_relationships").insert(rels.slice(0, 200));
    return new Response(JSON.stringify({ relationships: Math.min(rels.length, 200) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
});
