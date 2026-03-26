const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, useFirecrawl = false, mode = 'browse' } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    let html = '';
    let metadata: Record<string, string> = {};
    let fetchMethod = 'native';

    // Helper to fetch via Firecrawl
    async function fetchViaFirecrawl(): Promise<{ html: string; metadata: Record<string, string>; method: string }> {
      const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (!apiKey) {
        throw new Error('Firecrawl não está configurado. Conecte o Firecrawl nas definições.');
      }
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: formattedUrl,
          formats: ['html'],
          onlyMainContent: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Firecrawl erro ${response.status}`);
      }
      return {
        html: data.data?.html || data.html || '',
        metadata: data.data?.metadata || data.metadata || {},
        method: 'firecrawl',
      };
    }

    if (useFirecrawl) {
      try {
        const result = await fetchViaFirecrawl();
        html = result.html;
        metadata = result.metadata;
        fetchMethod = result.method;
      } catch (e: unknown) {
        return new Response(
          JSON.stringify({ error: e instanceof Error ? (e as Error).message : 'Erro Firecrawl' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Native fetch with manual redirect following (handles 30+ redirects)
      try {
        let currentUrl = formattedUrl;
        let response: Response | null = null;
        const maxRedirects = 30;

        for (let i = 0; i < maxRedirects; i++) {
          response = await fetch(currentUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8,es;q=0.7',
            },
            redirect: 'manual',
          });

          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) break;
            currentUrl = new URL(location, currentUrl).href;
            continue;
          }
          break;
        }

        if (!response || !response.ok) {
          const status = response?.status || 0;
          console.log(`Native fetch returned ${status}, attempting Firecrawl fallback...`);
          try {
            const result = await fetchViaFirecrawl();
            html = result.html;
            metadata = result.metadata;
            fetchMethod = 'firecrawl-fallback';
          } catch (fcErr) {
            return new Response(
              JSON.stringify({ error: `Site bloqueou acesso direto (HTTP ${status}) e Firecrawl falhou: ${fcErr instanceof Error ? fcErr.message : 'erro desconhecido'}` }),
              { status: status || 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else {
          formattedUrl = currentUrl;
          html = await response.text();
          if (html.length < 500 && (html.toLowerCase().includes('captcha') || html.toLowerCase().includes('blocked') || html.toLowerCase().includes('access denied'))) {
            console.log('Native fetch returned blocked/captcha page, attempting Firecrawl fallback...');
            try {
              const result = await fetchViaFirecrawl();
              html = result.html;
              metadata = result.metadata;
              fetchMethod = 'firecrawl-fallback';
            } catch {
              // Use the original html if Firecrawl also fails
            }
          }
          if (fetchMethod !== 'firecrawl-fallback') {
            const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
            metadata = { title: titleMatch?.[1]?.trim() || formattedUrl };
            fetchMethod = 'native';
          }
        }
      } catch (nativeErr) {
        console.log('Native fetch failed, attempting Firecrawl fallback...', nativeErr);
        try {
          const result = await fetchViaFirecrawl();
          html = result.html;
          metadata = result.metadata;
          fetchMethod = 'firecrawl-fallback';
        } catch (fcErr) {
          return new Response(
            JSON.stringify({ error: `Falha no acesso: ${fcErr instanceof Error ? fcErr.message : 'erro desconhecido'}` }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Make all relative URLs absolute
    const baseUrl = new URL(formattedUrl);
    const baseHref = `<base href="${baseUrl.origin}/" target="_self">`;

    let modifiedHtml = html;

    // Inject base href
    if (modifiedHtml.includes('<head>')) {
      modifiedHtml = modifiedHtml.replace('<head>', '<head>' + baseHref);
    } else if (modifiedHtml.includes('<html')) {
      modifiedHtml = modifiedHtml.replace(/<html[^>]*>/, (match) => match + '<head>' + baseHref + '</head>');
    } else {
      modifiedHtml = '<head>' + baseHref + '</head>' + modifiedHtml;
    }

    // Inject cookie banner removal + the appropriate script based on mode
    const cookieScript = buildCookieRemovalScript();
    const script = mode === 'select' ? buildSelectionScript() : buildBrowseScript();

    if (modifiedHtml.includes('</body>')) {
      modifiedHtml = modifiedHtml.replace('</body>', cookieScript + script + '</body>');
    } else {
      modifiedHtml += cookieScript + script;
    }

    return new Response(
      JSON.stringify({
        html: modifiedHtml,
        metadata,
        sourceUrl: formattedUrl,
        fetchMethod,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? (error as Error).message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Browse mode: let user navigate, intercept clicks to notify parent
function buildBrowseScript(): string {
  return `
<script>
(function() {
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      const href = link.href;
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        window.parent.postMessage({
          type: 'navigate',
          url: href,
        }, '*');
      }
      return false;
    }
  }, true);

  document.addEventListener('submit', function(e) {
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
</script>`;
}

// Select mode: highlight + select elements
function buildSelectionScript(): string {
  return `
<style>
  .lv-hover-highlight {
    outline: 2px solid #3b82f6 !important;
    outline-offset: 2px !important;
    cursor: crosshair !important;
  }
  .lv-selected {
    outline: 3px solid #10b981 !important;
    outline-offset: 2px !important;
    background-color: rgba(16, 185, 129, 0.1) !important;
  }
</style>
<script>
(function() {
  let hoveredEl = null;
  
  function getCssSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + current.id;
        parts.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\\s+/)
          .filter(c => !c.startsWith('lv-'))
          .slice(0, 2);
        if (classes.length) selector += '.' + classes.join('.');
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  document.addEventListener('mouseover', function(e) {
    if (hoveredEl) hoveredEl.classList.remove('lv-hover-highlight');
    hoveredEl = e.target;
    if (!hoveredEl.classList.contains('lv-selected')) {
      hoveredEl.classList.add('lv-hover-highlight');
    }
  });

  document.addEventListener('mouseout', function(e) {
    if (hoveredEl) hoveredEl.classList.remove('lv-hover-highlight');
  });

  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    const isSelected = el.classList.contains('lv-selected');
    
    if (isSelected) {
      el.classList.remove('lv-selected');
      window.parent.postMessage({
        type: 'element-deselected',
        selector: getCssSelector(el),
      }, '*');
    } else {
      el.classList.add('lv-selected');
      el.classList.remove('lv-hover-highlight');
      
      const text = el.innerText?.trim().substring(0, 500) || '';
      const src = el.src || el.querySelector('img')?.src || '';
      const href = el.href || '';
      const tagName = el.tagName.toLowerCase();
      
      window.parent.postMessage({
        type: 'element-selected',
        selector: getCssSelector(el),
        text: text,
        src: src,
        href: href,
        tagName: tagName,
        outerHTML: el.outerHTML?.substring(0, 300) || '',
      }, '*');
    }
    return false;
  }, true);
})();
</script>`;
}

// Auto-remove cookie consent banners
function buildCookieRemovalScript(): string {
  return `
