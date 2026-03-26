const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Ultra-lightweight extraction: find opening tags, then grab text/attrs only
function findElements(html: string, selector: string): { tag: string; attrs: string; outerStart: number }[] {
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
  // Only match opening tags — no greedy innerHTML capture
  const re = new RegExp(`<(${tagP})(\\s[^>]*?)?\\/?>`, 'gi');
  const found: { tag: string; attrs: string; outerStart: number }[] = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, mTag, mAttrs = ''] = m;
    if (id && !new RegExp(`id=['"]${id}['"]`, 'i').test(mAttrs)) continue;
    if (className && !new RegExp(`class=['"][^'"]*\\b${className}\\b`, 'i').test(mAttrs)) continue;
    if (attr) {
      if (attrVal) {
        if (!new RegExp(`${attr}=['"][^'"]*${attrVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(mAttrs)) continue;
      } else if (!mAttrs.includes(attr)) continue;
    }
    found.push({ tag: mTag.toLowerCase(), attrs: mAttrs, outerStart: m.index });
    if (found.length >= 100) break;
  }
  return found;
}

function getAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*['"]([^'"]+)['"]`, 'i'));
  return m?.[1] || '';
}

// Extract text between the opening tag and its closing tag (simple, non-nested)
function getInnerText(html: string, start: number, tag: string): string {
  const closeTag = `</${tag}>`;
  const openEnd = html.indexOf('>', start);
  if (openEnd < 0) return '';
  const closeIdx = html.indexOf(closeTag, openEnd + 1);
  if (closeIdx < 0) return '';
  const inner = html.substring(openEnd + 1, Math.min(closeIdx, openEnd + 5000));
  return inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getInnerHtml(html: string, start: number, tag: string): string {
  const closeTag = `</${tag}>`;
  const openEnd = html.indexOf('>', start);
  if (openEnd < 0) return '';
  const closeIdx = html.indexOf(closeTag, openEnd + 1);
  if (closeIdx < 0) return '';
  return html.substring(openEnd + 1, Math.min(closeIdx, openEnd + 10000)).trim();
}

function extractField(html: string, selector: string, type: string, isVariation: boolean): string {
  const elements = findElements(html, selector);

  const getImageFromAttrs = (attrs: string): string => {
    const direct = getAttr(attrs, 'src')
      || getAttr(attrs, 'data-src')
      || getAttr(attrs, 'data-lazy-src')
      || getAttr(attrs, 'data-original')
      || getAttr(attrs, 'data-image');
    if (direct) return direct.trim();

    const srcset = getAttr(attrs, 'srcset') || getAttr(attrs, 'data-srcset');
    if (srcset) {
      const first = srcset
        .split(',')
        .map(s => s.trim().split(/\s+/)[0])
        .find(Boolean);
      return first || '';
    }

    return '';
  };

  const collectFromElements = (els: { tag: string; attrs: string; outerStart: number }[], target: Set<string>) => {
    for (const el of els) {
      const directSrc = getImageFromAttrs(el.attrs);
      if (directSrc) target.add(directSrc);

      if (el.tag !== 'img') {
        const inner = getInnerHtml(html, el.outerStart, el.tag);
        const imgTagRe = /<img\s([^>]*?)\/?>/gi;
        let imgTagMatch;
        while ((imgTagMatch = imgTagRe.exec(inner)) !== null) {
          const url = getImageFromAttrs(imgTagMatch[1] || '');
          if (url) target.add(url);
        }
      }
    }
  };

  // For image type, extract ALL image URLs from selected elements + fallback gallery selectors
  if (type === 'image') {
    const allUrls = new Set<string>();

    if (elements.length > 0) {
      collectFromElements(elements, allUrls);
    }

    // Fallback: if selector was too specific (e.g. nth-of-type / active slide), scan known gallery containers
    if (allUrls.size <= 1) {
      const galleryFallbackSelectors = [
        '.ProductMain-images-slider-item',
        '.ProductMain-images',
        '.woocommerce-product-gallery__image',
        '.woocommerce-product-gallery',
        '.product-gallery',
        '.product-thumbnails',
        '.gallery-item',
      ];

      for (const fallbackSelector of galleryFallbackSelectors) {
        const fallbackElements = findElements(html, fallbackSelector);
        if (fallbackElements.length > 0) {
          collectFromElements(fallbackElements, allUrls);
        }
      }
    }

    const urlArr = [...allUrls];
    if (isVariation || urlArr.length > 1) {
      return urlArr.join(' | ');
    }
    return urlArr[0] || '';
  }

  if (elements.length === 0) return '';

  const extract = (el: typeof elements[0]): string => {
    switch (type) {
      case 'link': return getAttr(el.attrs, 'href') || '';
      case 'html': return getInnerHtml(html, el.outerStart, el.tag);
      default: return getInnerText(html, el.outerStart, el.tag);
    }
  };

  if (isVariation) {
    const vals = new Set<string>();
    for (const el of elements) {
      const v = extract(el);
      if (v) vals.add(v);
    }
    return [...vals].join(' | ');
  }

  return extract(elements[0]);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { urls, fields, workspaceId, templateName, useFirecrawl = false } = await req.json();

    if (!urls?.length || !fields?.length) {
      return new Response(
        JSON.stringify({ error: 'URLs e campos são obrigatórios.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    const results: any[] = [];
    const errors: any[] = [];
    let firecrawlCreditsUsed = 0;

    // Process max 5 URLs per invocation
    for (const url of urls.slice(0, 5)) {
      try {
        let html = '';

        if (useFirecrawl && apiKey) {
          const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, formats: ['html'], onlyMainContent: false }),
          });
          if (!response.ok) { errors.push({ url, error: `Firecrawl HTTP ${response.status}` }); continue; }
          const data = await response.json();
          html = data.data?.html || data.html || '';
          firecrawlCreditsUsed++;
        } else {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml',
            },
            redirect: 'follow',
          });
          if (!response.ok) { errors.push({ url, error: `HTTP ${response.status}` }); continue; }
          html = await response.text();
        }

        // Truncate to 500KB to prevent memory issues
        if (html.length > 500_000) html = html.substring(0, 500_000);

        const extracted: Record<string, string> = { source_url: url };

        // Extract variations automatically (selects, swatches)
        const variationSelectors = [
          { selector: 'select[name*="attribute"]', label: 'variation_select' },
          { selector: '.variations select', label: 'variation_select' },
          { selector: 'select[id*="pa_"]', label: 'variation_select' },
          { selector: '.swatch-anchor', label: 'variation_swatch' },
          { selector: '.variation-selector', label: 'variation_select' },
          { selector: '[data-attribute_name]', label: 'variation_attr' },
        ];

        // Check if any field is a variation field; if none defined, auto-detect
        const hasVariationField = fields.some((f: any) => f.isVariation && f.name.toLowerCase().includes('varia'));
        if (!hasVariationField) {
          for (const vs of variationSelectors) {
            const varEls = findElements(html, vs.selector);
            if (varEls.length > 0) {
              // Extract option values from select elements
              const optionRe = /<option[^>]*value=['"]([^'"]+)['"][^>]*>([^<]*)<\/option>/gi;
              const allOptions: string[] = [];
              for (const vel of varEls) {
                const inner = getInnerHtml(html, vel.outerStart, vel.tag);
                let optMatch;
                while ((optMatch = optionRe.exec(inner)) !== null) {
                  const val = (optMatch[2] || optMatch[1]).trim();
                  if (val && val.length > 0) allOptions.push(val);
                }
                // Reset regex
                optionRe.lastIndex = 0;
              }
              if (allOptions.length > 0) {
                // Get the attribute name from the select name or data attribute
                const attrName = getAttr(varEls[0].attrs, 'data-attribute_name')
                  || getAttr(varEls[0].attrs, 'name')?.replace('attribute_', '').replace('pa_', '')
                  || 'variação';
                extracted[`Variações (${attrName})`] = [...new Set(allOptions)].join(' | ');
              }
              break;
            }
          }
        }

        for (const field of fields) {
          try {
            extracted[field.name] = extractField(html, field.selector, field.type, field.isVariation);
          } catch {
            extracted[field.name] = '';
          }
        }

        // Make relative URLs absolute
        const baseOrigin = new URL(url).origin;
        for (const field of fields) {
          if ((field.type === 'image' || field.type === 'link') && extracted[field.name]) {
            extracted[field.name] = extracted[field.name].split(' | ').map(v => {
              if (v && !v.startsWith('http')) {
                try { return new URL(v, baseOrigin).href; } catch { return v; }
              }
              return v;
            }).join(' | ');
          }
        }

        results.push(extracted);
        html = ''; // free memory
      } catch (err: unknown) {
        errors.push({ url, error: err instanceof Error ? (err as Error).message : 'Unknown error' });
      }
    }

    if (firecrawlCreditsUsed > 0 && workspaceId) {
      try { await supabase.rpc('increment_scraping_credits', { _workspace_id: workspaceId }); } catch {}
    }

    if (templateName && workspaceId) {
      await supabase.from('scraping_templates').upsert({
        workspace_id: workspaceId, user_id: user.id, template_name: templateName,
        fields, sample_url: urls[0], updated_at: new Date().toISOString(),
      } as any, { onConflict: 'workspace_id,template_name' });
    }

    return new Response(
      JSON.stringify({ success: true, results, errors, total: urls.length, extracted: results.length, failed: errors.length, firecrawlCreditsUsed, method: useFirecrawl ? 'firecrawl' : 'native' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? (error as Error).message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
