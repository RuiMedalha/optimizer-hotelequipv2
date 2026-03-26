import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { workspaceId, values, supplierName } = await req.json();
    if (!workspaceId || !values || !Array.isArray(values)) throw new Error("workspaceId and values[] required");

    // Load normalization dictionary
    let dictQuery = supabase
      .from("normalization_dictionary")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("confidence", { ascending: false });

    if (supplierName) {
      dictQuery = supabase
        .from("normalization_dictionary")
        .select("*")
        .eq("workspace_id", workspaceId)
        .or(`supplier_name.eq.${supplierName},supplier_name.is.null`)
        .order("confidence", { ascending: false });
    }

    const { data: dictionary } = await dictQuery;

    // Build lookup maps by type
    const lookups: Record<string, Map<string, { normalized: string; confidence: number }>> = {};
    for (const d of (dictionary || [])) {
      if (!lookups[d.dictionary_type]) lookups[d.dictionary_type] = new Map();
      const key = d.source_term.toLowerCase();
      if (!lookups[d.dictionary_type].has(key)) {
        lookups[d.dictionary_type].set(key, {
          normalized: d.normalized_term,
          confidence: d.confidence,
        });
      }
    }

    // Normalize each value
    const results = values.map((v: any) => {
      const input = v.value || "";
      const fieldType = v.field_type || "attribute_value";
      let normalized = input;
      let matched = false;
      let matchSource = "";
      let matchConfidence = 0;

      // Try exact match first
      const typeMap = lookups[fieldType];
      if (typeMap) {
        const exact = typeMap.get(input.toLowerCase());
        if (exact) {
          normalized = exact.normalized;
          matched = true;
          matchSource = `dictionary:${fieldType}`;
          matchConfidence = exact.confidence;
        }
      }

      // Try substring match for units
      if (!matched && (fieldType === "unit" || fieldType === "attribute_value")) {
        for (const [type, map] of Object.entries(lookups)) {
          for (const [term, entry] of map) {
            if (input.toLowerCase().includes(term)) {
              normalized = input.replace(new RegExp(term, "gi"), entry.normalized);
              matched = true;
              matchSource = `dictionary:${type}:partial`;
              matchConfidence = Math.max(0, entry.confidence - 10);
              break;
            }
          }
          if (matched) break;
        }
      }

      return {
        original: input,
        normalized,
        matched,
        source: matchSource,
        confidence: matchConfidence,
        field_key: v.field_key || null,
      };
    });

    return new Response(JSON.stringify({
      success: true,
      totalValues: values.length,
      normalizedCount: results.filter((r: any) => r.matched).length,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("normalize-extracted-values error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
