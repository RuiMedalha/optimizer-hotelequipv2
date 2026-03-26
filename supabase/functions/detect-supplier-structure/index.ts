import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KNOWN_SKU_PATTERNS = ["sku", "ref", "reference", "código", "codigo", "cod", "art", "artigo", "item", "partnumber", "part_number"];
const KNOWN_PRICE_PATTERNS = ["price", "preço", "preco", "pvp", "cost", "custo", "valor", "price_ht", "prix"];
const KNOWN_NAME_PATTERNS = ["name", "title", "nome", "produto", "product", "designation", "description", "descricao", "descrição"];
const KNOWN_EAN_PATTERNS = ["ean", "barcode", "gtin", "upc", "ean13"];
const KNOWN_IMAGE_PATTERNS = ["image", "imagem", "img", "photo", "foto", "picture", "url_image", "image_url"];

function detectColumn(columns: string[], patterns: string[]): string | null {
  for (const col of columns) {
    const lower = col.toLowerCase().replace(/[_\-\s]/g, "");
    for (const p of patterns) {
      if (lower === p || lower.includes(p)) return col;
    }
  }
  return null;
}

function detectAttributeColumns(columns: string[], reserved: string[]): string[] {
  const reservedSet = new Set(reserved.filter(Boolean).map(c => c.toLowerCase()));
  return columns.filter(c => !reservedSet.has(c.toLowerCase()));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, columns, file_type, source_file_id } = await req.json();

    if (!supplier_id || !columns?.length) {
      return new Response(JSON.stringify({ error: "supplier_id and columns required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const skuCol = detectColumn(columns, KNOWN_SKU_PATTERNS);
    const priceCol = detectColumn(columns, KNOWN_PRICE_PATTERNS);
    const nameCol = detectColumn(columns, KNOWN_NAME_PATTERNS);
    const eanCol = detectColumn(columns, KNOWN_EAN_PATTERNS);
    const imageCol = detectColumn(columns, KNOWN_IMAGE_PATTERNS);

    const reserved = [skuCol, priceCol, nameCol, eanCol, imageCol];
    const attrCols = detectAttributeColumns(columns, reserved as string[]);

    const confidence = [skuCol, priceCol, nameCol].filter(Boolean).length / 3;

    const { data, error } = await supabase.from("supplier_schema_profiles").insert({
      supplier_id,
      source_file_id: source_file_id || null,
      file_type: file_type || "excel",
      detected_columns: columns,
      sku_column: skuCol,
      price_column: priceCol,
      name_column: nameCol,
      ean_column: eanCol,
      image_column: imageCol,
      attribute_columns: attrCols,
      detection_confidence: confidence,
    }).select().single();

    if (error) throw error;

    // Also generate mapping suggestions
    const suggestions = [];
    if (skuCol) suggestions.push({ supplier_id, source_column: skuCol, suggested_field: "sku", confidence: 0.95 });
    if (priceCol) suggestions.push({ supplier_id, source_column: priceCol, suggested_field: "price", confidence: 0.9 });
    if (nameCol) suggestions.push({ supplier_id, source_column: nameCol, suggested_field: "title", confidence: 0.85 });
    if (eanCol) suggestions.push({ supplier_id, source_column: eanCol, suggested_field: "ean", confidence: 0.9 });
    if (imageCol) suggestions.push({ supplier_id, source_column: imageCol, suggested_field: "image_url", confidence: 0.85 });
    for (const attr of attrCols.slice(0, 10)) {
      suggestions.push({ supplier_id, source_column: attr, suggested_field: "attribute", confidence: 0.5 });
    }

    if (suggestions.length) {
      await supabase.from("supplier_mapping_suggestions").insert(suggestions);
    }

    return new Response(JSON.stringify({ schema_profile: data, mapping_suggestions: suggestions }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
