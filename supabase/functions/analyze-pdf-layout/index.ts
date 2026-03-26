import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { extractionId } = await req.json();
    if (!extractionId) throw new Error("extractionId required");

    // Get extraction with layout_analysis already populated by extract-pdf-pages
    const { data: extraction } = await supabase
      .from("pdf_extractions")
      .select("*, uploaded_files:file_id(file_name)")
      .eq("id", extractionId)
      .single();
    if (!extraction) throw new Error("Extraction not found");

    const workspaceId = extraction.workspace_id;

    // Get pages with their extracted data
    const { data: pages } = await supabase
      .from("pdf_pages")
      .select("id, page_number, raw_text, has_tables, has_images, zones, page_context, confidence_score, vision_result")
      .eq("extraction_id", extractionId)
      .order("page_number");

    if (!pages?.length) {
      const fallbackAnalysis = {
        layout_complexity: "simple",
        text_quality: "medium",
        has_complex_tables: false,
        needs_ocr: false,
        recommended_engine: "lovable_gateway",
        engine_confidence: 50,
        estimated_accuracy: 50,
        estimated_cost_usd: 0,
        detected_products_estimate: 0,
        document_language: extraction.layout_analysis?.language || "unknown",
        supplier_hint: extraction.layout_analysis?.supplier_name || null,
        document_type: extraction.layout_analysis?.document_type || "product_catalog",
        totalPages: extraction.total_pages || 0,
        pagesWithProducts: 0,
        avgConfidence: 0,
      };

      const fallbackRecommendation = {
        recommended: "lovable_gateway",
        confidence: 50,
        estimated_accuracy: 50,
        estimated_cost_usd: 0,
        alternatives: [
          { engine: "lovable_gateway", label: "Lovable AI Gateway", pros: "Sem configuração extra, visão AI nativa", cost: "Incluído" },
        ],
      };

      await supabase.from("pdf_extractions").update({
        layout_analysis: { ...(extraction.layout_analysis || {}), ...fallbackAnalysis },
        engine_recommendation: fallbackRecommendation,
      }).eq("id", extractionId);

      return new Response(JSON.stringify({
        success: true,
        analysis: fallbackAnalysis,
        engineRecommendation: fallbackRecommendation,
        totalPages: extraction.total_pages || 0,
        pagesWithProducts: 0,
        totalProducts: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const totalPages = pages.length;
    const pagesWithProducts = pages.filter((p: any) => p.page_context?.product_count > 0).length;
    const totalProducts = pages.reduce((s: number, p: any) => s + (p.page_context?.product_count || 0), 0);
    const avgConfidence = Math.round(pages.reduce((s: number, p: any) => s + (p.confidence_score || 0), 0) / totalPages);

    // Use existing layout_analysis from extraction (populated during extract-pdf-pages)
    const existingAnalysis = extraction.layout_analysis || {};

    const analysis = {
      layout_complexity: totalProducts > 100 ? "complex" : totalProducts > 20 ? "moderate" : "simple",
      text_quality: avgConfidence > 75 ? "high" : avgConfidence > 50 ? "medium" : "low",
      has_complex_tables: pagesWithProducts > 10,
      needs_ocr: false, // AI vision handles this
      recommended_engine: "lovable_gateway",
      engine_confidence: avgConfidence,
      estimated_accuracy: avgConfidence,
      estimated_cost_usd: totalPages * 0.005,
      detected_products_estimate: totalProducts,
      document_language: existingAnalysis.language || "unknown",
      supplier_hint: existingAnalysis.supplier_name || null,
      document_type: existingAnalysis.document_type || "product_catalog",
      totalPages,
      pagesWithProducts,
      avgConfidence,
    };

    const engineRecommendation = {
      recommended: "lovable_gateway",
      confidence: avgConfidence,
      estimated_accuracy: avgConfidence,
      estimated_cost_usd: totalPages * 0.005,
      alternatives: [
        { engine: "lovable_gateway", label: "Lovable AI Gateway", pros: "Sem configuração extra, visão AI nativa", cost: "Incluído" },
      ],
    };

    await supabase.from("pdf_extractions").update({
      layout_analysis: analysis,
      engine_recommendation: engineRecommendation,
    }).eq("id", extractionId);

    return new Response(JSON.stringify({
      success: true,
      analysis,
      engineRecommendation,
      totalPages,
      pagesWithProducts,
      totalProducts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("analyze-pdf-layout error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
