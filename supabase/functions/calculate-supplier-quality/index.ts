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

    // Get benchmarks
    const { data: benchmarks } = await supabase
      .from("supplier_extraction_benchmarks")
      .select("*")
      .eq("supplier_id", supplier_id)
      .order("created_at", { ascending: false })
      .limit(20);

    // Get products count
    const { count: totalProducts } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace_id)
      .eq("supplier_ref", supplier_id);

    // Get conflicts count
    const { count: conflicts } = await supabase
      .from("conflict_cases")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace_id);

    const totalImports = benchmarks?.length || 0;
    const totalRows = benchmarks?.reduce((s: number, b: any) => s + (b.rows_processed || 0), 0) || 1;
    const successfulMatches = benchmarks?.reduce((s: number, b: any) => s + (b.successful_matches || 0), 0) || 0;
    const manualReviews = benchmarks?.reduce((s: number, b: any) => s + (b.manual_reviews || 0), 0) || 0;

    const matchingAccuracy = totalRows > 0 ? successfulMatches / totalRows : 0;
    const missingFieldsRate = benchmarks?.length
      ? 1 - (benchmarks.reduce((s: number, b: any) => s + (b.average_confidence || 0), 0) / benchmarks.length)
      : 1;
    const conflictRate = (totalProducts || 0) > 0 ? (conflicts || 0) / (totalProducts || 1) : 0;
    const parseErrorRate = totalRows > 0 ? Math.max(0, 1 - (successfulMatches + manualReviews) / totalRows) : 1;
    const overallScore = (matchingAccuracy * 0.4 + (1 - missingFieldsRate) * 0.25 + (1 - conflictRate) * 0.2 + (1 - parseErrorRate) * 0.15);

    // Upsert quality score
    const { data: existing } = await supabase
      .from("supplier_data_quality_scores")
      .select("id")
      .eq("supplier_id", supplier_id)
      .eq("workspace_id", workspace_id)
      .maybeSingle();

    const scoreData = {
      supplier_id,
      workspace_id,
      matching_accuracy: Number(matchingAccuracy.toFixed(4)),
      missing_fields_rate: Number(missingFieldsRate.toFixed(4)),
      conflict_rate: Number(conflictRate.toFixed(4)),
      parse_error_rate: Number(parseErrorRate.toFixed(4)),
      overall_score: Number(overallScore.toFixed(4)),
      total_imports: totalImports,
      total_products: totalProducts || 0,
      last_calculated_at: new Date().toISOString(),
    };

    if (existing) {
      await supabase.from("supplier_data_quality_scores").update({ ...scoreData, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("supplier_data_quality_scores").insert(scoreData);
    }

    return new Response(JSON.stringify({ quality_score: scoreData }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
