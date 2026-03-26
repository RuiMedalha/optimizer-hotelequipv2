import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, external_family, external_category, external_subcategory } = await req.json();

    if (!supplier_id) {
      return new Response(JSON.stringify({ error: "supplier_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Look up existing mapping
    let query = supabase.from("supplier_taxonomy_mappings").select("*").eq("supplier_id", supplier_id);
    if (external_family) query = query.eq("external_family", external_family);
    if (external_category) query = query.eq("external_category", external_category);

    const { data: mappings } = await query.limit(5);

    if (mappings?.length) {
      return new Response(JSON.stringify({
        mapped: true,
        mappings: mappings.map((m: any) => ({
          internal_category_id: m.internal_category_id,
          confidence: m.mapping_confidence,
          source: m.mapping_source,
        })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      mapped: false,
      suggestion: "No mapping found. AI inference or manual mapping required.",
      external_family,
      external_category,
      external_subcategory,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
