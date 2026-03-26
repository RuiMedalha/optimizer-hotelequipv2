const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from "npm:@supabase/supabase-js@2";

// ── Page Classification Heuristics ──

const PRODUCT_SIGNALS = {
  schema_org: { weight: 30, test: (html: string) => /itemtype.*schema\.org\/(Product|Offer)/i.test(html) },
  add_to_cart: { weight: 20, test: (html: string) => /add[_-]?to[_-]?cart|adicionar.*carrinho|request[_-]?quote|pedido|comprar/i.test(html) },
  price_element: { weight: 15, test: (html: string) => /class="[^"]*price[^"]*"/i.test(html) && /[\d,.]+\s*€|\$\s*[\d,.]+/i.test(html) },
  sku_visible: { weight: 15, test: (html: string) => /\b(SKU|REF|EAN|UPC|GTIN|Referência|Código)\s*[:.]?\s*[\w\d-]+/i.test(html) },
  product_image_gallery: { weight: 10, test: (html: string) => /class="[^"]*(?:product[_-]?image|gallery|swiper|carousel)[^"]*"/i.test(html) },
  breadcrumb: { weight: 5, test: (html: string) => /class="[^"]*breadcrumb[^"]*"/i.test(html) },
  specs_table: { weight: 10, test: (html: string) => /class="[^"]*(?:spec|technical|characteristics|ficha)[^"]*"/i.test(html) },
};

const CATEGORY_SIGNALS = {
  product_list: { weight: 25, test: (html: string) => /class="[^"]*(?:product[_-]?list|products|item-list|catalog)[^"]*"/i.test(html) },
  pagination: { weight: 15, test: (html: string) => /class="[^"]*(?:pagination|pager|page-numbers)[^"]*"/i.test(html) },
  filter_sidebar: { weight: 15, test: (html: string) => /class="[^"]*(?:filter|facet|sidebar|refinement)[^"]*"/i.test(html) },
  multiple_product_links: { weight: 20, test: (html: string) => {
    const matches = html.match(/class="[^"]*product[_-]?(?:card|teaser|item|tile)[^"]*"/gi);
    return (matches?.length || 0) >= 3;
  }},
  category_title: { weight: 10, test: (html: string) => /class="[^"]*(?:category[_-]?title|collection[_-]?title)[^"]*"/i.test(html) },
};

function classifyPage(html: string, url: string): { type: string; confidence: number; signals: Record<string, boolean> } {
  let productScore = 0;
  let categoryScore = 0;
  const signals: Record<string, boolean> = {};

  for (const [name, signal] of Object.entries(PRODUCT_SIGNALS)) {
    const match = signal.test(html);
    signals[`product_${name}`] = match;
    if (match) productScore += signal.weight;
  }

  for (const [name, signal] of Object.entries(CATEGORY_SIGNALS)) {
    const match = signal.test(html);
    signals[`category_${name}`] = match;
    if (match) categoryScore += signal.weight;
  }

  // URL heuristics
  const urlLower = url.toLowerCase();
  if (/\/(product|produto|item|p|model|md\d)[\/-]/i.test(urlLower)) { productScore += 15; signals['url_product_hint'] = true; }
  if (/\/(categor|collection|shop|gama|linha|family|group|range)[\/-]/i.test(urlLower)) { categoryScore += 15; signals['url_category_hint'] = true; }
  if (/\/(search|busca|pesquisa)/i.test(urlLower)) { signals['is_search'] = true; return { type: 'likely_search_page', confidence: 0.8, signals }; }
  if (/\.(pdf|doc|xls|zip|rar)(\?|$)/i.test(urlLower)) { signals['is_document'] = true; return { type: 'likely_document_page', confidence: 0.9, signals }; }
  if (/\/(blog|news|about|contact|faq|privacy|terms)/i.test(urlLower)) { signals['is_info'] = true; return { type: 'info_page', confidence: 0.7, signals }; }

  const maxScore = Math.max(productScore, categoryScore);
  if (productScore > categoryScore && productScore >= 30) {
    return { type: 'likely_product_page', confidence: Math.min(productScore / 100, 0.99), signals };
  }
  if (categoryScore > productScore && categoryScore >= 25) {
    return { type: 'likely_category_page', confidence: Math.min(categoryScore / 100, 0.99), signals };
  }
  return { type: 'unknown', confidence: maxScore / 100, signals };
}