<script>
(function() {
  const SELECTORS = [
    '#cookie-banner', '#cookie-consent', '#cookieConsent', '#cookie-notice',
    '#gdpr-banner', '#gdpr-consent', '#consent-banner', '#onetrust-banner-sdk',
    '#onetrust-consent-sdk', '#CybotCookiebotDialog', '#tarteaucitronRoot',
    '#axeptio_overlay', '#axeptio_widget', '#cc-main', '#cc_div',
    '.cookie-banner', '.cookie-consent', '.cookie-notice', '.cookie-popup',
    '.gdpr-banner', '.consent-banner', '.consent-popup', '.cookies-overlay',
    '.cc-banner', '.cc-window', '.js-cookie-consent', '.cookie-law-info-bar',
    '[class*="cookie-consent"]', '[class*="cookie-banner"]', '[class*="cookie-notice"]',
    '[class*="gdpr"]', '[class*="consent-banner"]', '[id*="cookie"]',
    '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
    '[data-testid*="cookie"]', '[data-nosnippet] [class*="consent"]'
  ];

  function removeBanners() {
    SELECTORS.forEach(function(sel) {
      try {
        document.querySelectorAll(sel).forEach(function(el) { el.remove(); });
      } catch (e: unknown) {}
    });
    document.querySelectorAll('[class*="overlay"]').forEach(function(el) {
      var s = getComputedStyle(el);
      if (s.position === 'fixed' && s.zIndex > 999 && el.children.length <= 2) {
        el.remove();
      }
    });
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    document.body.classList.remove('no-scroll', 'modal-open', 'cookie-open');
  }

  removeBanners();
  document.addEventListener('DOMContentLoaded', removeBanners);
  setTimeout(removeBanners, 500);
  setTimeout(removeBanners, 1500);
  setTimeout(removeBanners, 3000);

  var obs = new MutationObserver(function(muts) {
    for (var i = 0; i < muts.length; i++) {
      for (var j = 0; j < muts[i].addedNodes.length; j++) {
        var n = muts[i].addedNodes[j];
        if (n.nodeType === 1) {
          var id = (n.id || '').toLowerCase();
          var cls = (n.className || '').toString().toLowerCase();
          if (id.includes('cookie') || id.includes('consent') || id.includes('gdpr') ||
              cls.includes('cookie') || cls.includes('consent') || cls.includes('gdpr')) {
            n.remove();
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
          }
        }
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>`;
}
