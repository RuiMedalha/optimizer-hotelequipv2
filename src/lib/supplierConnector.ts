// ============================================================
// TYPES
// ============================================================

export type XmlFormat = 'tefcold' | 'google_merchant' | 'unknown';
export type FileFormat = 'xml' | 'csv' | 'excel';
export type OperationMode = 'supplier_delta' | 'price_update_only';

export interface ConnectorConfig {
  file_format: FileFormat;
  xml_format?: XmlFormat | null;
  sku_prefix?: string;
  sku_suffix?: string;
  sku_normalization?: 'strip_leading_zeros' | null;
  default_brand?: string;
  operation_mode?: OperationMode;
  match_strategy?: string[];
  column_mapping?: Record<string, string>;
  image_columns?: string[];
  ignore_fields?: string[];
  transformations_needed?: string[];
}

export interface ParsedSupplierData {
  rows: Record<string, any>[];
  headers: string[];
  format: FileFormat;
  xmlFormat?: XmlFormat;
  totalRows: number;
}

// ============================================================
// XML FORMAT AUTO-DETECTION
// ============================================================

export function detectXmlFormat(xmlText: string): XmlFormat {
  if (xmlText.includes('<SHOP>') || xmlText.includes('<SHOPITEM>')) return 'tefcold';
  if (xmlText.includes('base.google.com') || 
     (xmlText.includes('<rss') && xmlText.includes('g:id'))) return 'google_merchant';
  return 'unknown';
}

// ============================================================
// XML PARSERS
// ============================================================

export function parseTefcoldXml(xml: string): Record<string, any>[] {
  const items: Record<string, any>[] = [];
  const itemMatches = xml.matchAll(/<SHOPITEM>([\s\S]*?)<\/SHOPITEM>/g);
  
  for (const match of itemMatches) {
    const itemXml = match[1];
    const item: Record<string, any> = { _format: 'tefcold' };
    
    // Parse flat fields (uppercase tags only)
    const fieldMatches = itemXml.matchAll(/<([A-Z_0-9]+)>([\s\S]*?)<\/\1>/g);
    for (const f of fieldMatches) {
      if (f[1] !== 'PARAMETERS') {
        item[f[1]] = f[2].trim();
      }
    }
    
    // Parse PARAMETERS → _params array
    const params: any[] = [];
    const paramMatches = itemXml.matchAll(/<parameter>([\s\S]*?)<\/parameter>/g);
    for (const p of paramMatches) {
      const px = p[1];
      const getTag = (tag: string) => 
        px.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() || '';
      const val = getTag('ParamValue');
      if (val && val !== '-') {
        params.push({
          name: getTag('ParamName'),
          value: val,
          unit: getTag('ParamUnit'),
          id: getTag('ParamUniqueId')
        });
      }
    }
    item._params = params;
    items.push(item);
  }
  return items;
}

