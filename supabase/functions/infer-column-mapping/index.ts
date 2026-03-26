import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  sku: [/^sku$/i, /^ref/i, /^code/i, /^codigo/i, /^référence/i, /^reference/i, /^art/i, /^item/i],
  supplier_ref: [/supplier.*ref/i, /ref.*forn/i, /ref.*supplier/i, /codart/i],
  original_title: [/^name$/i, /^title/i, /^nom/i, /^nome/i, /^titulo/i, /^designation/i, /^product.*name/i, /^libelle/i],
  original_description: [/^desc/i, /^description/i, /^descri/i],
  short_description: [/short.*desc/i, /desc.*curta/i, /desc.*court/i],
  original_price: [/^price/i, /^prix/i, /^preço/i, /^preco/i, /^pvp/i, /^precio/i, /price.*ht/i, /tarif/i],
  sale_price: [/sale.*price/i, /promo/i, /discount/i, /prix.*promo/i],
  category: [/^categ/i, /^famille/i, /^familia/i, /^family/i, /^group/i, /^grupo/i],
  image_urls: [/^image/i, /^img/i, /^foto/i, /^photo/i, /^picture/i, /^url.*img/i],
  tags: [/^tag/i, /^keyword/i, /^mot.*cl/i],
  product_type: [/^type/i, /^tipo/i],
  technical_specs: [/^spec/i, /^technical/i, /^caract/i],
  attributes: [/^attr/i, /^propriet/i, /^feature/i],
};

const EAN_REGEX = /^\d{8,14}$/;
const PRICE_REGEX = /^\d+([.,]\d{1,4})?$/;
const URL_REGEX = /^https?:\/\//i;

function inferColumnType(values: string[]): string {
  const sample = values.filter(Boolean).slice(0, 30);
  if (sample.length === 0) return "unknown";
  
  const eanCount = sample.filter(v => EAN_REGEX.test(v.trim())).length;
  if (eanCount > sample.length * 0.7) return "ean";
  
  const priceCount = sample.filter(v => PRICE_REGEX.test(v.replace(/[€$£\s]/g, "").trim())).length;
  if (priceCount > sample.length * 0.7) return "price";
  
  const urlCount = sample.filter(v => URL_REGEX.test(v.trim())).length;
  if (urlCount > sample.length * 0.5) return "url";
  
  const avgLen = sample.reduce((s, v) => s + v.length, 0) / sample.length;
  if (avgLen > 100) return "long_text";
  if (avgLen > 30) return "medium_text";
  
  return "short_text";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, supplier_id, detection_id, headers, sample_data, file_name } = await req.json();
    if (!workspace_id || !headers) throw new Error("workspace_id and headers required");

    const mapping: Record<string, { field: string; confidence: number; method: string }> = {};
    const warnings: string[] = [];

    // 1. Check supplier memory (previous overrides)
    let memoryMappings: Record<string, string> = {};
    if (supplier_id) {
      const { data: overrides } = await supabase
        .from("supplier_overrides")
        .select("override_key, override_value")
        .eq("supplier_id", supplier_id)
        .eq("override_type", "column_mapping");
      if (overrides) {
        for (const o of overrides) {
          memoryMappings[o.override_key] = (o.override_value as any)?.field || "";
        }
      }
    }

    // 2. Pattern matching on header names
    for (const header of headers) {
      // Check memory first
      if (memoryMappings[header]) {
        mapping[header] = { field: memoryMappings[header], confidence: 0.95, method: "supplier_memory" };
        continue;
      }

      let bestMatch = "";
      let bestConf = 0;

      for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
        for (const p of patterns) {
          if (p.test(header)) {
            const conf = header.toLowerCase() === field ? 0.95 : 0.8;
            if (conf > bestConf) { bestMatch = field; bestConf = conf; }
          }
        }
      }

      if (bestMatch) {
        mapping[header] = { field: bestMatch, confidence: bestConf, method: "header_pattern" };
      }
    }

    // 3. Content-based inference for unmapped columns
    if (sample_data && Array.isArray(sample_data)) {
      for (const header of headers) {
        if (mapping[header]) continue;

        const values = sample_data.map((r: any) => String(r[header] || "")).filter(Boolean);
        const colType = inferColumnType(values);

        if (colType === "ean" && !Object.values(mapping).some(m => m.field === "ean")) {
          mapping[header] = { field: "ean", confidence: 0.85, method: "content_analysis" };
        } else if (colType === "price" && !Object.values(mapping).some(m => m.field === "original_price")) {
          mapping[header] = { field: "original_price", confidence: 0.7, method: "content_analysis" };
        } else if (colType === "url" && !Object.values(mapping).some(m => m.field === "image_urls")) {
          mapping[header] = { field: "image_urls", confidence: 0.75, method: "content_analysis" };
        } else if (colType === "long_text" && !Object.values(mapping).some(m => m.field === "original_description")) {
          mapping[header] = { field: "original_description", confidence: 0.6, method: "content_analysis" };
        }
      }
    }

    // 4. Detect parent/child columns
    for (const header of headers) {
      if (mapping[header]) continue;
      if (/parent|pai|variante|variation|option|taille|size|color|cor|couleur|comprimento|length/i.test(header)) {
        mapping[header] = { field: "attributes", confidence: 0.6, method: "variation_hint" };
        warnings.push(`Coluna "${header}" parece ser um atributo de variação`);
      }
    }

    // Warnings for missing critical fields
    const mappedFields = Object.values(mapping).map(m => m.field);
    if (!mappedFields.includes("sku") && !mappedFields.includes("supplier_ref")) {
      warnings.push("Nenhuma coluna de SKU/referência detetada");
    }
    if (!mappedFields.includes("original_title")) {
      warnings.push("Nenhuma coluna de nome de produto detetada");
    }

    const avgConfidence = Object.values(mapping).length > 0
      ? Object.values(mapping).reduce((s, m) => s + m.confidence, 0) / Object.values(mapping).length
      : 0;

    // Save inference
    const simplifiedMapping: Record<string, string> = {};
    for (const [h, m] of Object.entries(mapping)) {
      simplifiedMapping[h] = m.field;
    }

    const { data: inference, error } = await supabase
      .from("supplier_column_inferences")
      .insert({
        workspace_id,
        supplier_id: supplier_id || null,
        detection_id: detection_id || null,
        file_name,
        headers,
        inferred_mapping: mapping,
        mapping_confidence: avgConfidence,
        mapping_warnings: warnings,
        sample_data: (sample_data || []).slice(0, 5),
        status: "inferred",
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({
      success: true,
      inference,
      mapping: simplifiedMapping,
      detailed_mapping: mapping,
      warnings,
      confidence: avgConfidence,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