// ── Field Extraction Heuristics ──

function extractProductFields(html: string, url: string, learnedSelectors?: Record<string, string>): { data: Record<string, string>; confidence: Record<string, number> } {
  const data: Record<string, string> = {};
  const confidence: Record<string, number> = {};

  // Try learned selectors first
  if (learnedSelectors) {
    for (const [field, selector] of Object.entries(learnedSelectors)) {
      const value = extractBySelector(html, selector);
      if (value) {
        data[field] = value;
        confidence[field] = 0.9;
      }
    }
  }

  // Schema.org JSON-LD
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      try {
        const content = block.replace(/<\/?script[^>]*>/gi, '');
        const parsed = JSON.parse(content);
        const product = parsed['@type'] === 'Product' ? parsed : (Array.isArray(parsed['@graph']) ? parsed['@graph'].find((n: any) => n['@type'] === 'Product') : null);
        if (product) {
          if (!data.product_name && product.name) { data.product_name = product.name; confidence.product_name = Math.max(confidence.product_name || 0, 0.95); }
          if (!data.sku && product.sku) { data.sku = product.sku; confidence.sku = 0.95; }
          if (!data.brand && product.brand?.name) { data.brand = product.brand.name; confidence.brand = 0.9; }
          if (!data.description && product.description) { data.description = product.description.substring(0, 2000); confidence.description = 0.85; }
          if (!data.price && product.offers) {
            const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
            if (offer?.price) { data.price = String(offer.price); confidence.price = 0.95; }
          }
          if (!data.image_urls && product.image) {
            const imgs = Array.isArray(product.image) ? product.image : [product.image];
            data.image_urls = imgs.filter((u: string) => typeof u === 'string').join(' | ');
            confidence.image_urls = 0.9;
          }
        }
      } catch { /* ignore invalid JSON-LD */ }
    }
  }

  // DOM heuristics for missing fields
  if (!data.product_name) {
    const titleSelectors = ['h1', '.product-title', '.product-name', '.product_title', '[itemprop="name"]'];
    for (const sel of titleSelectors) {
      const val = extractBySelector(html, sel);
      if (val && val.length > 3 && val.length < 300) {
        data.product_name = val;
        confidence.product_name = Math.max(confidence.product_name || 0, 0.7);
        break;
      }
    }
  }

  if (!data.sku) {
    const skuMatch = html.match(/(?:SKU|REF|EAN|UPC|GTIN|Referência|Código|Ref\.|Art\.?\s*Nr)\s*[:.]?\s*([\w\d\-/.]+)/i);
    if (skuMatch) { data.sku = skuMatch[1].trim(); confidence.sku = Math.max(confidence.sku || 0, 0.6); }
  }

  if (!data.price) {
    const priceMatch = html.match(/(?:class="[^"]*price[^"]*"[^>]*>)\s*([^<]*[\d,.]+\s*€)/i) 
      || html.match(/([\d,.]+)\s*€/);
    if (priceMatch) { data.price = priceMatch[1]?.trim() || priceMatch[0]?.trim(); confidence.price = Math.max(confidence.price || 0, 0.5); }
  }

  if (!data.description) {
    const descSelectors = ['[itemprop="description"]', '.product-description', '.description', '#description'];
    for (const sel of descSelectors) {
      const val = extractBySelector(html, sel);
      if (val && val.length > 20) {
        data.description = val.substring(0, 2000);
        confidence.description = Math.max(confidence.description || 0, 0.6);
        break;
      }
    }
  }

  // Technical specs table
  const specsMatch = html.match(/<table[^>]*class="[^"]*(?:spec|technical|characteristics|ficha|features)[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (specsMatch) {
    const rows = specsMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    const specs: string[] = [];
    for (const row of rows.slice(0, 50)) {
      const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
      const cleaned = cells.map(c => c.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
      if (cleaned.length >= 2) specs.push(`${cleaned[0]}: ${cleaned.slice(1).join(', ')}`);
    }
    if (specs.length > 0) {
      data.technical_specs = specs.join('\n');
      confidence.technical_specs = 0.7;
    }
  }

  // Images
  if (!data.image_urls) {
    const imgMatches = html.match(/class="[^"]*(?:product[_-]?image|gallery|main-image|swiper-slide)[^"]*"[\s\S]*?(?:src|data-src|data-lazy-src)="([^"]+)"/gi) || [];
    const imgs: string[] = [];
    for (const m of imgMatches.slice(0, 20)) {
      const srcMatch = m.match(/(?:src|data-src|data-lazy-src)="([^"]+)"/i);
      if (srcMatch?.[1] && !srcMatch[1].includes('placeholder') && !srcMatch[1].includes('data:image')) {
        imgs.push(srcMatch[1]);
      }
    }
    if (imgs.length > 0) {
      data.image_urls = [...new Set(imgs)].join(' | ');
      confidence.image_urls = 0.6;
    }
  }

  // Category breadcrumbs
  const breadMatch = html.match(/class="[^"]*breadcrumb[^"]*"[^>]*>([\s\S]*?)<\/(?:nav|ol|ul|div)>/i);
  if (breadMatch) {
    const links = breadMatch[1].match(/<a[^>]*>([^<]+)<\/a>/gi) || [];
    const crumbs = links.map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    if (crumbs.length > 0) {
      data.category_breadcrumbs = crumbs.join(' > ');
      confidence.category_breadcrumbs = 0.8;
    }
  }

  return { data, confidence };
}

