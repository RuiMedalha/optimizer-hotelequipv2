import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, source_type, pages_processed, rows_processed, successful_matches, manual_reviews, average_confidence, average_cost, average_latency_ms } = await req.json();

    if (!supplier_id) {
      return new Response(JSON.stringify({ error: "supplier_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data, error } = await supabase.from("supplier_extraction_benchmarks").insert({
      supplier_id,
      source_type: source_type || null,
      pages_processed: pages_processed || 0,
      rows_processed: rows_processed || 0,
      successful_matches: successful_matches || 0,
      manual_reviews: manual_reviews || 0,
      average_confidence: average_confidence || 0,
      average_cost: average_cost || 0,
      average_latency_ms: average_latency_ms || 0,
    }).select().single();

    if (error) throw error;

    // Update source profile reliability based on match rate
    if (source_type && rows_processed > 0) {
      const matchRate = (successful_matches || 0) / rows_processed;
      await supabase
        .from("supplier_source_profiles")
        .update({ reliability_score: matchRate, updated_at: new Date().toISOString() })
        .eq("supplier_id", supplier_id)
        .eq("source_type", source_type);
    }

    return new Response(JSON.stringify({ benchmark: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
