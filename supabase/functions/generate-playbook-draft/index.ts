import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, supplier_id, detection_id, inference_id, ingestion_job_id, uploaded_file_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    // Gather detection data
    let detection: any = null;
    if (detection_id) {
      const { data } = await supabase.from("supplier_auto_detections").select("*").eq("id", detection_id).single();
      detection = data;
    }

    // Gather inference data
    let inference: any = null;
    if (inference_id) {
      const { data } = await supabase.from("supplier_column_inferences").select("*").eq("id", inference_id).single();
      inference = data;
    }

    // Gather supplier patterns if available
    let patterns: any[] = [];
    const sid = supplier_id || detection?.matched_supplier_id;
    if (sid) {
      const { data } = await supabase.from("supplier_patterns").select("*").eq("supplier_id", sid).order("confidence", { ascending: false }).limit(20);
      patterns = data || [];
    }

    // Gather supplier schema profiles
    let schemas: any[] = [];
    if (sid) {
      const { data } = await supabase.from("supplier_schema_profiles").select("*").eq("supplier_id", sid).order("created_at", { ascending: false }).limit(1);
      schemas = data || [];
    }

    // Build column mapping from inference
    const columnMapping = inference?.inferred_mapping || {};

    // Build matching rules from patterns
    const matchingRules: any[] = [];
    const skuPatterns = patterns.filter(p => p.pattern_type === "sku_family");
    if (skuPatterns.length > 0) {
      matchingRules.push({
        rule_type: "sku_prefix",
        config: { prefixes: skuPatterns.map((p: any) => p.pattern_value?.prefix).filter(Boolean) },
        confidence: Math.max(...skuPatterns.map((p: any) => p.confidence || 0)),
      });
    }
    // Default SKU-based matching
    matchingRules.push({ rule_type: "exact_sku", config: {}, confidence: 0.95 });

    // Build grouping rules
    const groupingRules: any[] = [];
    const variationCols = Object.entries(columnMapping)
      .filter(([_, m]: any) => (m as any).method === "variation_hint")
      .map(([h]) => h);
    if (variationCols.length > 0) {
      groupingRules.push({
        rule_type: "variation_attribute",
        config: { columns: variationCols },
        confidence: 0.7,
      });
    }

    // Taxonomy suggestion
    const taxonomySuggestion: any = {};
    const categoryCol = Object.entries(columnMapping).find(([_, m]: any) => (m as any).field === "category");
    if (categoryCol) {
      taxonomySuggestion.source_column = categoryCol[0];
      taxonomySuggestion.auto_create = true;
    }

    // Image strategy
    const imageStrategy: any = { auto_download: false };
    const imageCol = Object.entries(columnMapping).find(([_, m]: any) => (m as any).field === "image_urls");
    if (imageCol) {
      imageStrategy.source_column = imageCol[0];
      imageStrategy.auto_download = true;
    }

    // Validation profile
    const validationProfile: any = {
      require_sku: true,
      require_title: true,
      require_price: false,
      min_title_length: 5,
    };

    // Identify low confidence fields
    const needsReviewFields: string[] = [];
    for (const [header, m] of Object.entries(columnMapping)) {
      if ((m as any).confidence < 0.7) {
        needsReviewFields.push(header);
      }
    }

    // Overall confidence
    const confScores = Object.values(columnMapping).map((m: any) => m.confidence || 0);
    const overallConfidence = confScores.length > 0
      ? confScores.reduce((s: number, c: number) => s + c, 0) / confScores.length
      : 0;

    const playbookName = detection?.detected_supplier_name
      ? `Auto: ${detection.detected_supplier_name}`
      : `Auto Playbook ${new Date().toISOString().slice(0, 10)}`;

    // Build simplified column mapping for playbook
    const simpleMapping: Record<string, string> = {};
    for (const [h, m] of Object.entries(columnMapping)) {
      simpleMapping[h] = (m as any).field || (m as any);
    }

    // Check for existing draft for same supplier/file to update instead of duplicate
    let existingDraft = null;
    if (sid) {
      const { data: existing } = await supabase
        .from("supplier_playbook_drafts")
        .select("id, version_number")
        .eq("workspace_id", workspace_id)
        .eq("supplier_id", sid)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1);
      if (existing && existing.length > 0) existingDraft = existing[0];
    }

    let draft;
    let error;

    if (existingDraft) {
      // Update existing draft
      const result = await supabase
        .from("supplier_playbook_drafts")
        .update({
          playbook_name: playbookName,
          playbook_config: {
            source_type: detection?.source_type || "excel",
            merge_strategy: "merge",
            duplicate_detection: ["sku"],
          },
          column_mapping: simpleMapping,
          matching_rules: matchingRules,
          grouping_rules: groupingRules,
          taxonomy_suggestion: taxonomySuggestion,
          image_strategy: imageStrategy,
          validation_profile: validationProfile,
          confidence_score: overallConfidence,
          needs_review_fields: needsReviewFields,
          ingestion_job_id: ingestion_job_id || null,
          uploaded_file_id: uploaded_file_id || null,
          version_number: (existingDraft.version_number || 1) + 1,
        })
        .eq("id", existingDraft.id)
        .select()
        .single();
      draft = result.data;
      error = result.error;
    } else {
      // Create new draft
      const result = await supabase
        .from("supplier_playbook_drafts")
        .insert({
          workspace_id,
          supplier_id: sid || null,
          detection_id: detection_id || null,
          playbook_name: playbookName,
          playbook_config: {
            source_type: detection?.source_type || "excel",
            merge_strategy: "merge",
            duplicate_detection: ["sku"],
          },
          column_mapping: simpleMapping,
          matching_rules: matchingRules,
          grouping_rules: groupingRules,
          taxonomy_suggestion: taxonomySuggestion,
          image_strategy: imageStrategy,
          validation_profile: validationProfile,
          confidence_score: overallConfidence,
          needs_review_fields: needsReviewFields,
          auto_generated: true,
          status: "draft",
          ingestion_job_id: ingestion_job_id || null,
          uploaded_file_id: uploaded_file_id || null,
          version_number: 1,
        })
        .select()
        .single();
      draft = result.data;
      error = result.error;
    }

    if (error) throw error;

    return new Response(JSON.stringify({
      success: true,
      draft,
      confidence: overallConfidence,
      needs_review_fields: needsReviewFields,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
