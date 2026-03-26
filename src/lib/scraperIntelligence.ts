export interface FingerprintIndicator {
  pattern: string;
  type?: "selector" | "text" | "attribute";
  confidence?: number;
}

export interface ProductSignalAnalysis {
  hasReference: boolean;
  hasVariationControls: boolean;
  hasPrice: boolean;
  hasProductSchema: boolean;
}

export interface VariationSummary {
  scanned: number;
  variableCount: number;
  simpleCount: number;
  unknownCount: number;
  referenceCount: number;
  confidence: number;
}

const normalizeToken = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const PRODUCT_FIELD_PATTERNS: Array<{ key: string; regex: RegExp }> = [
  { key: "title", regex: /(^|_)(title|titulo|nome|name|produto|product|designacao)(_|$)/i },
  { key: "description", regex: /(description|descricao|detalhe|details|content|conteudo)/i },
  { key: "short_description", regex: /(short.*description|descricao.*curta|resumo|summary|excerpt)/i },
  { key: "technical_specs", regex: /(technical|spec|especifica|caracteristica|ficha_tecnica)/i },
  { key: "price", regex: /(^|_)(price|preco|valor|pvp|cost|regular_price)(_|$)/i },
  { key: "sale_price", regex: /(sale_price|preco_promocional|old_price|was_price|promo)/i },
  { key: "sku", regex: /(^|_)(sku|ref|referencia|codigo|code|ean|gtin|upc|barcode)(_|$)/i },
  { key: "supplier_ref", regex: /(supplier_ref|ref_fornecedor|fornecedor|supplier)/i },
  { key: "image_urls", regex: /(image|imagem|images|imagens|foto|photo|thumb|gallery|galeria)/i },
  { key: "category", regex: /(category|categoria|cat|family|familia|grupo|group|line|linha|gama)/i },
  { key: "brand", regex: /(brand|marca|fabricante)/i },
  { key: "ean", regex: /(ean|gtin|barcode|upc)/i },
  { key: "product_type", regex: /(product_type|tipo|variation|variacao|variacoes)/i },
  { key: "parent_sku", regex: /(parent_sku|sku_pai|parent)/i },
  { key: "weight", regex: /(weight|peso)/i },
  { key: "modelo", regex: /(model|modelo)/i },
  { key: "meta_title", regex: /(meta_title|seo_title|rank_math_title)/i },
  { key: "meta_description", regex: /(meta_description|seo_description|rank_math_description)/i },
  { key: "focus_keyword", regex: /(focus_keyword|palavra_chave)/i },
  { key: "seo_slug", regex: /(seo_slug|slug|permalink)/i },
];

export function inferProductFieldKey(header: string, sampleValue?: string): string | undefined {
  const normalized = normalizeToken(header);

  if (!normalized || /(^|_)(source_url|url|link)(_|$)/i.test(normalized)) {
    return undefined;
  }

  for (const pattern of PRODUCT_FIELD_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return pattern.key;
    }
  }

  const sample = (sampleValue || "").trim();
  if (sample && /^https?:\/\//i.test(sample) && /(image|img|photo|foto|thumb|gallery|galeria)/i.test(normalized)) {
    return "image_urls";
  }

  return undefined;
}

export function buildAutoProductMapping(
  headers: string[],
  existingMapping: Record<string, string>,
  sampleRow?: Record<string, string>,
): Record<string, string> {
  const safeHeaders = headers.filter(Boolean);
  const next: Record<string, string> = {};

  for (const header of safeHeaders) {
    if (existingMapping[header]) {
      next[header] = existingMapping[header];
    }
  }

  const usedTargets = new Set(Object.values(next));

  for (const header of safeHeaders) {
    if (next[header]) continue;
    const inferred = inferProductFieldKey(header, sampleRow?.[header]);
    if (inferred && !usedTargets.has(inferred)) {
      next[header] = inferred;
      usedTargets.add(inferred);
    }
  }

  return next;
}