function extractBySelector(html: string, selector: string): string {
  // Simple selector extraction using regex
  let tag = '';
  let className = '';
  let id = '';
  let attr = '';
  let attrVal = '';

  const idMatch = selector.match(/#([\w-]+)/);
  if (idMatch) id = idMatch[1];
  const classMatch = selector.match(/\.([\w-]+)/);
  if (classMatch) className = classMatch[1];
  const attrMatch = selector.match(/\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/);
  if (attrMatch) { attr = attrMatch[1]; attrVal = attrMatch[2] || ''; }
  const tagMatch = selector.match(/^(\w+)/);
  if (tagMatch) tag = tagMatch[1].toLowerCase();

  const tagP = tag || '[a-z][a-z0-9]*';
  const re = new RegExp(`<(${tagP})(\\s[^>]*?)?>(.*?)<\\/${tagP}>`, 'gis');
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, , mAttrs = '', inner] = m;
    if (id && !new RegExp(`id=['"]${id}['"]`, 'i').test(mAttrs)) continue;
    if (className && !new RegExp(`class=['"][^'"]*\\b${className}\\b`, 'i').test(mAttrs)) continue;
    if (attr) {
      if (attrVal) {
        if (!new RegExp(`${attr}=['"][^'"]*${attrVal}`, 'i').test(mAttrs)) continue;
      } else if (!mAttrs.includes(attr)) continue;
    }
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

// ── URL Discovery ──

function discoverLinks(html: string, baseUrl: string): { url: string; text: string; type: string }[] {
  const links: { url: string; text: string; type: string }[] = [];
  const seen = new Set<string>();
  const base = new URL(baseUrl);

  const NAV_HINT = /(contact|about|legal|privacy|terms|cookies|faq|blog|news|cart|checkout|account|login|search|facebook|instagram|linkedin|youtube)/i;
  const FOOTER_SEL = /(?:footer|\.footer|\.copyright)/i;

  const anchorRe = /<a\s([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const [, attrs, inner] = m;
    const hrefMatch = attrs.match(/href=['"]([^'"]+)['"]/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

    try {
      const resolved = new URL(href, baseUrl).href;
      if (seen.has(resolved) || new URL(resolved).hostname !== base.hostname) continue;
      seen.add(resolved);

      if (NAV_HINT.test(resolved)) continue;

      // Check if inside footer (rough check - look at preceding 500 chars)
      const preceding = html.substring(Math.max(0, m.index - 500), m.index).toLowerCase();
      if (FOOTER_SEL.test(preceding)) continue;

      const text = inner.replace(/<[^>]+>/g, '').trim().substring(0, 120);
      
      // Classify the link
      let type = 'unknown';
      const urlLower = resolved.toLowerCase();
      if (/\/(product|produto|item|p|model|md\d)[\/-]/i.test(urlLower)) type = 'likely_product_page';
      else if (/\/(categor|collection|shop|gama|linha|family|group|range)[\/-]/i.test(urlLower)) type = 'likely_category_page';
      else if (/\.(pdf|doc|xls)(\?|$)/i.test(urlLower)) type = 'likely_document_page';
      else if (/\/(search|busca)/i.test(urlLower)) type = 'likely_search_page';

      links.push({ url: resolved, text, type });
    } catch { /* ignore */ }

    if (links.length >= 500) break;
  }

  return links;
}

// ── Main Handler ──

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || '' } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action, workspace_id } = body;

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: 'workspace_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let result: any;

    switch (action) {
      case 'discover': {
        const { target_url, config_id, use_firecrawl = false } = body;
        if (!target_url) throw new Error('target_url required');

        // Fetch the page
        let html = '';
        if (use_firecrawl) {
          const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
          if (!apiKey) throw new Error('Firecrawl not configured');
          const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: target_url, formats: ['html'], onlyMainContent: false }),
          });
          const data = await resp.json();
          html = data.data?.html || data.html || '';
        } else {
          const resp = await fetch(target_url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
            },
            redirect: 'follow',
          });
          html = await resp.text();
        }

        // Classify the target page
        const classification = classifyPage(html, target_url);

        // Discover links
        const links = discoverLinks(html, target_url);

        // Load learned patterns if config exists
        let learnedPatterns: any[] = [];
        if (config_id) {
          const { data: patterns } = await supabase
            .from('website_extraction_learnings')
            .select('*')
            .eq('config_id', config_id)
            .order('confidence', { ascending: false })
            .limit(50);
          learnedPatterns = patterns || [];
        }

        // Apply learned URL patterns to improve classification
        for (const link of links) {
          if (link.type === 'unknown') {
            const matchingPattern = learnedPatterns.find(
              p => p.learning_type === 'url_pattern' && link.url.match(new RegExp(p.pattern_key || '', 'i'))
            );
            if (matchingPattern) {
              link.type = matchingPattern.pattern_value?.page_type || 'unknown';
            }
          }
        }

        // Create run record
        const { data: run, error: runErr } = await supabase
          .from('website_extraction_runs')
          .insert({
            workspace_id,
            config_id,
            phase: 'discovery',
            status: 'completed',
            target_url,
            pages_discovered: links.length,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (runErr) throw runErr;

        // Store discovered pages
        const pageRecords = links.map(link => ({
          run_id: run.id,
          workspace_id,
          url: link.url,
          page_type: link.type,
          classification_confidence: 0,
          extraction_status: 'pending',
        }));

        if (pageRecords.length > 0) {
          // Insert in batches of 100
          for (let i = 0; i < pageRecords.length; i += 100) {
            await supabase.from('website_extraction_pages').insert(pageRecords.slice(i, i + 100));
          }
        }

        // Summary stats
        const stats = {
          total: links.length,
          product_pages: links.filter(l => l.type === 'likely_product_page').length,
          category_pages: links.filter(l => l.type === 'likely_category_page').length,
          document_pages: links.filter(l => l.type === 'likely_document_page').length,
          search_pages: links.filter(l => l.type === 'likely_search_page').length,
          unknown: links.filter(l => l.type === 'unknown').length,
        };

        result = {
          run_id: run.id,
          target_classification: classification,
          links,
          stats,
          learned_patterns_applied: learnedPatterns.length,
        };
        break;
      }

      case 'classify_pages': {
        const { urls, config_id, use_firecrawl = false } = body;
        if (!urls || !Array.isArray(urls) || urls.length === 0) throw new Error('urls array required');

        const classifications: any[] = [];

        // Load learned selectors
        let learnedSelectors: Record<string, string> = {};
        if (config_id) {
          const { data: config } = await supabase
            .from('website_extraction_configs')
            .select('learned_selectors')
            .eq('id', config_id)
            .single();
          learnedSelectors = (config?.learned_selectors as Record<string, string>) || {};
        }

        for (const url of urls.slice(0, 20)) {
          try {
            let html = '';
            if (use_firecrawl) {
              const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
              if (!apiKey) throw new Error('Firecrawl not configured');
              const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, formats: ['html'], onlyMainContent: false }),
              });
              const data = await resp.json();
              html = data.data?.html || data.html || '';
            } else {
              const resp = await fetch(url, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': 'text/html',
                },
                redirect: 'follow',
              });
              html = await resp.text();
            }

            const classification = classifyPage(html, url);
            classifications.push({ url, ...classification, html_length: html.length });
          } catch (err: any) {
            classifications.push({ url, type: 'error', confidence: 0, signals: {}, error: (err as Error).message });
          }
        }

        result = { classifications };
        break;
      }

      case 'extract_test': {
        const { urls, config_id, run_id, use_firecrawl = false } = body;
        if (!urls || !Array.isArray(urls) || urls.length === 0) throw new Error('urls array required');

        // Load learned selectors
        let learnedSelectors: Record<string, string> = {};
        if (config_id) {
          const { data: config } = await supabase
            .from('website_extraction_configs')
            .select('learned_selectors')
            .eq('id', config_id)
            .single();
          learnedSelectors = (config?.learned_selectors as Record<string, string>) || {};
        }

        const extractions: any[] = [];

        for (const url of urls.slice(0, 10)) {
          try {
            let html = '';
            if (use_firecrawl) {
              const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
              if (!apiKey) throw new Error('Firecrawl not configured');
              const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, formats: ['html'], onlyMainContent: false }),
              });
              const data = await resp.json();
              html = data.data?.html || data.html || '';
            } else {
              const resp = await fetch(url, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': 'text/html',
                },
                redirect: 'follow',
              });
              html = await resp.text();
            }

            const classification = classifyPage(html, url);
            const extraction = extractProductFields(html, url, learnedSelectors);
            
            // Calculate overall confidence
            const fieldCount = Object.keys(extraction.data).length;
            const avgConfidence = fieldCount > 0
              ? Object.values(extraction.confidence).reduce((a, b) => a + b, 0) / fieldCount
              : 0;

            // Determine warnings
            const warnings: string[] = [];
            if (!extraction.data.product_name) warnings.push('product_name não encontrado');
            if (!extraction.data.sku) warnings.push('SKU não encontrado');
            if (!extraction.data.price) warnings.push('Preço não encontrado');
            if (!extraction.data.image_urls) warnings.push('Imagens não encontradas');
            if (classification.type !== 'likely_product_page') warnings.push(`Página classificada como ${classification.type}`);

            const result = {
              url,
              page_classification: classification,
              extracted_data: extraction.data,
              field_confidence: extraction.confidence,
              fields_found: fieldCount,
              avg_confidence: Math.round(avgConfidence * 100) / 100,
              warnings,
            };

            extractions.push(result);

            // Update page record if run_id exists
            if (run_id) {
              await supabase
                .from('website_extraction_pages')
                .update({
                  page_type: classification.type,
                  classification_confidence: classification.confidence,
                  classification_signals: classification.signals,
                  extraction_status: 'extracted',
                  extracted_data: extraction.data,
                  field_confidence: extraction.confidence,
                  warnings,
                })
                .eq('run_id', run_id)
                .eq('url', url);
            }
          } catch (err: any) {
            extractions.push({ url, error: (err as Error).message, extracted_data: {}, field_confidence: {}, warnings: [(err as Error).message] });
          }
        }

        result = { extractions, total: extractions.length };
        break;
      }

      case 'save_learning': {
        const { config_id, domain, learnings } = body;
        if (!domain || !learnings || !Array.isArray(learnings)) throw new Error('domain and learnings required');

        const records = learnings.map((l: any) => ({
          workspace_id,
          config_id,
          domain,
          learning_type: l.type,
          pattern_key: l.key,
          pattern_value: l.value,
          confidence: l.confidence || 0.8,
        }));

        const { error } = await supabase.from('website_extraction_learnings').insert(records);
        if (error) throw error;

        // Update config learned_selectors if applicable
        if (config_id) {
          const selectorLearnings = learnings.filter((l: any) => l.type === 'selector');
          if (selectorLearnings.length > 0) {
            const { data: config } = await supabase
              .from('website_extraction_configs')
              .select('learned_selectors')
              .eq('id', config_id)
              .single();
            
            const existing = (config?.learned_selectors as Record<string, string>) || {};
            for (const sl of selectorLearnings) {
              existing[sl.key] = sl.value?.selector || '';
            }

            await supabase
              .from('website_extraction_configs')
              .update({ learned_selectors: existing, updated_at: new Date().toISOString() })
              .eq('id', config_id);
          }
        }

        result = { saved: records.length };
        break;
      }

      case 'create_config': {
        const { domain, display_name, supplier_id } = body;
        if (!domain) throw new Error('domain required');

        const { data: config, error } = await supabase
          .from('website_extraction_configs')
          .insert({ workspace_id, domain, display_name: display_name || domain, supplier_id })
          .select()
          .single();
        if (error) throw error;

        result = config;
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Website Extraction Agent error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
