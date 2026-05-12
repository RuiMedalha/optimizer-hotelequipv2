import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Standalone parsing functions (identical to frontend logic)

function detectCsvDelimiter(text: string): string {
  const firstLine = text.split('\n')[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

function detectXmlFormat(xmlText: string) {
  if (xmlText.includes('<SHOP>') || xmlText.includes('<SHOPITEM>')) return 'tefcold';
  if (xmlText.includes('base.google.com') || 
     (xmlText.includes('<rss') && xmlText.includes('g:id'))) return 'google_merchant';
  return 'unknown';
}

function parseTefcoldXml(xml: string) {
  const items: any[] = [];
  const itemMatches = xml.matchAll(/<SHOPITEM>([\s\S]*?)<\/SHOPITEM>/g);
  
  for (const match of itemMatches) {
    const itemXml = match[1];
    const item: any = { _format: 'tefcold' };
    
    const fieldMatches = itemXml.matchAll(/<([A-Z_0-9]+)>([\s\S]*?)<\/\1>/g);
    for (const f of fieldMatches) {
      if (f[1] !== 'PARAMETERS') {
        item[f[1]] = f[2].trim();
      }
    }
    
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

function parseGoogleMerchantXml(xml: string) {
  const items: any[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  
  for (const match of itemMatches) {
    const itemXml = match[1];
    const item: any = { _format: 'google_merchant' };
    
    const gFieldMatches = itemXml.matchAll(/<g:([a-z_0-9]+)(?:\s[^>]*)?>([\s\S]*?)<\/g:[a-z_0-9]+>/g);
    for (const f of gFieldMatches) {
      item[`g:${f[1]}`] = f[2].trim();
    }
    
    const plainMatches = itemXml.matchAll(/<(?!g:)([a-z_]+)>([\s\S]*?)<\/[a-z_]+>/g);
    for (const f of plainMatches) {
      if (!item[f[1]]) item[f[1]] = f[2].trim();
    }
    
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { supplierId, workspaceId, format, feedUrl: directUrl } = await req.json();
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // If direct URL provided, handle immediately
    if (directUrl) {
      const response = await fetch(directUrl);
      if (!response.ok) throw new Error(`Feed fetch failed: ${response.status}`);
      const text = await response.text();
      
      if (format === 'csv' && !text.trimStart().startsWith('<')) {
        let totalRows = text.split('\n').length - 1;
        
        // Use connector_config if possible
        let delimiter = null;
        if (supplierId) {
          const { data: s } = await supabase.from('supplier_profiles').select('connector_config').eq('id', supplierId).single();
          delimiter = s?.connector_config?.csv_delimiter;
        }
        
        if (!delimiter) delimiter = detectCsvDelimiter(text);
        
        // Quick check for total rows if delimiter is semicolon
        if (delimiter === ';') {
          totalRows = text.split('\n').filter(l => l.includes(';')).length - 1;
        }

        return new Response(JSON.stringify({ 
          format: 'csv', 
          rawText: text, 
          totalRows,
          csvDelimiter: delimiter
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const xmlFmt = detectXmlFormat(text);
      let rows: any[] = [];
      if (xmlFmt === 'tefcold') rows = parseTefcoldXml(text);
      else if (xmlFmt === 'google_merchant') rows = parseGoogleMerchantXml(text);
      else throw new Error('Formato XML não reconhecido. Suporta: Tefcold (<SHOP>) e Google Merchant (xmlns:g).');
      return new Response(JSON.stringify({ format: 'xml', xmlFormat: xmlFmt, rows: rows.slice(0, 5), allRows: rows, totalRows: rows.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // DB-based fetch (if no directUrl)
    
    const { data: supplier, error } = await supabase
      .from("supplier_profiles")
      .select("feed_url_xml, feed_url_csv, connector_config")
      .eq("id", supplierId)
      .single();
      
    if (error || !supplier) throw new Error("Supplier not found");

    const url = format === 'csv' ? supplier.feed_url_csv : supplier.feed_url_xml;
    if (!url) throw new Error(`No ${format} feed URL configured for this supplier`);
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Feed fetch failed: ${response.status} ${response.statusText}`);
    
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    
    let rows: any[] = [];
    let xmlFormat = null;
    
    if (url.endsWith('.xml') || contentType.includes('xml') || text.trimStart().startsWith('<')) {
      xmlFormat = detectXmlFormat(text);
      if (xmlFormat === 'tefcold') rows = parseTefcoldXml(text);
      else if (xmlFormat === 'google_merchant') rows = parseGoogleMerchantXml(text);
      else throw new Error('Formato XML não reconhecido');
    } else {
      // CSV — return raw text for frontend papaparse
      const delimiter = supplier.connector_config?.csv_delimiter || detectCsvDelimiter(text);
      return new Response(JSON.stringify({
        format: 'csv',
        rawText: text,
        totalRows: text.split('\n').length - 1,
        csvDelimiter: delimiter
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    return new Response(JSON.stringify({
      format: 'xml',
      xmlFormat,
      rows: rows.slice(0, 5), // preview only
      totalRows: rows.length,
      allRows: rows // full data for processing
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
