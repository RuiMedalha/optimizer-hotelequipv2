import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const templates: Record<string, any> = {
  pdf_plus_excel: {
    playbook_type: "pdf_plus_excel",
    description: "Fornecedor que envia Excel de preços + PDFs técnicos",
    playbook_config: {
      sources: ["excel", "pdf"],
      lookup_strategy: "sku_then_ref",
      taxonomy_mapping: "manual",
      publish_rules: { require_specs: true, require_images: true },
    },
  },
  website_plus_excel: {
    playbook_type: "website_plus_excel",
    description: "Fornecedor com catálogo web + Excel de preços",
    playbook_config: {
      sources: ["excel", "scraping"],
      lookup_strategy: "sku_then_scrape",
      taxonomy_mapping: "auto_suggest",
      publish_rules: { require_specs: true, require_images: true },
    },
  },
  excel_only: {
    playbook_type: "excel_only",
    description: "Fornecedor que só envia Excel completo",
    playbook_config: {
      sources: ["excel"],
      lookup_strategy: "sku_only",
      taxonomy_mapping: "manual",
      publish_rules: { require_specs: false, require_images: false },
    },
  },
  xml_feed: {
    playbook_type: "xml_feed",
    description: "Fornecedor com feed XML automático",
    playbook_config: {
      sources: ["xml_feed"],
      lookup_strategy: "sku_then_ean",
      taxonomy_mapping: "auto",
      publish_rules: { require_specs: true, require_images: true },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { file_types } = await req.json();
    const types = (file_types || []) as string[];

    let suggested = "excel_only";
    if (types.includes("pdf") && types.includes("excel")) suggested = "pdf_plus_excel";
    else if (types.includes("website") && types.includes("excel")) suggested = "website_plus_excel";
    else if (types.includes("xml")) suggested = "xml_feed";

    return new Response(JSON.stringify({
      success: true,
      suggested_template: suggested,
      template: templates[suggested],
      all_templates: Object.keys(templates),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
