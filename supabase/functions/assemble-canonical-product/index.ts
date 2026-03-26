import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { canonical_product_id, workspace_id } = await req.json();

    if (!canonical_product_id) {
      return new Response(JSON.stringify({ error: "canonical_product_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Update status to assembling
    await supabase.from("canonical_products").update({ assembly_status: "assembling", updated_at: new Date().toISOString() }).eq("id", canonical_product_id);

    // Fetch candidates
    const { data: candidates } = await supabase.from("canonical_product_candidates").select("*").eq("canonical_product_id", canonical_product_id);

    if (!candidates?.length) {
      await supabase.from("canonical_products").update({ assembly_status: "error" }).eq("id", canonical_product_id);
      return new Response(JSON.stringify({ error: "No candidates found" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve fields from candidates by picking best source per field
    const fieldMap: Record<string, { value: any; confidence: number; source_type: string; source_id: string | null }> = {};
    const standardFields = ["title", "description", "short_description", "sku", "supplier_ref", "ean", "model", "brand", "category", "original_price", "sale_price", "attributes", "technical_specs", "meta_title", "meta_description", "seo_slug", "product_type", "stock"];

    for (const candidate of candidates) {
      const payload = candidate.candidate_payload || {};
      for (const field of standardFields) {
        if (payload[field] != null && payload[field] !== "") {
          const existing = fieldMap[field];
          const candidateConf = candidate.match_confidence || 0.5;
          if (!existing || candidateConf > existing.confidence) {
            fieldMap[field] = { value: payload[field], confidence: candidateConf, source_type: candidate.source_type, source_id: candidate.source_record_id };
          }
        }
      }
    }

    // Upsert canonical fields
    const fieldRows = Object.entries(fieldMap).map(([field_name, info]) => ({
      canonical_product_id,
      field_name,
      field_value: typeof info.value === "object" ? info.value : { v: info.value },
      field_type: typeof info.value === "number" ? "number" : Array.isArray(info.value) ? "array" : typeof info.value === "object" ? "object" : "text",
      confidence_score: info.confidence,
      selected_source_type: info.source_type,
      selected_source_record_id: info.source_id,
      selection_reason: "confidence_win",
      normalized_value: typeof info.value === "object" ? info.value : { v: info.value },
    }));

    // Delete old fields and insert new
    await supabase.from("canonical_product_fields").delete().eq("canonical_product_id", canonical_product_id);
    if (fieldRows.length) {
      await supabase.from("canonical_product_fields").insert(fieldRows);
    }

    // Calculate assembly confidence
    const avgConf = fieldRows.length ? fieldRows.reduce((s, f) => s + f.confidence_score, 0) / fieldRows.length : 0;
    const assemblyStatus = fieldRows.length >= 3 ? "assembled" : "partially_assembled";

    await supabase.from("canonical_products").update({
      assembly_status: assemblyStatus,
      assembly_confidence_score: avgConf,
      updated_at: new Date().toISOString(),
    }).eq("id", canonical_product_id);

    // Log
    await supabase.from("canonical_assembly_logs").insert({
      canonical_product_id,
      assembly_step: "full_assembly",
      status: "completed",
      input_summary: { candidates_count: candidates.length },
      output_summary: { fields_resolved: fieldRows.length, avg_confidence: avgConf },
      confidence_after: avgConf,
    });

    return new Response(JSON.stringify({ fields_resolved: fieldRows.length, assembly_confidence: avgConf, status: assemblyStatus }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
