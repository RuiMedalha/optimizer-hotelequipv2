import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { canonical_product_id, relationships } = await req.json();

    if (!canonical_product_id || !relationships?.length) {
      return new Response(JSON.stringify({ error: "canonical_product_id and relationships required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = relationships.map((r: any) => ({
      canonical_product_id,
      relationship_type: r.relationship_type,
      related_canonical_product_id: r.related_canonical_product_id,
      relationship_reason: r.reason || null,
      confidence_score: r.confidence || 0.5,
    }));

    const { error } = await supabase.from("canonical_product_relationships").insert(rows);
    if (error) throw error;

    await supabase.from("canonical_assembly_logs").insert({
      canonical_product_id,
      assembly_step: "build_relationships",
      status: "completed",
      output_summary: { relationships_created: rows.length },
    });

    return new Response(JSON.stringify({ created: rows.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
