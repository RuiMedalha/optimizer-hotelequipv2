import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { canonical_product_id, assets } = await req.json();

    if (!canonical_product_id || !assets?.length) {
      return new Response(JSON.stringify({ error: "canonical_product_id and assets required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Delete existing and re-insert
    await supabase.from("canonical_product_assets").delete().eq("canonical_product_id", canonical_product_id);

    const rows = assets.map((a: any, i: number) => ({
      canonical_product_id,
      asset_id: a.asset_id,
      usage_context: a.usage_context || "gallery",
      sort_order: a.sort_order ?? i,
      is_primary: i === 0,
      source_type: a.source_type || "upload",
      confidence_score: a.confidence_score || 0.5,
    }));

    const { error } = await supabase.from("canonical_product_assets").insert(rows);
    if (error) throw error;

    await supabase.from("canonical_assembly_logs").insert({
      canonical_product_id,
      assembly_step: "link_assets",
      status: "completed",
      output_summary: { assets_linked: rows.length },
    });

    return new Response(JSON.stringify({ linked: rows.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
