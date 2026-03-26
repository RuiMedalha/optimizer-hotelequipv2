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

    const { extractionId, mode, provider } = await req.json();
    if (!extractionId) throw new Error("extractionId required");

    // Reset extraction status
    await supabase.from("pdf_extractions").update({
      status: "extracting",
      provider_used: null,
      provider_model: null,
      fallback_used: false,
      fallback_provider: null,
    }).eq("id", extractionId);

    // Clear existing vision results from pages (keep raw_text)
    const { data: pages } = await supabase
      .from("pdf_pages")
      .select("id")
      .eq("extraction_id", extractionId);

    if (pages) {
      for (const page of pages) {
        await supabase.from("pdf_pages").update({
          vision_result: null,
          reconciled_result: null,
          confidence_score: 0,
        }).eq("id", page.id);
      }
    }

    // Re-trigger the document intelligence pipeline
    const reprocessUrl = `${supabaseUrl}/functions/v1/run-document-intelligence`;
    const resp = await fetch(reprocessUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ extractionId, mode: mode || "auto", manualProvider: provider }),
    });

    const result = await resp.json();

    // Update status
    await supabase.from("pdf_extractions").update({
      status: "reviewing",
      extraction_mode: mode || "auto",
    }).eq("id", extractionId);

    return new Response(JSON.stringify({
      success: true,
      reprocessed: true,
      ...result,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("reprocess-pdf-extraction error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
