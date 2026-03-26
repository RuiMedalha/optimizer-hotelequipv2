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

    const { workspaceId, supplierName, headers, pageContext } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    // 1. Load memory patterns for this workspace (optionally filtered by supplier)
    let patternsQuery = supabase
      .from("extraction_memory_patterns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .gte("confidence", 30)
      .order("confidence", { ascending: false })
      .limit(200);

    if (supplierName) {
      // Get both supplier-specific and general patterns
      patternsQuery = supabase
        .from("extraction_memory_patterns")
        .select("*")
        .eq("workspace_id", workspaceId)
        .gte("confidence", 30)
        .or(`supplier_name.eq.${supplierName},supplier_name.is.null`)
        .order("confidence", { ascending: false })
        .limit(200);
    }

    const { data: patterns } = await patternsQuery;

    // 2. Load normalization dictionary
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

    // 3. Load approved decision history
    const { data: decisions } = await supabase
      .from("extraction_decision_history")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("approved", true)
      .order("confidence", { ascending: false })
      .limit(100);

    // 4. Load similar case signatures
    let caseSigQuery = supabase
      .from("extraction_case_signatures")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("confidence", { ascending: false })
      .limit(50);

    if (supplierName) {
      caseSigQuery = supabase
        .from("extraction_case_signatures")
        .select("*")
        .eq("workspace_id", workspaceId)
        .or(`supplier_name.eq.${supplierName},supplier_name.is.null`)
        .order("confidence", { ascending: false })
        .limit(50);
    }

    const { data: caseSigs } = await caseSigQuery;

    // 5. Build column mappings from patterns
    const columnMappings: Record<string, { semantic_type: string; confidence: number; source: string }> = {};
    for (const p of (patterns || []).filter((p: any) => p.pattern_type === "column_mapping" || p.pattern_type === "header_alias")) {
      const key = p.pattern_key.toLowerCase();
      if (!columnMappings[key] || columnMappings[key].confidence < p.confidence) {
        columnMappings[key] = {
          semantic_type: (p.pattern_value as any)?.semantic_type || (p.pattern_value as any)?.mapped_to || "unknown",
          confidence: p.confidence,
          source: `memory:${p.source_type}`,
        };
      }
    }

    // 6. Apply header mappings if headers provided
    const resolvedHeaders: any[] = [];
    if (headers && Array.isArray(headers)) {
      for (const h of headers) {
        const key = h.toLowerCase().trim();
        if (columnMappings[key]) {
          resolvedHeaders.push({
            header: h,
            semantic_type: columnMappings[key].semantic_type,
            confidence: columnMappings[key].confidence,
            source: columnMappings[key].source,
            from_memory: true,
          });
        } else {
          // Check normalization dictionary for alias
          const alias = (dictionary || []).find((d: any) =>
            d.dictionary_type === "attribute_name" && d.source_term.toLowerCase() === key
          );
          if (alias) {
            resolvedHeaders.push({
              header: h,
              semantic_type: alias.normalized_term,
              confidence: alias.confidence,
              source: "normalization_dictionary",
              from_memory: true,
            });
          } else {
            resolvedHeaders.push({
              header: h,
              semantic_type: "unknown",
              confidence: 0,
              source: "unresolved",
              from_memory: false,
            });
          }
        }
      }
    }

    // 7. Build normalization map
    const normMap: Record<string, { normalized: string; confidence: number; type: string }> = {};
    for (const d of (dictionary || [])) {
      const key = `${d.dictionary_type}:${d.source_term.toLowerCase()}`;
      if (!normMap[key]) {
        normMap[key] = { normalized: d.normalized_term, confidence: d.confidence, type: d.dictionary_type };
      }
    }

    // 8. Compile suggested decisions
    const suggestedDecisions = (decisions || []).map((d: any) => ({
      type: d.decision_type,
      input: d.input_signature,
      output: d.decision_output,
      confidence: d.confidence,
    }));

    // 9. Update usage counts for used patterns
    const usedPatternIds = (patterns || [])
      .filter((p: any) => columnMappings[p.pattern_key.toLowerCase()])
      .map((p: any) => p.id);

    if (usedPatternIds.length > 0) {
      for (const pid of usedPatternIds) {
        await supabase
          .from("extraction_memory_patterns")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", pid);
      }
      // Increment usage_count via rpc
      for (const pid of usedPatternIds.slice(0, 20)) {
        try {
          await supabase.rpc("increment_pattern_usage", { _pattern_id: pid });
        } catch {
          // Function may not exist yet, skip silently
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      patternsLoaded: (patterns || []).length,
      columnMappings,
      resolvedHeaders,
      normalizationMap: normMap,
      suggestedDecisions,
      caseSimilarity: (caseSigs || []).length,
      supplierMatched: supplierName || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("apply-extraction-memory error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