export function parseGoogleMerchantXml(xml: string): Record<string, any>[] {
  const items: Record<string, any>[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  
  for (const match of itemMatches) {
    const itemXml = match[1];
    const item: Record<string, any> = { _format: 'google_merchant' };
    
    // Match g: prefixed tags
    const gFieldMatches = itemXml.matchAll(/<g:([a-z_0-9]+)(?:\s[^>]*)?>([\s\S]*?)<\/g:[a-z_0-9]+>/g);
    for (const f of gFieldMatches) {
      item[`g:${f[1]}`] = f[2].trim();
    }
    
    // Match plain tags (title, description, link)
    const plainMatches = itemXml.matchAll(/<(?!g:)([a-z_]+)>([\s\S]*?)<\/[a-z_]+>/g);
    for (const f of plainMatches) {
      if (!item[f[1]]) item[f[1]] = f[2].trim();
    }
    
    // Dimensions → _params for consistent processing
    const dims: any[] = [];
    const dimMap: Record<string, string> = {
      'g:product_length': 'Comprimento',
      'g:product_width': 'Largura', 
      'g:product_height': 'Altura',
      'g:product_weight': 'Peso'
    };
    for (const [key, label] of Object.entries(dimMap)) {
      if (item[key]) {
        dims.push({ name: label, value: item[key], unit: '', id: key.replace('g:product_', '') });
      }
    }
    item._params = dims;
    items.push(item);
  }
  return items;
}

export function parseXml(xmlText: string): ParsedSupplierData {
  const fmt = detectXmlFormat(xmlText);
  let rows: Record<string, any>[] = [];
  
  if (fmt === 'tefcold') {
    rows = parseTefcoldXml(xmlText);
  } else if (fmt === 'google_merchant') {
    rows = parseGoogleMerchantXml(xmlText);
  } else {
    throw new Error(`Formato XML não reconhecido. Formatos suportados: Tefcold (<SHOP>), Google Merchant (xmlns:g).`);
  }
  
  const headers = rows.length > 0 
    ? Object.keys(rows[0]).filter(k => !k.startsWith('_'))
    : [];
    
  return { rows, headers, format: 'xml', xmlFormat: fmt, totalRows: rows.length };
}

// ============================================================
// TRANSFORMATION ENGINE
// ============================================================

const TEFCOLD_PRIORITY_PARAMS = [
  'ExternalDimension', 'InternalDimension', 'PackedDimension',
  'GrossNetWeight', 'TemperatureRange', 'VoltageFreq',
  'EnergyConsumption', 'InputPower', 'Refrigerant',
  'EnergyArrowText', 'NoiseLevel'
];

const GOOGLE_MERCHANT_PRIORITY_PARAMS = [
  'product_length', 'product_width', 'product_height', 'product_weight'
];

function parsePriceCommaDecimal(val: string): number | null {
  // Handles "1.000,00" (dot=thousands, comma=decimal) and "510,00"
  const cleaned = String(val).replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

function parsePriceStripCurrency(val: string): number | null {
  // Handles "34.00 EUR", "1,234.56 USD"
  const cleaned = String(val).replace(/[A-Z€$£\s]/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

function parseStock(val: string, format: string): number {
  if (format === 'google_merchant') {
    return val === 'in stock' ? 1 : 0;
  }
  return parseInt(String(val)) === 1 ? 1 : 0;
}

function applySku(sku: string, config: ConnectorConfig): string {
  let result = String(sku).trim();
  
  if (config.sku_normalization === 'strip_leading_zeros' && /^\d+$/.test(result)) {
    result = result.replace(/^0+/, '') || '0';
  }
  
  const prefix = config.sku_prefix || '';
  const suffix = config.sku_suffix || '';
  
  if (prefix && !result.startsWith(prefix)) result = prefix + result;
  if (suffix && !result.endsWith(suffix)) result = result + suffix;
  
  return result;
}

function buildAttributesFromParams(
  params: any[],
  priorityIds: string[]
): { attributes: Record<string, any>; technical_specs: string } {
  const attributes: Record<string, any> = {};
  const specParts: string[] = [];
  
  for (const p of params) {
    if (p.value && p.value !== '-') {
      attributes[p.name] = { value: p.value, unit: p.unit || '' };
      if (priorityIds.includes(p.id)) {
        specParts.push(`${p.name}: ${p.value}${p.unit ? ' ' + p.unit : ''}`);
      }
    }
  }
  
  return { attributes, technical_specs: specParts.join(' | ') };
}

function buildAttributesFromTriplets(
  row: Record<string, any>,
  priorityIds: string[]
): { attributes: Record<string, any>; technical_specs: string } {
  const attributes: Record<string, any> = {};
  const specParts: string[] = [];
  
  for (const key of Object.keys(row)) {
    if (key.endsWith('-parameter-ParamValue')) {
      const id = key.replace('-parameter-ParamValue', '');
      const name = String(row[`${id}-parameter-ParamName`] || id).trim();
      const unit = String(row[`${id}-parameter-ParamUnit`] || '').trim();
      const val = String(row[key] || '').trim();
      
      if (val && val !== '-') {
        attributes[name] = { value: val, unit };
        if (priorityIds.includes(id)) {
          specParts.push(`${name}: ${val}${unit ? ' ' + unit : ''}`);
        }
      }
    }
  }
  
  return { attributes, technical_specs: specParts.join(' | ') };
}

function applyToRow(
  row: Record<string, any>,
  config: ConnectorConfig,
  fileFormat: FileFormat
): Record<string, any> {
  const result: Record<string, any> = {};
  const ignore = new Set(config.ignore_fields || []);
  const rowFormat = row._format || fileFormat;
  
  // 1. Column mapping
  for (const [src, dst] of Object.entries(config.column_mapping || {})) {
    if (!ignore.has(src) && row[src] !== undefined && row[src] !== '') {
      if (dst.includes('.')) {
        // Nested: e.g. "attributes.pvp_recomendado"
        const [parent, child] = dst.split('.');
        if (!result[parent]) result[parent] = {};
        result[parent][child] = row[src];
      } else {
        result[dst] = row[src];
      }
    }
  }
  
  // 2. Apply SKU prefix/suffix
  if (result.sku) {
    result.sku = applySku(String(result.sku), config);
  }
  
  // 3. Price parsing
  if (result.original_price) {
    const raw = String(result.original_price);
    if (rowFormat === 'google_merchant') {
      result.original_price = parsePriceStripCurrency(raw);
    } else {
      result.original_price = parsePriceCommaDecimal(raw);
    }
    if (!result.original_price) delete result.original_price;
  }
  
  // 4. Stock parsing
  if (result.stock !== undefined) {
    result.stock = parseStock(String(result.stock), rowFormat);
  }
  
  // 5. Images — Tefcold XML/CSV
  if (rowFormat === 'tefcold' || (fileFormat === 'csv' && !rowFormat)) {
    const imgCols = ['IMGURL1', 'IMGURL2', 'IMGURL3', 'IMGURL5', 'IMGURL6'];
    const images = imgCols
      .map(c => row[c])
      .filter(v => v && v !== '-' && String(v).trim() !== '');
    if (images.length > 0) result.image_urls = images;
  }
  
  // 5b. Images — Google Merchant
  if (rowFormat === 'google_merchant' && config.image_columns) {
    const images = config.image_columns
      .map(c => row[c])
      .filter(v => v && v !== '-' && String(v).trim() !== '');
    if (images.length > 0) result.image_urls = images;
  }
  
  // 6. Parameters → attributes + technical_specs
  if (row._params && row._params.length > 0) {
    const priorityIds = rowFormat === 'google_merchant' 
      ? GOOGLE_MERCHANT_PRIORITY_PARAMS 
      : TEFCOLD_PRIORITY_PARAMS;
    const { attributes, technical_specs } = buildAttributesFromParams(row._params, priorityIds);
    if (Object.keys(attributes).length > 0) {
      result.attributes = { ...(result.attributes || {}), ...attributes };
    }
    if (technical_specs) result.technical_specs = technical_specs;
  }
  
  // 6b. CSV triplet collapse
  if (fileFormat === 'csv') {
    const { attributes, technical_specs } = buildAttributesFromTriplets(row, TEFCOLD_PRIORITY_PARAMS);
    if (Object.keys(attributes).length > 0) {
      result.attributes = { ...(result.attributes || {}), ...attributes };
    }
    if (technical_specs && !result.technical_specs) result.technical_specs = technical_specs;
  }
  
  // 7. DESCRIPTION2 bullets → HTML
  if (row.DESCRIPTION2) {
    const bullets = String(row.DESCRIPTION2).split('|').map(s => s.trim()).filter(Boolean);
    if (bullets.length > 0) {
      const html = '<ul>' + bullets.map(b => `<li>${b}</li>`).join('') + '</ul>';
      result.original_description = (result.original_description || '') + '\n' + html;
    }
  }
  
  // 8. Google Merchant category "/" → ">"
  if (result.category) {
    result.category = String(result.category).replace(/\s*\/\s*/g, ' > ');
  }
  
  // 9. Default brand if not mapped
  if (!result.brand && config.default_brand) {
    result.brand = config.default_brand;
  }
  
  // Combine PRODUCTNAME + PRODUCT as title if original_title not set
  if (!result.original_title && (row.PRODUCTNAME || row['g:title'])) {
    result.original_title = row.PRODUCTNAME || row['g:title'];
  }

  // Ensure model is set from PRODUCTNAME
  if (!result.model && row.PRODUCTNAME) {
    result.model = row.PRODUCTNAME;
  }
  
  return result;
}

export function applyConnectorTransformations(
  rows: Record<string, any>[],
  config: ConnectorConfig,
  fileFormat: FileFormat
): Record<string, any>[] {
  return rows.map(row => applyToRow(row, config, fileFormat));
}

// ============================================================
// SPECIAL FIELDS DETECTION
// ============================================================

export function detectSpecialFields(
  rows: Record<string, any>[],
  headers: string[]
): {
  priceFields: Array<{ key: string; label: string; sample: string }>;
  imageFields: Array<{ key: string; label: string; sample: string }>;
  descriptionFields: Array<{ key: string; label: string; sample: string }>;
} {
  if (!rows.length) return { priceFields: [], imageFields: [], descriptionFields: [] };
  
  const sample = rows[0];
  
  // Detect price fields — numeric values that look like prices
  const priceFields = headers
    .filter(h => {
      const val = String(sample[h] || '');
      const cleaned = val.replace(/[.,\s€$£]/g, '');
      return /^\d+$/.test(cleaned) && parseFloat(val.replace(',', '.')) > 0;
    })
    .map(h => ({
      key: h,
      label: h,
      sample: String(sample[h] || '')
    }));

  // Detect image fields — URLs that look like images
  const imageFields = headers
    .filter(h => {
      const val = String(sample[h] || '');
      return val.startsWith('http') && (
        val.includes('/image') || val.includes('img') || 
        h.toLowerCase().includes('img') || h.toLowerCase().includes('image')
      );
    })
    .map(h => ({ key: h, label: h, sample: String(sample[h] || '').substring(0, 60) + '...' }));

  // Detect description fields — long text
  const descriptionFields = headers
    .filter(h => {
      const val = String(sample[h] || '');
      return val.length > 80 && !val.startsWith('http');
    })
    .map(h => ({ key: h, label: h, sample: String(sample[h] || '').substring(0, 80) + '...' }));

  return { priceFields, imageFields, descriptionFields };
}

// ============================================================
// AI PROMPT GENERATOR
// ============================================================


export function generateAiPrompt(
  rows: Record<string, any>[],
  headers: string[],
  fileFormat: FileFormat,
  xmlFormat?: XmlFormat
): string {
  const formatLabel = xmlFormat 
    ? `${xmlFormat}_xml` 
    : fileFormat;
  
  const sample = rows.slice(0, 3).map(row => {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!k.startsWith('_') && v !== '' && v !== null) {
        clean[k] = typeof v === 'string' && v.length > 100 
          ? v.substring(0, 100) + '...' 
          : v;
      }
    }
    if (row._params) clean._params = row._params.slice(0, 5);
    return clean;
  });

  return `Analisa este feed de fornecedor e devolve um connector_config JSON para um sistema de importação de catálogos.

FORMATO DETECTADO: ${formatLabel}
TOTAL PRODUTOS: ${rows.length}

CAMPOS DISPONÍVEIS NO FICHEIRO (${headers.length} campos):
${headers.join(', ')}

AMOSTRA DE DADOS (primeiros 3 produtos — dados reais):
${JSON.stringify(sample, null, 2)}

CAMPOS DESTINO DO SISTEMA (onde os dados vão ser guardados):
- sku: código único do produto
- original_title: título do produto
- original_description: descrição longa (aceita HTML)
- short_description: descrição curta (aceita HTML)
- technical_specs: especificações técnicas em texto (formato "Campo: Valor | Campo: Valor")
- original_price: preço de custo/fornecedor (número decimal)
- sale_price: preço promocional (número decimal, opcional)
- ean: código EAN/GTIN (string numérica)
- brand: marca
- model: modelo
- category: categoria (usar ">" como separador de hierarquia)
- image_urls: array de URLs de imagens
- attributes: objeto JSON com características { "Nome": { "value": "Valor", "unit": "Unidade" } }
- stock: disponibilidade em stock (número: 1=disponível, 0=indisponível)
- supplier_ref: referência interna do fornecedor
- woocommerce_id: ID do produto no WooCommerce (número inteiro)

TRANSFORMAÇÕES DISPONÍVEIS NO SISTEMA:
1. sku_prefix / sku_suffix: adiciona prefixo ou sufixo ao SKU (com guard contra duplicação)
2. price_comma_decimal: converte "1.000,00" → 1000.00 (vírgula=decimal, ponto=milhar)
3. price_strip_currency: remove sufixo de moeda "34.00 EUR" → 34.00
4. stock_text_to_number: "in stock" → 1, "out of stock" → 0
5. multi_merge: junta múltiplas colunas de imagens num array (filtra vazios e "-")
6. xml_params_to_attributes: converte array _params em attributes JSON + technical_specs
7. triplet_collapse: converte colunas {ID}-parameter-ParamValue em attributes JSON
8. pipe_to_html_list: converte "bullet1|bullet2|bullet3" em "<ul><li>bullet1</li>..."
9. category_slash_to_arrow: converte "A / B / C" em "A > B > C"
10. strip_leading_zeros: remove zeros à esquerda de SKUs numéricos para matching

Devolve APENAS este JSON válido sem nenhum texto adicional, sem markdown, sem explicações:
{
  "file_format": "xml | csv | excel",
  "xml_format": "tefcold | google_merchant | null",
  "sku_prefix": "string ou null",
  "sku_suffix": "string ou null",
  "sku_normalization": "strip_leading_zeros | null",
  "default_brand": "string ou null",
  "operation_mode": "supplier_delta | price_update_only",
  "match_strategy": ["sku_with_prefix", "sku_with_suffix", "ean_fallback", "normalized_sku"],
  "column_mapping": {},
  "image_columns": [],
  "transformations_needed": [],
  "ignore_fields": [],
  "notes": "explicação breve das decisões"
}

REGRAS OBRIGATÓRIAS:
- Google Merchant XML: campos têm prefixo g:, preço tem sufixo de moeda, stock é texto
- Tefcold XML: parâmetros em _params já tratados automaticamente, não precisam de column_mapping
- CSV com colunas {ID}-parameter-ParamValue: usa triplet_collapse automaticamente
- Imagens múltiplas em campos separados: usa multi_merge → image_urls array
- Preços com vírgula decimal (ex: "510,00"): usa price_comma_decimal
- Preços com sufixo de moeda (ex: "34.00 EUR"): usa price_strip_currency
- Stock em texto ("in stock"/"out of stock"): usa stock_text_to_number
- Excel só com preços (sem imagens, sem descrições): operation_mode = "price_update_only"
- Campos sem valor comercial vão para ignore_fields`;
}

// ============================================================
// PRESET CONFIGS
// ============================================================

export const CONNECTOR_PRESETS: Record<string, ConnectorConfig> = {
  tefcold_xml: {
    file_format: 'xml',
    xml_format: 'tefcold',
    sku_prefix: 'TF',
    sku_suffix: '',
    default_brand: 'TEFCOLD',
    operation_mode: 'supplier_delta',
    match_strategy: ['sku_with_prefix', 'ean_fallback'],
    column_mapping: {
      'ITEM_ID': 'sku',
      'PRODUCTNAME': 'original_title',
      'PRODUCT': 'attributes.product_type_supplier',
      'SUMMARY': 'short_description',
      'DESCRIPTION': 'original_description',
      'BRAND': 'brand',
      'EAN': 'ean',
      'PRICE': 'original_price',
      'BASIC_PRICE': 'attributes.pvp_recomendado',
      'ON_STOCK': 'stock',
      'CATEGORYTEXT1': 'category',
      'URL': 'attributes.supplier_url'
    },
    ignore_fields: [
      'VAT', 'DUES', 'WARRANTY', 'WARRANTY_PRICE', 'WARRANTY_2',
      'WARRANTY_PRICE_2', 'WARRANTY_3', 'WARRANTY_PRICE_3',
      'DELIVERY_DATE', 'DELIVERY_DATE_RED', 'NEW_ITEM', 'ACTION',
      'TO_ORDER', 'PRODUCTNO', 'ACTION_PRICE', 'BASIC_PRICE_ACTION'
    ]
  },
  
  fricosmos_xml: {
    file_format: 'xml',
    xml_format: 'google_merchant',
    sku_prefix: '',
    sku_suffix: 'FR',
    default_brand: 'Fricosmos',
    operation_mode: 'supplier_delta',
    match_strategy: ['sku_with_suffix', 'normalized_sku'],
    column_mapping: {
      'g:id': 'sku',
      'g:title': 'original_title',
      'g:description': 'original_description',
      'g:brand': 'brand',
      'g:price': 'original_price',
      'g:availability': 'stock',
      'g:product_type': 'category',
      'g:custom_label_1': 'supplier_ref'
    },
    image_columns: ['g:image_link', 'g:additional_image_link'],
    ignore_fields: [
      'g:condition', 'g:link', 'g:custom_label_0',
      'g:custom_label_2', 'g:availability_date', 'g:color'
    ]
  },
  
  fricosmos_excel_prices: {
    file_format: 'excel',
    xml_format: null,
    sku_prefix: '',
    sku_suffix: 'FR',
    sku_normalization: 'strip_leading_zeros',
    default_brand: 'Fricosmos',
    operation_mode: 'price_update_only',
    match_strategy: ['sku_with_suffix', 'normalized_sku'],
    column_mapping: {
      'CodigoArticulo': 'sku',
      'Precio': 'original_price'
    },
    ignore_fields: [
      'UnidMedidaVenta', 'DescripcionESP',
      'DescripcionENG', 'DescripcionFRA', 'DescripcionDEU'
    ]
  }
};