export function analyzeHtmlProductSignals(html: string): ProductSignalAnalysis {
  const compact = html.replace(/\s+/g, " ");

  const hasReference = /\b(SKU|REF|Refer[êe]ncia|C[oó]digo|EAN|GTIN|UPC|Art\.?\s*Nr)\b\s*[:.\-#]?\s*[A-Z0-9\-./]{3,}/i.test(compact);
  const hasVariationControls = /(?:name=["'][^"']*attribute[^"']*["']|class=["'][^"']*(variat|swatch|option|selector)[^"']*["'])/i.test(compact);
  const hasPrice = /(?:€|\$|£)\s*[\d.,]+|[\d.,]+\s*(?:€|\$|£)|class=["'][^"']*price[^"']*["']/i.test(compact);
  const hasProductSchema = /schema\.org\/(Product|Offer)/i.test(compact);

  return {
    hasReference,
    hasVariationControls,
    hasPrice,
    hasProductSchema,
  };
}

export function computeFingerprintRatios(
  html: string,
  productIndicators: FingerprintIndicator[] = [],
  nonProductIndicators: FingerprintIndicator[] = [],
): { productRatio: number; nonProductRatio: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  let productScore = 0;
  let productWeight = 0;

  for (const indicator of productIndicators) {
    const weight = indicator.confidence || 0.5;
    productWeight += weight;
    try {
      const matches = indicator.type === "selector"
        ? !!doc.querySelector(indicator.pattern)
        : html.toLowerCase().includes((indicator.pattern || "").toLowerCase());
      if (matches) productScore += weight;
    } catch {
      // ignore invalid selector
    }
  }

  let nonProductScore = 0;
  let nonProductWeight = 0;

  for (const indicator of nonProductIndicators) {
    const weight = indicator.confidence || 0.5;
    nonProductWeight += weight;
    try {
      const matches = indicator.type === "selector"
        ? !!doc.querySelector(indicator.pattern)
        : html.toLowerCase().includes((indicator.pattern || "").toLowerCase());
      if (matches) nonProductScore += weight;
    } catch {
      // ignore invalid selector
    }
  }

  return {
    productRatio: productWeight > 0 ? productScore / productWeight : 0,
    nonProductRatio: nonProductWeight > 0 ? nonProductScore / nonProductWeight : 0,
  };
}

const hasVariationValue = (value: string) => {
  const normalized = (value || "").trim();
  if (!normalized) return false;
  return /\|/.test(normalized)
    || /(?:\b(?:size|cor|color|voltagem|tens[aã]o|capacidade|peso)\b.*?:)/i.test(normalized)
    || /(?:\b(?:\d+\s?(?:ml|l|kg|g|cm|mm|w|v))\b.*\|)/i.test(normalized);
};

export function summarizeVariationStructure(
  rows: Record<string, string>[],
  variationHintHeaders: string[] = [],
): VariationSummary {
  const scanned = rows.length;
  if (!scanned) {
    return {
      scanned: 0,
      variableCount: 0,
      simpleCount: 0,
      unknownCount: 0,
      referenceCount: 0,
      confidence: 0,
    };
  }

  let variableCount = 0;
  let simpleCount = 0;
  let unknownCount = 0;
  let referenceCount = 0;

  const hintSet = new Set(variationHintHeaders.map(h => h.toLowerCase()));

  for (const row of rows) {
    const entries = Object.entries(row || {});

    const explicitType = String(row.product_type || row.tipo || "").toLowerCase();
    const forceVariable = /variable|variation|variavel|variacao/.test(explicitType);
    const forceSimple = /simple|simples/.test(explicitType);

    const hasReference = entries.some(([key, value]) => {
      const k = key.toLowerCase();
      const v = String(value || "");
      if (/(sku|ref|referencia|codigo|ean|gtin|upc)/i.test(k) && v.trim().length >= 3) return true;
      return /\b(SKU|REF|Refer[êe]ncia|EAN|GTIN|UPC)\b\s*[:.\-#]?\s*[A-Z0-9\-./]{3,}/i.test(v);
    });

    if (hasReference) referenceCount++;

    const variationByHints = entries.some(([key, value]) => hintSet.has(key.toLowerCase()) && hasVariationValue(String(value || "")));

    const variationByName = entries.some(([key, value]) =>
      /(variac|variation|attribute|atributo|opcao|opção|cor|tamanho|size)/i.test(key)
      && hasVariationValue(String(value || ""))
    );

    const looksVariable = forceVariable || variationByHints || variationByName;

    if (looksVariable) {
      variableCount++;
    } else if (forceSimple || hasReference) {
      simpleCount++;
    } else {
      unknownCount++;
    }
  }

  const confidence = (variableCount + simpleCount) / scanned;

  return {
    scanned,
    variableCount,
    simpleCount,
    unknownCount,
    referenceCount,
    confidence,
  };
}
