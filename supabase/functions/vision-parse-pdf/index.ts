import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEMANTIC_TYPES = ["sku", "title", "description", "price", "dimensions", "capacity", "material", "weight", "voltage", "color", "size", "notes", "image_url", "category", "brand", "quantity", "unit", "unknown"] as const;
const TABLE_TYPES = ["product_table", "technical_specs", "pricing_table", "accessories", "compatibility", "spare_parts"] as const;

const COLUMN_VALIDATION: Record<string, (v: string) => boolean> = {
  sku: (v) => /^[A-Za-z0-9\-_.\/]{2,}$/.test(v.trim()),
  price: (v) => /[\d]+[.,]?\d*/.test(v.replace(/[€$£\s]/g, "")),
  dimensions: (v) => /\d+\s*[xX×]\s*\d+/.test(v) || /\d+\s*(mm|cm|m|pol|in)/.test(v),
  capacity: (v) => /\d+\s*(l|L|ml|mL|cl|gal)/.test(v),
  weight: (v) => /\d+\s*(g|kg|lb|oz)/.test(v),
  voltage: (v) => /\d+\s*(V|v|volt)/.test(v),
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { pageId } = await req.json();
    if (!pageId) throw new Error("pageId required");

    const { data: page, error } = await supabase
      .from("pdf_pages")
      .select("*, pdf_extractions:extraction_id(*, workspace_id)")
      .eq("id", pageId)
      .single();
    if (error || !page) throw new Error("Page not found");

    const workspaceId = page.pdf_extractions?.workspace_id;

    // Load templates + supplier profiles
    let templates: any[] = [];
    let supplierProfiles: any[] = [];
    if (workspaceId) {
      const [tplRes, profRes] = await Promise.all([
        supabase.from("pdf_table_templates").select("*").eq("workspace_id", workspaceId),
        supabase.from("supplier_layout_profiles").select("*").eq("workspace_id", workspaceId),
      ]);
      templates = tplRes.data || [];
      supplierProfiles = profRes.data || [];
    }

    // Load technical symbols
    const { data: symbols } = await supabase.from("technical_symbol_dictionary").select("*");

    // Zone Segmentation from text
    const rawText = (page.raw_text || "").substring(0, 10000);
    const lines = rawText.split("\n");
    const zones: any[] = [];
    let currentZone: any = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let zoneType = "paragraph";
      if (i < 3 && /^[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇÑ\s]{5,}$/.test(line)) zoneType = "header";
      else if (/^(nota|notes|obs|observ|atenção|aviso)/i.test(line)) zoneType = "note";
      else if (i > lines.length - 4 && line.length < 60) zoneType = "footer";
      else if (/[\t|]/.test(line) && line.split(/[\t|]/).length >= 3) zoneType = "table";
      else if (line.length < 40 && /^[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇÑ]/.test(line) && !line.includes("\t")) zoneType = "section_title";

      if (!currentZone || currentZone.type !== zoneType) {
        if (currentZone) zones.push(currentZone);
        currentZone = { type: zoneType, start_line: i, end_line: i, content: line };
      } else {
        currentZone.end_line = i;
        currentZone.content += "\n" + line;
      }
    }
    if (currentZone) zones.push(currentZone);

    const headerZones = zones.filter(z => z.type === "header" || z.type === "section_title");
    const pageContext = {
      detected_sections: headerZones.map((z: any) => z.content.substring(0, 100)),
      zone_summary: zones.map((z: any) => z.type),
      has_tables: zones.some((z: any) => z.type === "table"),
      has_notes: zones.some((z: any) => z.type === "note"),
    };

    const textResult = { zones, page_context: pageContext, extraction_method: "text_layout" };

    // AI Vision Extraction with table type classification
    const aiPrompt = `Analyze this PDF page text with Document Intelligence.

INSTRUCTIONS:
1. Identify ALL tables/structured data
2. For each table:
   - Classify each column semantically: ${SEMANTIC_TYPES.join(", ")}
   - Classify the table type: ${TABLE_TYPES.join(", ")}
   - Detect if it contains products or just specs/accessories
3. Detect page zones and section hierarchy
4. Identify any image references or product image patterns
5. Detect the language of the content

Page text:
${rawText}`;

    const routeResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        taskType: "pdf_vision_parse",
        workspaceId: workspaceId,
        systemPrompt: "You are a PDF data extraction expert for technical/commercial catalogs. Extract tables with semantic column classification, table type, and confidence scores.",
        messages: [{ role: "user", content: aiPrompt }],
        options: {
          tools: [{
            type: "function",
            function: {
              name: "extract_document_intelligence",
              description: "Extract tables with Document Intelligence including table type classification and image detection",
              parameters: {
                type: "object",
                properties: {
                  zones: { type: "array", items: { type: "object", properties: { type: { type: "string" }, content_summary: { type: "string" } }, required: ["type", "content_summary"] } },
                  tables: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        headers: { type: "array", items: { type: "string" } },
                        column_types: { type: "array", items: { type: "string" } },
                        rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                        confidence: { type: "number" },
                        context: { type: "string" },
                        table_type: { type: "string", enum: [...TABLE_TYPES] },
                      },
                      required: ["headers", "column_types", "rows", "confidence"],
                    },
                  },
                  detected_images: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        image_type: { type: "string", enum: ["product", "lifestyle", "technical", "icon", "logo", "unknown"] },
                        associated_product_hint: { type: "string" },
                      },
                    },
                  },
                  page_context: {
                    type: "object",
                    properties: {
                      supplier_name: { type: "string" },
                      section_title: { type: "string" },
                      category_hint: { type: "string" },
                      notes: { type: "string" },
                      language: { type: "string" },
                    },
                  },
                  summary: { type: "string" },
                },
                required: ["tables", "summary"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "extract_document_intelligence" } },
        },
      }),
    });

    const aiResponse = routeResp;

    let visionResult: any = { tables: [], summary: "", zones: [], page_context: {}, detected_images: [] };

    if (aiResponse.ok) {
      const routeData = await aiResponse.json();
      const aiData = routeData.result;
      const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        try { visionResult = JSON.parse(toolCall.function.arguments); } catch { /* keep default */ }
      }
    } else {
      console.error("AI route error:", aiResponse.status, await aiResponse.text());
    }

    // Match supplier template/profile
    let matchedTemplate: any = null;
    let matchedProfile: any = null;
    const detectedSupplier = visionResult.page_context?.supplier_name;
    if (detectedSupplier) {
      matchedTemplate = templates.find((t: any) => t.supplier_name.toLowerCase() === detectedSupplier.toLowerCase());
      matchedProfile = supplierProfiles.find((p: any) => p.supplier_name.toLowerCase() === detectedSupplier.toLowerCase());
    }

    // Merge column aliases from both template and profile
    const combinedAliases: Record<string, string> = {
      ...(matchedProfile?.column_aliases || {}),
      ...(matchedTemplate?.column_aliases || {}),
    };

    const reconciledZones = (visionResult.zones || []).length > 0 ? visionResult.zones : zones.map((z: any) => ({
      type: z.type, content_summary: z.content.substring(0, 200),
    }));

    const mergedPageContext = {
      ...pageContext,
      ...(visionResult.page_context || {}),
      template_matched: matchedTemplate?.supplier_name || null,
      profile_matched: matchedProfile?.supplier_name || null,
    };

    const bestConfidence = Math.max(
      page.confidence_score || 0,
      ...((visionResult.tables || []).map((t: any) => t.confidence || 0))
    );

    await supabase.from("pdf_pages").update({
      text_result: textResult,
      vision_result: visionResult,
      reconciled_result: { zones: reconciledZones, page_context: mergedPageContext },
      zones: reconciledZones,
      page_context: mergedPageContext,
      layout_zones: zones,
      confidence_score: bestConfidence,
      has_tables: (visionResult.tables || []).length > 0 || zones.some((z: any) => z.type === "table"),
    }).eq("id", pageId);

    // Insert detected images
    if ((visionResult.detected_images || []).length > 0) {
      const imageInserts = visionResult.detected_images.map((img: any) => ({
        page_id: pageId,
        image_type: img.image_type || "unknown",
        confidence: 60,
        bbox: {},
        image_url: null, // actual URL detected in vision phase
      }));
      await supabase.from("pdf_detected_images").insert(imageInserts);
    }

    // Create Reconciled Tables with table_type classification
    for (let ti = 0; ti < (visionResult.tables || []).length; ti++) {
      const vTable = visionResult.tables[ti];
      const tableType = vTable.table_type || "product_table";

      const columnClassifications = (vTable.column_types || []).map((ct: string, ci: number) => ({
        index: ci,
        header: (vTable.headers || [])[ci] || `col_${ci}`,
        semantic_type: ct,
        confidence: vTable.confidence || 70,
        source: "vision",
      }));

      // Apply combined aliases (template + profile)
      for (const col of columnClassifications) {
        const alias = combinedAliases[col.header.toLowerCase()];
        if (alias) {
          col.semantic_type = alias;
          col.confidence = Math.min(100, col.confidence + 15);
          col.source = "template";
        }
      }

      // Build reconciled rows with per-cell confidence and symbol normalization
      const reconciledRows = (vTable.rows || []).map((r: string[], ri: number) => {
        const cells = r.map((value: string, ci: number) => {
          const colType = columnClassifications[ci]?.semantic_type || "unknown";
          const validator = COLUMN_VALIDATION[colType];
          const passesValidation = validator ? validator(value) : true;
          const baseConf = vTable.confidence || 70;
          const cellConfidence = passesValidation ? Math.min(100, baseConf + 10) : Math.max(0, baseConf - 20);

          // Check for technical symbols
          let normalizedValue = value;
          for (const sym of (symbols || [])) {
            if (value.includes(sym.symbol)) {
              normalizedValue = `${value} [${sym.normalized_field}: ${sym.unit}]`;
              break;
            }
          }

          return {
            value,
            normalized_value: normalizedValue !== value ? normalizedValue : undefined,
            confidence: cellConfidence,
            source: "reconciled",
            header: (vTable.headers || [])[ci] || `col_${ci}`,
            semantic_type: colType,
            validation_passed: passesValidation,
            reason: passesValidation ? `${colType} validation passed` : `${colType} validation failed for "${value}"`,
          };
        });
        return { row_index: ri, cells };
      });

      const reconciliationReasons = columnClassifications.map((c: any) => ({
        column: c.header, semantic_type: c.semantic_type, source: c.source,
        reason: c.source === "template" ? `Matched alias for ${c.header}` : `AI classified as ${c.semantic_type} (${c.confidence}%)`,
      }));

      const { data: tableRec } = await supabase.from("pdf_tables").insert({
        page_id: pageId,
        table_index: ti + 100,
        headers: vTable.headers || [],
        rows: reconciledRows,
        confidence_score: vTable.confidence || 70,
        row_count: reconciledRows.length,
        col_count: (vTable.headers || []).length,
        table_type: tableType,
        column_classifications: columnClassifications,
        text_source_data: {},
        vision_source_data: { headers: vTable.headers, rows: vTable.rows, confidence: vTable.confidence },
        reconciled_data: { rows: reconciledRows, context: vTable.context || "" },
        reconciliation_reasons: reconciliationReasons,
        template_id: matchedTemplate?.id || null,
      }).select("id").single();

      if (tableRec) {
        const rowInserts = reconciledRows.map((r: any) => ({
          table_id: tableRec.id,
          row_index: r.row_index,
          cells: r.cells,
          vision_cells: (vTable.rows || [])[r.row_index]?.map((v: string, ci: number) => ({
            value: v, confidence: vTable.confidence || 70, source: "vision",
            header: (vTable.headers || [])[ci] || `col_${ci}`,
          })) || [],
          reconciled_cells: r.cells,
          row_context: { table_context: vTable.context || "", page_context: mergedPageContext, table_type: tableType },
          validation_errors: r.cells.filter((c: any) => !c.validation_passed).map((c: any) => ({ field: c.header, message: c.reason })),
          mapping_confidence: Math.round(r.cells.reduce((s: number, c: any) => s + c.confidence, 0) / Math.max(r.cells.length, 1)),
          status: "unmapped" as const,
        }));
        if (rowInserts.length > 0) {
          await supabase.from("pdf_table_rows").insert(rowInserts);
        }
      }
    }

    // Update extraction
    await supabase.from("pdf_extractions")
      .update({ model_used: "google/gemini-2.5-flash", extraction_method: "hybrid" })
      .eq("id", page.extraction_id);

    return new Response(JSON.stringify({
      success: true,
      tablesFound: (visionResult.tables || []).length,
      zonesDetected: reconciledZones.length,
      templateMatched: matchedTemplate?.supplier_name || null,
      profileMatched: matchedProfile?.supplier_name || null,
      detectedImages: (visionResult.detected_images || []).length,
      summary: visionResult.summary,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("vision-parse-pdf error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
