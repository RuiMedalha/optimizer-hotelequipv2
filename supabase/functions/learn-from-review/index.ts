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

    const {
      workspaceId, reviewedBy, corrections, saveAsPatterns,
    } = await req.json();

    if (!workspaceId || !reviewedBy) throw new Error("workspaceId and reviewedBy required");
    if (!corrections || !Array.isArray(corrections) || corrections.length === 0) {
      throw new Error("corrections array required");
    }

    let patternsCreated = 0;
    let correctionsStored = 0;
    let decisionsStored = 0;
    let normalizationsCreated = 0;

    for (const c of corrections) {
      // 1. Store the correction
      const { error: corrErr } = await supabase.from("extraction_corrections").insert({
        workspace_id: workspaceId,
        product_id: c.product_id || null,
        pdf_row_id: c.pdf_row_id || null,
        pdf_table_id: c.pdf_table_id || null,
        field_key: c.field_key,
        raw_value: c.raw_value,
        corrected_value: c.corrected_value,
        correction_type: c.correction_type || "value_fix",
        reviewed_by: reviewedBy,
        review_context: c.review_context || {},
      });
      if (!corrErr) correctionsStored++;

      // 2. Create/update memory pattern if saveAsPatterns is true
      if (saveAsPatterns !== false) {
        // Determine pattern type from correction type
        const patternTypeMap: Record<string, string> = {
          value_fix: "column_mapping",
          column_reassignment: "column_mapping",
          category_fix: "category_mapping",
          attribute_fix: "attribute_mapping",
          variation_fix: "variation_rule",
          unit_fix: "unit_normalization",
          grouping_fix: "grouping_rule",
          image_fix: "image_association_rule",
        };
        const patternType = patternTypeMap[c.correction_type] || "column_mapping";

        // Check if pattern already exists
        const { data: existing } = await supabase
          .from("extraction_memory_patterns")
          .select("id, confidence, success_count, usage_count")
          .eq("workspace_id", workspaceId)
          .eq("pattern_type", patternType)
          .eq("pattern_key", c.field_key)
          .maybeSingle();

        if (existing) {
          // Boost confidence of existing pattern
          const newConf = Math.min(100, existing.confidence + 5);
          await supabase.from("extraction_memory_patterns").update({
            confidence: newConf,
            success_count: (existing.success_count || 0) + 1,
            usage_count: (existing.usage_count || 0) + 1,
            last_confirmed_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
            source_type: "human_confirmed",
            pattern_value: {
              raw: c.raw_value,
              corrected: c.corrected_value,
              semantic_type: c.semantic_type || c.field_key,
              supplier: c.supplier_name || null,
            },
          }).eq("id", existing.id);
        } else {
          // Create new pattern
          await supabase.from("extraction_memory_patterns").insert({
            workspace_id: workspaceId,
            supplier_name: c.supplier_name || null,
            pattern_type: patternType,
            pattern_key: c.field_key,
            pattern_value: {
              raw: c.raw_value,
              corrected: c.corrected_value,
              semantic_type: c.semantic_type || c.field_key,
            },
            confidence: 70,
            usage_count: 1,
            success_count: 1,
            source_type: "human_confirmed",
            created_by: reviewedBy,
            last_confirmed_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
          });
          patternsCreated++;
        }
      }

      // 3. Store decision history
      if (c.correction_type === "category_fix" || c.correction_type === "attribute_fix" || c.correction_type === "variation_fix") {
        const decisionTypeMap: Record<string, string> = {
          category_fix: "category_assignment",
          attribute_fix: "attribute_selection",
          variation_fix: "variation_grouping",
        };
        await supabase.from("extraction_decision_history").insert({
          workspace_id: workspaceId,
          decision_type: decisionTypeMap[c.correction_type] || "category_assignment",
          input_signature: { field_key: c.field_key, raw_value: c.raw_value, supplier: c.supplier_name },
          decision_output: { corrected_value: c.corrected_value, semantic_type: c.semantic_type },
          confidence: 75,
          approved: true,
          approved_by: reviewedBy,
        });
        decisionsStored++;
      }

      // 4. Update normalization dictionary for unit/material/color fixes
      if (c.correction_type === "unit_fix" || c.correction_type === "value_fix") {
        if (c.raw_value && c.corrected_value && c.raw_value !== c.corrected_value) {
          const dictType = c.correction_type === "unit_fix" ? "unit" : "attribute_value";
          const { data: existingNorm } = await supabase
            .from("normalization_dictionary")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("dictionary_type", dictType)
            .eq("source_term", c.raw_value)
            .maybeSingle();

          if (!existingNorm) {
            await supabase.from("normalization_dictionary").insert({
              workspace_id: workspaceId,
              dictionary_type: dictType,
              source_term: c.raw_value,
              normalized_term: c.corrected_value,
              supplier_name: c.supplier_name || null,
              confidence: 75,
            });
            normalizationsCreated++;
          }
        }
      }

      // 5. If pattern was applied and failed, decrease its confidence
      if (c.applied_pattern_id) {
        const { data: failedPattern } = await supabase
          .from("extraction_memory_patterns")
          .select("id, confidence, failure_count")
          .eq("id", c.applied_pattern_id)
          .single();

        if (failedPattern) {
          await supabase.from("extraction_memory_patterns").update({
            confidence: Math.max(0, failedPattern.confidence - 5),
            failure_count: (failedPattern.failure_count || 0) + 1,
          }).eq("id", failedPattern.id);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      correctionsStored,
      patternsCreated,
      decisionsStored,
      normalizationsCreated,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("learn-from-review error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
