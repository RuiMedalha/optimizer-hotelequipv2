import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { extractionId, pageId, mode, manualProvider } = await req.json();
    if (!extractionId && !pageId) throw new Error("extractionId or pageId required");

    // Determine workspace
    let workspaceId: string;
    let targetPageIds: string[] = [];

    if (pageId) {
      const { data: page } = await supabase
        .from("pdf_pages")
        .select("id, extraction_id, pdf_extractions:extraction_id(workspace_id)")
        .eq("id", pageId)
        .single();
      if (!page) throw new Error("Page not found");
      workspaceId = (page as any).pdf_extractions?.workspace_id;
      targetPageIds = [pageId];
    } else {
      const { data: ext } = await supabase
        .from("pdf_extractions")
        .select("workspace_id")
        .eq("id", extractionId)
        .single();
      if (!ext) throw new Error("Extraction not found");
      workspaceId = ext.workspace_id;
      const { data: pages } = await supabase
        .from("pdf_pages")
        .select("id")
        .eq("extraction_id", extractionId);
      targetPageIds = (pages || []).map((p: any) => p.id);
    }

    let totalProcessed = 0;
    let usedProvider = "Lovable AI Gateway";
    let usedModel = "google/gemini-2.5-flash";
    let fallbackUsed = false;
    let fallbackProvider: string | null = null;

    // Process each page via resolve-ai-route
    for (const pid of targetPageIds) {
      const { data: page } = await supabase.from("pdf_pages").select("raw_text").eq("id", pid).single();
      if (!page?.raw_text) continue;

      const aiPrompt = `Analyze this PDF page text. Extract ALL tables with semantic column classification (sku, title, price, description, dimensions, capacity, material, weight, unknown). Classify table type (product_table, technical_specs, pricing_table, accessories). Detect zones, sections, language and supplier.

Text:
${(page.raw_text || "").substring(0, 12000)}`;

      try {
        const routeResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            taskType: "pdf_vision_parse",
            workspaceId,
            systemPrompt: "You are a PDF data extraction expert. Extract tables with semantic column classification and confidence scores. Return JSON.",
            messages: [{ role: "user", content: aiPrompt }],
            options: {
              response_format: { type: "json_object" },
            },
          }),
        });

        if (routeResp.ok) {
          const wrapper = await routeResp.json();
          const aiData = wrapper.result || wrapper;
          const content = aiData.choices?.[0]?.message?.content || "{}";
          let result: any = {};
          try { result = JSON.parse(content); } catch { /* keep empty */ }

          // Update meta from route
          if (wrapper.meta) {
            usedProvider = wrapper.meta.usedProvider || usedProvider;
            usedModel = wrapper.meta.usedModel || usedModel;
            if (wrapper.meta.fallbackUsed) {
              fallbackUsed = true;
              fallbackProvider = wrapper.meta.usedProvider;
            }
          }

          await supabase.from("pdf_pages").update({
            vision_result: result,
            page_context: { ...result.page_context, provider: usedProvider, model: usedModel },
            confidence_score: result.confidence || 70,
          }).eq("id", pid);
          totalProcessed++;
        } else {
          console.warn(`Route failed for page ${pid}: ${routeResp.status}`);
        }
      } catch (e: unknown) {
        console.warn(`Error processing page ${pid}:`, e);
      }
    }

    // Update extraction metadata
    const updateData: any = {
      provider_used: usedProvider,
      provider_model: usedModel,
      extraction_mode: mode || "auto",
      fallback_used: fallbackUsed,
      fallback_provider: fallbackProvider,
    };

    if (extractionId) {
      await supabase.from("pdf_extractions").update(updateData).eq("id", extractionId);
    } else if (targetPageIds.length > 0) {
      const { data: pg } = await supabase.from("pdf_pages").select("extraction_id").eq("id", targetPageIds[0]).single();
      if (pg) await supabase.from("pdf_extractions").update(updateData).eq("id", pg.extraction_id);
    }

    return new Response(JSON.stringify({
      success: true,
      pagesProcessed: totalProcessed,
      provider: usedProvider,
      model: usedModel,
      mode: mode || "auto",
      fallbackUsed,
      fallbackProvider,
      processingTimeMs: Date.now() - startTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("run-document-intelligence error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
