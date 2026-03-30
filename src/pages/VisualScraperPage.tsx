import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { logger } from "@/lib/logger";
import { DEFAULT_PRODUCT_FIELDS } from "@/hooks/useUploadCatalog";
import { ExcelPreviewTable } from "@/components/scraper/ExcelPreviewTable";
import {
  Globe, Loader2, MousePointerClick, Trash2, Play, Download,
  Eye, Link2, Image as ImageIcon, Type, FileText, ArrowRight, ArrowLeft, X,
  Zap, Coins, List, Navigation, Crosshair, ExternalLink, RefreshCw, Wand2,
  Upload, ChevronRight, Layers, FileSpreadsheet, Plus, Target, AlertTriangle,
  CheckCircle2, Brain,
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  analyzeHtmlProductSignals,
  buildAutoProductMapping,
  computeFingerprintRatios,
  summarizeVariationStructure,
} from "@/lib/scraperIntelligence";
import { ScrapingScheduleManager } from "@/components/scraper/ScrapingScheduleManager";
import { ScrapingChangeMonitor } from "@/components/scraper/ScrapingChangeMonitor";

/* ────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────── */

type FieldPurpose = "field" | "category_url" | "product_url";

interface SelectedField {
  id: string;
  name: string;
  selector: string;
  type: "text" | "image" | "link" | "html";
  preview: string;
  isVariation?: boolean;
  purpose: FieldPurpose;
}

interface ExtractedRow {
  [key: string]: string;
}

type LinkType = "categoria" | "grupo" | "subcategoria" | "produto" | "outro";

interface ExtractedLink {
  url: string;
  text: string;
  selected: boolean;
  linkType: LinkType;
  depth?: number;
  parentCategory?: string;
}

interface SiteLayer {
  label: string;
  links: ExtractedLink[];
  sourceUrl: string;
  hasPagination: boolean;
  paginationUrls: string[];
}

interface CrawlStats {
  categoriesProcessed: number;
  subcategoriesFound: number;
  pagesProcessed: number;
  productsFound: number;
  maxDepthReached: number;
}

type Step =
  | "url"          // 1. Enter URL
  | "browse"       // 2. Browse site in iframe
  | "categories"   // 3. View/select category layers, drill, pagination
  | "products"     // 4. Collected product URLs
  | "fields"       // 5. Open product page, select fields visually
  | "extract"      // 6. Running extraction
  | "results";     // 7. Results table

/* ────────────────────────────────────────────────
   Link classification helpers
   ──────────────────────────────────────────────── */

const NAV_URL_HINT = /(contact|about|legal|privacy|terms|cookies|gdpr|faq|blog|news|cart|checkout|account|login|search|facebook|instagram|linkedin|youtube)/i;
const PRODUCT_URL_HINT = /(\/product(s)?\/|\/produto(s)?\/|\/p\/|\/item\/|\/model\/|\/md\d+)/i;
const CATEGORY_URL_HINT = /(\/categor(y|ies)\/|\/categoria(s)?\/|\/collection(s)?\/|\/grupo(s)?\/|\/range\/|\/gama\/|\/famil(y|ies)\/|\/shop\/)/i;
const GROUP_URL_HINT = /(\/group(s)?\/|\/groupe(s)?\/|\/family|\/familia|\/series|\/linha|\/gama)/i;
const NON_HTML_FILE_HINT = /\.(jpg|jpeg|png|webp|gif|svg|pdf|zip|rar|mp4|mp3|webm|avi)(\?|$)/i;
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

const NAV_CONTAINER_SELECTOR = 'nav, header, .menu, .navbar, .header, .breadcrumb, .social, [role="navigation"]';
const FOOTER_CONTAINER_SELECTOR = 'footer, .footer, .footer-menu, .footer-links, .copyright, [role="contentinfo"]';
const MAIN_CONTENT_SELECTOR = 'main, #Main-wrapper, .NodeCategory, .NodeCategoriesList, .item-list, .products, .product-list, .catalog, [role="main"]';

const PRODUCT_LINK_CLASSES = [
  'productteaser', 'product-teaser', 'product-card', 'product-item',
  'product-link', 'product-tile', 'woocommerce-loop-product__link',
];
const CATEGORY_LINK_CLASSES = [
  'categoryproductteaser', 'category-teaser', 'category-card', 'category-link',
];

const canonicalizeUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    TRACKING_PARAMS.forEach(param => parsed.searchParams.delete(param));
    parsed.pathname = parsed.pathname.replace(/\/+/g, '/');
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch { return rawUrl; }
};

const classifyLink = (anchor: Element, fullUrl: string): 'product' | 'category' | 'navigation' | 'other' => {
  const classes = (typeof anchor.className === 'string' ? anchor.className : '').toLowerCase();
  const href = (anchor.getAttribute('href') || '').toLowerCase();
  const text = (anchor.textContent || anchor.getAttribute('aria-label') || anchor.getAttribute('title') || '').toLowerCase().trim();
  const normalizedUrl = fullUrl.toLowerCase();

  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return 'navigation';
  if (NON_HTML_FILE_HINT.test(normalizedUrl)) return 'other';
  if (!!anchor.closest(`${NAV_CONTAINER_SELECTOR}, ${FOOTER_CONTAINER_SELECTOR}`)) return 'navigation';
  if (NAV_URL_HINT.test(normalizedUrl) || NAV_URL_HINT.test(text)) return 'navigation';
  if (PRODUCT_LINK_CLASSES.some(c => classes.includes(c)) || PRODUCT_URL_HINT.test(normalizedUrl)) return 'product';
  if (CATEGORY_LINK_CLASSES.some(c => classes.includes(c)) || CATEGORY_URL_HINT.test(normalizedUrl)) return 'category';

  const isInMainContent = !!anchor.closest(MAIN_CONTENT_SELECTOR);
  if (isInMainContent) {
    try {
      const depth = new URL(fullUrl).pathname.split('/').filter(Boolean).length;
      if (depth >= 4) return 'product';
      if (depth >= 2) return 'category';
    } catch { return 'other'; }
  }

  return 'other';
};

/* ────────────────────────────────────────────────
   Auto-detect field selectors
   ──────────────────────────────────────────────── */
const FIELD_DETECTION_RULES: { name: string; selectors: string[]; type: SelectedField["type"]; isVariation?: boolean }[] = [
  { name: "Título", selectors: ["h1.product_title", "h1.product-title", "h1[itemprop='name']", ".ProductTop-title", "h1.entry-title", "h1"], type: "text" },
  { name: "Modelo", selectors: [".ProductTop-name", ".product-model", ".product-subtitle"], type: "text" },
  { name: "Gama", selectors: [".ProductTop-gamme", ".product-range", ".product-line"], type: "text" },
  { name: "Referência", selectors: [".ProductMain-features-ref", ".sku", "[itemprop='sku']", ".product-sku", ".product-reference", ".ref-number"], type: "text" },
  { name: "Preço", selectors: [".price ins .amount", ".price .amount", "[itemprop='price']", ".product-price", ".woocommerce-Price-amount", ".price"], type: "text" },
  { name: "Preço Original", selectors: [".price del .amount", ".was-price", ".old-price", ".regular-price"], type: "text" },
  { name: "Descrição", selectors: [".ProductMain-desc-content", ".woocommerce-product-details__short-description", "#tab-description", "[itemprop='description']", ".product-description"], type: "html" },
  { name: "Imagem Principal", selectors: [".ProductMain-images-slider-item img", ".woocommerce-product-gallery__image img", ".product-image img", "[itemprop='image']", ".wp-post-image"], type: "image" },
  { name: "Galeria Imagens", selectors: [".ProductMain-images-slider-item:not(:first-child) img", ".woocommerce-product-gallery__image:not(:first-child) img", ".product-thumbnails img", ".gallery-item img"], type: "image", isVariation: true },
  { name: "Características", selectors: [".Features-list", ".ProductMain-features-list table", ".product-specs", ".specifications", ".tech-specs"], type: "html" },
  { name: "Benefícios", selectors: [".ProductMain-quantity-list", ".product-benefits", ".key-features"], type: "html" },
  { name: "Capacidade", selectors: [".ProductMain-quantity-title", ".product-capacity"], type: "text" },
  { name: "Categoria", selectors: [".posted_in a", "[itemprop='category']", ".breadcrumb a:last-child"], type: "text" },
  { name: "Marca", selectors: ["[itemprop='brand']", ".product-brand", ".brand a"], type: "text" },
  { name: "Peso", selectors: [".product_weight", "[itemprop='weight']", ".weight-value"], type: "text" },
  { name: "Dimensões", selectors: [".product_dimensions", ".dimensions-value"], type: "text" },
  { name: "Stock", selectors: [".stock", ".availability", "[itemprop='availability']", ".in-stock", ".product-stock"], type: "text" },
  { name: "Variações", selectors: ["select[name^='attribute'] option:not([value=''])", ".variations select option:not([value=''])", ".swatch-anchor"], type: "text", isVariation: true },
  { name: "EAN/GTIN", selectors: ["[itemprop='gtin13']", "[itemprop='gtin']", ".ean-value", ".barcode"], type: "text" },
  { name: "Documentos", selectors: [".btn-download a", ".ProductDetails a[href$='.pdf']", "a[href$='.pdf']"], type: "link", isVariation: true },
];

/* ────────────────────────────────────────────────
   Step config
   ──────────────────────────────────────────────── */
const STEP_CONFIG: { key: Step; label: string; icon: typeof Globe }[] = [
  { key: "url", label: "URL", icon: Globe },
  { key: "browse", label: "Navegar", icon: Navigation },
  { key: "categories", label: "Categorias", icon: Layers },
  { key: "products", label: "Produtos", icon: Target },
  { key: "fields", label: "Campos", icon: Crosshair },
  { key: "extract", label: "Extrair", icon: Play },
  { key: "results", label: "Resultados", icon: CheckCircle2 },
];

/* ════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════ */

export default function VisualScraperPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [iframeMode, setIframeMode] = useState<"browse" | "select">("browse");

  // Cost control
  const [useFirecrawl, setUseFirecrawl] = useState(false);

  // Category layers
  const [layers, setLayers] = useState<SiteLayer[]>([]);
  const [currentLinks, setCurrentLinks] = useState<ExtractedLink[]>([]);
  const [linkFilter, setLinkFilter] = useState("");

  // Collected product URLs
  const [productUrls, setProductUrls] = useState<string[]>([]);
  const [collectProgress, setCollectProgress] = useState<{ current: number; total: number; label?: string; pages?: number } | null>(null);
  const [crawlStats, setCrawlStats] = useState<CrawlStats | null>(null);

  // Pagination config
  const [paginationMode, setPaginationMode] = useState<"auto" | "pattern">("auto");
  const [paginationPattern, setPaginationPattern] = useState(""); // e.g. "?page={n}" or "/page/{n}/"
  const [maxPagesPerCategory, setMaxPagesPerCategory] = useState(50);
  const [maxCrawlDepth, setMaxCrawlDepth] = useState(5);
  const [showPaginationConfig, setShowPaginationConfig] = useState(false);

  // Fields
  const [fields, setFields] = useState<SelectedField[]>([]);

  // Batch/Results
  const [batchLoading, setBatchLoading] = useState(false);
  const [results, setResults] = useState<ExtractedRow[]>([]);
  const [errors, setErrors] = useState<any[]>([]);

  // Dialogs
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [scraperMapping, setScraperMapping] = useState<Record<string, string>>({});
  const [showPatternDialog, setShowPatternDialog] = useState(false);
  const [urlPatterns, setUrlPatterns] = useState<{ pattern: string; count: number; sample: string; selected: boolean }[]>([]);

  // Manual URL import
  const [manualUrls, setManualUrls] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Category agent dialog
  const [showCategoryAgentDialog, setShowCategoryAgentDialog] = useState(false);
  const [categoryAgentSelection, setCategoryAgentSelection] = useState<Record<string, boolean>>({});

  /* ── Listen for iframe messages ── */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "navigate") {
        loadPage(e.data.url, "browse");
      } else if (e.data?.type === "element-selected") {
        const { selector, text, src, href, tagName } = e.data;
        let type: SelectedField["type"] = "text";
        let preview = text || "";
        if (tagName === "img" || src) { type = "image"; preview = src || ""; }
        else if (tagName === "a" || href) { type = "link"; preview = href || text || ""; }

        const inferPurpose: FieldPurpose = (type === "link" || tagName === "a" || href) ? "category_url" : "field";

        setFields(prev => {
          const autoName = inferPurpose === "category_url" ? `URL Cat ${prev.length + 1}` : `Campo ${prev.length + 1}`;
          return [...prev, {
            id: crypto.randomUUID(),
            name: autoName,
            selector, type,
            preview: preview.substring(0, 200),
            isVariation: false,
            purpose: inferPurpose,
          }];
        });
        toast.success("Elemento selecionado!", { description: preview.substring(0, 80) });
      } else if (e.data?.type === "element-deselected") {
        setFields(prev => prev.filter(f => f.selector !== e.data.selector));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [fields.length, useFirecrawl]);

  /* ── Page loading ── */
  const loadPage = async (targetUrl: string, mode: "browse" | "select") => {
    if (!targetUrl.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("proxy-page", {
        body: { url: targetUrl.trim(), useFirecrawl, mode },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setHtmlContent(data.html);
      setCurrentUrl(data.sourceUrl);
      setPageTitle(data.metadata?.title || targetUrl);
      setIframeMode(mode);
      if (mode === "browse") {
        setNavHistory(prev => [...prev, data.sourceUrl]);
        if (step === "url") setStep("browse");
      }
    } catch (err: any) {
      toast.error("Erro ao carregar página", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleLoadUrl = () => loadPage(url, "browse");

  const handleGoBack = () => {
    if (navHistory.length > 1) {
      const prev = navHistory[navHistory.length - 2];
      setNavHistory(h => h.slice(0, -1));
      loadPage(prev, iframeMode);
    }
  };

  /* ── Extract links from a URL ── */
  const extractLinksFromPage = async (pageUrl: string): Promise<{ links: ExtractedLink[]; nextPages: string[] }> => {
    const { data: proxyData } = await supabase.functions.invoke("proxy-page", {
      body: { url: pageUrl, useFirecrawl, mode: "browse" },
    });
    if (!proxyData?.html) return { links: [], nextPages: [] };

    const parser = new DOMParser();
    const doc = parser.parseFromString(proxyData.html, "text/html");
    const anchors = doc.querySelectorAll("a[href]");
    const baseUrl = new URL(pageUrl);
    const links: ExtractedLink[] = [];
    const seen = new Set<string>();
    let hasContentLinks = false;

    anchors.forEach(a => {
      try {
        const href = a.getAttribute("href") || "";
        if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
        const fullUrl = canonicalizeUrl(new URL(href, pageUrl).href);
        if (seen.has(fullUrl) || fullUrl === canonicalizeUrl(pageUrl)) return;
        seen.add(fullUrl);
        if (new URL(fullUrl).hostname !== baseUrl.hostname) return;

        const linkType = classifyLink(a, fullUrl);
        if (linkType === 'navigation') return;
        if (linkType === 'product' || linkType === 'category') hasContentLinks = true;

        const cleanText = (a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "")
          .trim().replace(/\s+/g, ' ').substring(0, 120);

        const inferredType: LinkType = linkType === 'product'
          ? 'produto'
          : GROUP_URL_HINT.test(fullUrl.toLowerCase()) ? 'grupo' : 'categoria';

        links.push({ url: fullUrl, text: cleanText, selected: linkType !== 'other', linkType: inferredType });
      } catch { /* ignore */ }
    });

    const cleanedLinks = hasContentLinks ? links.filter(l => l.linkType !== 'outro') : links;

    // Detect pagination
    const paginationSelectors = [
      'a.next', 'a.next-page', '.pagination a', 'nav.pagination a', 'a[rel="next"]',
      '.woocommerce-pagination a', '.page-numbers a', 'a[aria-label*="next" i]',
      'a[aria-label*="próx" i]', 'a[aria-label*="seguinte" i]',
      '.pager a', '.paging a', 'ul.pages a', '.paginator a',
      '.pagination-list a', '.nav-links a', '.page-link',
      'a[title*="next" i]', 'a[title*="Next" i]', 'a[title*="Last" i]',
    ];
    const nextPages: string[] = [];
    const seenPages = new Set<string>();
    paginationSelectors.forEach(sel => {
      try {
        doc.querySelectorAll(sel).forEach(el => {
          const href = el.getAttribute("href");
          if (href) {
            try {
              const full = new URL(href, baseUrl.origin).href;
              if (!seenPages.has(full) && full !== pageUrl) { seenPages.add(full); nextPages.push(full); }
            } catch { /* ignore */ }
          }
        });
      } catch { /* ignore */ }
    });

    // Fallback pagination detection
    if (nextPages.length === 0) {
      doc.querySelectorAll("a[href]").forEach(a => {
        const text = (a.textContent || "").trim().toLowerCase();
        const href = a.getAttribute("href");
        if (!href) return;
        const isPageLink = /^(next|suivant|próxima?|seguinte|last|›|»|\d+)$/i.test(text)
          || /[?&]page=\d/i.test(href)
          || /\/page\/\d/i.test(href)
          || /[?&]p=\d/i.test(href);
        if (isPageLink) {
          try {
            const full = new URL(href, baseUrl.origin).href;
            if (!seenPages.has(full) && full !== pageUrl && new URL(full).hostname === baseUrl.hostname) {
              seenPages.add(full); nextPages.push(full);
            }
          } catch { /* ignore */ }
        }
      });
    }

    return { links: cleanedLinks, nextPages };
  };

  /* ── Step: Browse → Extract links → Categories ── */
  const handleExtractLinks = async () => {
    setLoading(true);
    try {
      const { links, nextPages } = await extractLinksFromPage(currentUrl);
      setCurrentLinks(links);
      setLayers([{
        label: pageTitle || currentUrl,
        links,
        sourceUrl: currentUrl,
        hasPagination: nextPages.length > 0,
        paginationUrls: nextPages,
      }]);
      setStep("categories");
      const cats = links.filter(l => l.linkType === "categoria" || l.linkType === "grupo").length;
      const prods = links.filter(l => l.linkType === "produto").length;
      toast.success(`${links.length} links (${cats} categorias · ${prods} produtos)`);
    } catch (err: any) {
      toast.error("Erro ao extrair links", { description: err.message });
    } finally { setLoading(false); }
  };

  /* ── Accumulate products from currentLinks into productUrls ── */
  const accumulateCurrentProducts = () => {
    // Accumulate ALL links typed as "produto", not just selected ones
    const prods = currentLinks.filter(l => l.linkType === "produto");
    if (prods.length > 0) {
      setProductUrls(prev => {
        const existing = new Set(prev);
        const newUrls = prods.map(l => l.url).filter(u => !existing.has(u));
        if (newUrls.length > 0) toast.info(`${newUrls.length} produtos acumulados do nível atual`);
        return [...prev, ...newUrls];
      });
    }
  };

  /* ── Drill into selected categories ── */
  const handleDrillInto = async (urls: string[]) => {
    if (urls.length === 0) { toast.error("Selecione pelo menos uma categoria."); return; }
    // Accumulate products from current level before drilling
    accumulateCurrentProducts();
    setLoading(true);
    try {
      const allLinks: ExtractedLink[] = [];
      const allNextPages: string[] = [];
      const seen = new Set<string>();

      for (let i = 0; i < urls.length; i += 5) {
        const batch = urls.slice(i, i + 5);
        const results = await Promise.allSettled(batch.map(u => extractLinksFromPage(u)));
        results.forEach(r => {
          if (r.status === "fulfilled") {
            r.value.links.forEach(link => {
              if (!seen.has(link.url)) { seen.add(link.url); allLinks.push(link); }
            });
            r.value.nextPages.forEach(p => { if (!seen.has(p)) { seen.add(p); allNextPages.push(p); } });
          }
        });
        if (urls.length > 5) toast.info(`Progresso: ${Math.min(i + 5, urls.length)}/${urls.length}`);
      }

      const newLayer: SiteLayer = {
        label: `Nível ${layers.length + 1} (${urls.length} páginas)`,
        links: allLinks,
        sourceUrl: urls[0],
        hasPagination: allNextPages.length > 0,
        paginationUrls: allNextPages,
      };

      setLayers(prev => [...prev, newLayer]);
      setCurrentLinks(allLinks);
      toast.success(`${allLinks.length} links de ${urls.length} páginas`);
    } catch (err: any) {
      toast.error("Erro ao explorar", { description: err.message });
    } finally { setLoading(false); }
  };

  /* ── Follow pagination ── */
  const handleFollowPagination = async () => {
    const currentLayer = layers[layers.length - 1];
    if (!currentLayer) return;
    setLoading(true);
    try {
      let remaining = [...currentLayer.paginationUrls];
      const crawled = new Set<string>();
      const existingUrls = new Set(currentLinks.map(l => l.url));
      let newLinks: ExtractedLink[] = [];
      let totalNew = 0;

      // If using manual pattern, generate pagination URLs
      if (paginationMode === "pattern" && paginationPattern && remaining.length === 0) {
        remaining = generatePaginationUrls(currentLayer.sourceUrl, paginationPattern, maxPagesPerCategory);
      }

      while (remaining.length > 0 && crawled.size < maxPagesPerCategory) {
        const targetUrl = remaining.shift()!;
        if (crawled.has(targetUrl)) continue;
        crawled.add(targetUrl);

        const { links, nextPages } = await extractLinksFromPage(targetUrl);
        const unique = links.filter(l => !existingUrls.has(l.url));
        
        // Stop if no new links found (empty page)
        if (unique.length === 0 && crawled.size > 1) break;
        
        unique.forEach(l => existingUrls.add(l.url));
        newLinks = [...newLinks, ...unique];
        totalNew += unique.length;

        // Add discovered next pages
        if (paginationMode === "auto") {
          nextPages.forEach(p => { if (!crawled.has(p) && !remaining.includes(p)) remaining.push(p); });
        }
      }

      setCurrentLinks(prev => [...prev, ...newLinks]);
      setLayers(prev => {
        const updated = [...prev];
        const last = { ...updated[updated.length - 1] };
        last.links = [...last.links, ...newLinks];
        last.paginationUrls = remaining;
        last.hasPagination = remaining.length > 0;
        updated[updated.length - 1] = last;
        return updated;
      });

      toast.success(`+${totalNew} links de ${crawled.size} páginas de paginação`);
    } catch (err: any) {
      toast.error("Erro na paginação", { description: err.message });
    } finally { setLoading(false); }
  };

  /* ── Collect products → Products step (accumulates, doesn't replace) ── */
  const handleCollectProducts = () => {
    const prods = currentLinks.filter(l => l.linkType === "produto" && l.selected).map(l => l.url);
    if (prods.length === 0 && productUrls.length === 0) { toast.error("Nenhum produto selecionado."); return; }
    setProductUrls(prev => {
      const existing = new Set(prev);
      const newUrls = prods.filter(u => !existing.has(u));
      const total = prev.length + newUrls.length;
      toast.success(`${total} URLs de produto (${newUrls.length} novas + ${prev.length} acumuladas)`);
      return [...prev, ...newUrls];
    });
    setStep("products");
  };

  /* ── Generate pagination URLs from a pattern ── */
  const generatePaginationUrls = (baseUrl: string, pattern: string, maxPages: number): string[] => {
    const urls: string[] = [];
    for (let n = 2; n <= maxPages; n++) {
      const pageStr = pattern.replace(/\{n\}/g, String(n));
      try {
        const base = new URL(baseUrl);
        if (pageStr.startsWith("?") || pageStr.startsWith("&")) {
          // Query param pattern: ?page={n}
          const paramParts = pageStr.replace(/^[?&]/, "").split("=");
          if (paramParts.length === 2) {
            base.searchParams.set(paramParts[0], paramParts[1]);
          }
          urls.push(base.toString());
        } else if (pageStr.startsWith("/")) {
          // Path pattern: /page/{n}/
          const cleanBase = base.pathname.replace(/\/+$/, "");
          base.pathname = cleanBase + pageStr;
          urls.push(base.toString());
        } else {
          // Just append
          urls.push(baseUrl.replace(/\/$/, "") + pageStr);
        }
      } catch {
        urls.push(baseUrl.replace(/\/$/, "") + pageStr);
      }
    }
    return urls;
  };

  /* ── Auto-detect pagination pattern from a page ── */
  const autoDetectPaginationPattern = (nextPages: string[], baseUrl: string): string | null => {
    if (nextPages.length === 0) return null;
    try {
      const base = new URL(baseUrl);
      for (const np of nextPages) {
        const page = new URL(np);
        // Check query params
        for (const [key, val] of page.searchParams.entries()) {
          if (/^\d+$/.test(val) && !base.searchParams.has(key)) {
            return `?${key}={n}`;
          }
        }
        // Check path segments
        const baseParts = base.pathname.split("/").filter(Boolean);
        const pageParts = page.pathname.split("/").filter(Boolean);
        if (pageParts.length > baseParts.length) {
          const diff = pageParts.slice(baseParts.length);
          if (diff.length === 1 && /^\d+$/.test(diff[0])) {
            return `/page/{n}`;
          }
          if (diff.length === 2 && diff[0] === "page" && /^\d+$/.test(diff[1])) {
            return `/page/{n}/`;
          }
        }
      }
    } catch { /* ignore */ }
    return null;
  };

  /* ── Recursive crawl: collects all product URLs from categories, subcategories, with pagination ── */
  const crawlCategoryRecursive = async (
    catUrl: string,
    catLabel: string,
    depth: number,
    seen: Set<string>,
    allProductUrls: string[],
    stats: CrawlStats,
  ): Promise<void> => {
    if (depth > maxCrawlDepth) return;
    stats.maxDepthReached = Math.max(stats.maxDepthReached, depth);

    const crawledPages = new Set<string>();
    let pageUrl: string | null = catUrl;
    let detectedPattern: string | null = null;
    let patternGenerated = false;

    while (pageUrl && crawledPages.size < maxPagesPerCategory) {
      crawledPages.add(pageUrl);
      stats.pagesProcessed++;
      setCollectProgress({
        current: stats.categoriesProcessed,
        total: stats.categoriesProcessed + 1,
        label: `${catLabel} (pág ${crawledPages.size}, profundidade ${depth})`,
        pages: stats.pagesProcessed,
      });

      try {
        const { links, nextPages } = await extractLinksFromPage(pageUrl);

        // Separate products and subcategories
        const productLinks = links.filter(l => l.linkType === "produto");
        const subCategoryLinks = links.filter(l => l.linkType === "categoria" || l.linkType === "grupo");

        // Collect products from this page
        const productsBefore = allProductUrls.length;
        productLinks.forEach(l => {
          if (!seen.has(l.url)) { seen.add(l.url); allProductUrls.push(l.url); }
        });
        const newProds = allProductUrls.length - productsBefore;
        stats.productsFound = allProductUrls.length;

        // If this page has subcategories but NO products, it's a subcategory listing page — drill deeper
        if (subCategoryLinks.length > 0 && productLinks.length === 0 && depth < maxCrawlDepth) {
          stats.subcategoriesFound += subCategoryLinks.length;
          for (const sub of subCategoryLinks) {
            if (!seen.has(`__cat__${sub.url}`)) {
              seen.add(`__cat__${sub.url}`);
              stats.categoriesProcessed++;
              const subLabel = sub.text || `Sub ${stats.categoriesProcessed}`;
              setCollectProgress({
                current: stats.categoriesProcessed,
                total: stats.categoriesProcessed + subCategoryLinks.length,
                label: `↳ ${subLabel} (profundidade ${depth + 1})`,
                pages: stats.pagesProcessed,
              });
              await crawlCategoryRecursive(sub.url, subLabel, depth + 1, seen, allProductUrls, stats);
            }
          }
          // After drilling subcategories, don't continue pagination on this level
          break;
        }

        // If this page has BOTH products AND subcategories, collect products AND drill subcategories
        if (subCategoryLinks.length > 0 && productLinks.length > 0 && depth < maxCrawlDepth) {
          stats.subcategoriesFound += subCategoryLinks.length;
          for (const sub of subCategoryLinks) {
            if (!seen.has(`__cat__${sub.url}`)) {
              seen.add(`__cat__${sub.url}`);
              stats.categoriesProcessed++;
              const subLabel = sub.text || `Sub ${stats.categoriesProcessed}`;
              await crawlCategoryRecursive(sub.url, subLabel, depth + 1, seen, allProductUrls, stats);
            }
          }
        }

        // If no new products found on a pagination page, stop
        if (crawledPages.size > 1 && newProds === 0) break;

        // Determine next page (pagination)
        let nextPage: string | null = null;
        if (paginationMode === "pattern" && paginationPattern) {
          if (!patternGenerated) {
            const paginationUrls = generatePaginationUrls(catUrl, paginationPattern, maxPagesPerCategory);
            paginationUrls.forEach(u => { if (!crawledPages.has(u)) nextPages.push(u); });
            patternGenerated = true;
          }
          nextPage = nextPages.find(p => !crawledPages.has(p)) || null;
        } else {
          if (!detectedPattern && nextPages.length > 0) {
            detectedPattern = autoDetectPaginationPattern(nextPages, catUrl);
          }
          nextPage = nextPages.find(p => !crawledPages.has(p)) || null;
          if (!nextPage && detectedPattern && crawledPages.size < maxPagesPerCategory) {
            const generatedUrls = generatePaginationUrls(catUrl, detectedPattern, maxPagesPerCategory);
            nextPage = generatedUrls.find(u => !crawledPages.has(u)) || null;
          }
        }

        pageUrl = nextPage;
      } catch (err) {
        logger.warn(`Erro na página ${pageUrl}:`, { error: err });
        break;
      }
    }
  };

  /* ── Auto-collect: drill all categories recursively with full pagination ── */
  const handleAutoCollect = async () => {
    // Auto-select ALL categories if none are manually selected
    let catUrls = currentLinks.filter(l => (l.linkType === "categoria" || l.linkType === "grupo" || l.linkType === "subcategoria") && l.selected).map(l => l.url);
    
    if (catUrls.length === 0) {
      // No manual selection — use ALL categories/groups/subcategories automatically
      catUrls = currentLinks.filter(l => l.linkType === "categoria" || l.linkType === "grupo" || l.linkType === "subcategoria").map(l => l.url);
    }
    
    if (catUrls.length === 0 && currentLinks.filter(l => l.linkType === "produto").length === 0) {
      toast.error("Nenhuma categoria ou produto encontrado.");
      return;
    }

    setLoading(true);
    const stats: CrawlStats = { categoriesProcessed: 0, subcategoriesFound: 0, pagesProcessed: 0, productsFound: 0, maxDepthReached: 0 };
    setCollectProgress({ current: 0, total: catUrls.length || 1, label: "A iniciar...", pages: 0 });
    setCrawlStats(null);

    try {
      const allProductUrls: string[] = [...productUrls]; // Start with already accumulated products
      const seen = new Set<string>(allProductUrls);

      // Add ALL product-typed links from current level (not just selected)
      currentLinks.filter(l => l.linkType === "produto").forEach(l => {
        if (!seen.has(l.url)) { seen.add(l.url); allProductUrls.push(l.url); }
      });
      stats.productsFound = allProductUrls.length;

      // Recursively crawl each top-level category
      for (let i = 0; i < catUrls.length; i++) {
        const catUrl = catUrls[i];
        const catLabel = currentLinks.find(l => l.url === catUrl)?.text || `Cat ${i + 1}`;
        stats.categoriesProcessed++;
        seen.add(`__cat__${catUrl}`);
        
        await crawlCategoryRecursive(catUrl, catLabel, 1, seen, allProductUrls, stats);
      }

      setProductUrls(allProductUrls);
      setCrawlStats(stats);
      setCollectProgress(null);
      setStep("products");
      toast.success(
        `${allProductUrls.length} produtos de ${stats.categoriesProcessed} categorias` +
        (stats.subcategoriesFound > 0 ? ` (${stats.subcategoriesFound} subcategorias)` : '') +
        ` · ${stats.pagesProcessed} páginas · profundidade máx ${stats.maxDepthReached}`
      );
    } catch (err: any) {
      toast.error("Erro na recolha automática", { description: err.message });
    } finally {
      setLoading(false);
      setCollectProgress(null);
    }
  };

  /* ── Category agent dialog ── */
  const openCategoryAgentDialog = () => {
    const cats = currentLinks.filter(l => l.linkType === "categoria" || l.linkType === "grupo");
    if (cats.length === 0) { toast.error("Não existem categorias/grupos para explorar."); return; }
    setCategoryAgentSelection(prev => {
      const next = { ...prev };
      cats.forEach(link => { if (!(link.url in next)) next[link.url] = true; });
      return next;
    });
    setShowCategoryAgentDialog(true);
  };

  const handleRunCategoryAgentFlow = async () => {
    const selectedUrls = Object.entries(categoryAgentSelection).filter(([, s]) => s).map(([url]) => url);
    if (selectedUrls.length === 0) { toast.error("Selecione pelo menos uma categoria."); return; }
    setShowCategoryAgentDialog(false);
    await handleDrillInto(selectedUrls);
  };

  /* ── Open a product page for field selection ── */
  const handleOpenProductForFields = (productUrl?: string) => {
    const target = productUrl || productUrls[0];
    if (!target) return;
    loadPage(target, "select");
    setStep("fields");
  };

  /* ── Auto-detect fields ── */
  const handleAutoDetectFields = () => {
    if (!htmlContent) return;
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    const detected: SelectedField[] = [];

    for (const spec of FIELD_DETECTION_RULES) {
      for (const sel of spec.selectors) {
        try {
          const el = doc.querySelector(sel);
          if (el) {
            let preview = "";
            if (spec.type === "image") preview = el.getAttribute("src") || el.querySelector("img")?.getAttribute("src") || "";
            else preview = (el.textContent || "").trim().substring(0, 200);
            if (preview && preview.length > 1) {
              detected.push({ id: crypto.randomUUID(), name: spec.name, selector: sel, type: spec.type, preview, isVariation: spec.isVariation || false, purpose: "field" });
              break;
            }
          }
        } catch { /* invalid selector */ }
      }
    }

    if (detected.length > 0) {
      setFields(prev => {
        const existing = new Set(prev.map(f => f.name));
        return [...prev, ...detected.filter(d => !existing.has(d.name))];
      });
      toast.success(`${detected.length} campos detetados automaticamente!`);
    } else {
      toast.info("Não foi possível detetar campos. Selecione-os manualmente clicando nos elementos.");
    }
  };

  /* ── AI Hybrid: Use AI to analyze fields then extract with free fetch ── */
  const handleAiAnalyzeFields = async () => {
    if (!htmlContent && productUrls.length === 0) { toast.error("Carregue uma página primeiro."); return; }
    setLoading(true);
    try {
      const samplePages: { url: string; html: string; isProduct?: boolean }[] = [];
      if (htmlContent) samplePages.push({ url: currentUrl, html: htmlContent, isProduct: true });

      const extraUrls = productUrls.filter(u => u !== currentUrl).slice(0, 2);
      for (const extraUrl of extraUrls) {
        try {
          const { data } = await supabase.functions.invoke("proxy-page", { body: { url: extraUrl, useFirecrawl: false, mode: "browse" } });
          if (data?.html) samplePages.push({ url: extraUrl, html: data.html, isProduct: true });
        } catch { /* skip */ }
      }

      const { data: aiResult, error: aiError } = await supabase.functions.invoke("analyze-product-page", {
        body: { sampleHtmlPages: samplePages, mode: "fields" },
      });
      if (aiError) throw aiError;
      if (aiResult?.error) throw new Error(aiResult.error);

      const analysis = aiResult.analysis;
      if (analysis?.fields?.length > 0) {
        const aiFields: SelectedField[] = analysis.fields.map((f: any) => ({
          id: crypto.randomUUID(), name: f.name || "Campo", selector: f.selector,
          type: f.type || "text", preview: f.sample_value || "", isVariation: false,
          purpose: "field" as FieldPurpose, confidence: f.confidence || 0.5,
        }));
        setFields(prev => {
          const existing = new Set(prev.map(ff => ff.name));
          return [...prev, ...aiFields.filter(d => !existing.has(d.name))];
        });
        toast.success(`IA: ${aiFields.length} campos detetados com confiança`);
      }
    } catch (err: any) {
      toast.error("Erro na análise IA", { description: err.message });
    } finally { setLoading(false); }
  };

  /* ── AI Hybrid: Filter non-product URLs ── */
  const handleAiFilterProducts = async () => {
    if (productUrls.length === 0) { toast.error("Nenhum URL para filtrar."); return; }
    setLoading(true);
    try {
      const samplesToTest = productUrls.slice(0, 10);
      const samplePages: { url: string; html: string }[] = [];
      for (const testUrl of samplesToTest) {
        try {
          const { data } = await supabase.functions.invoke("proxy-page", { body: { url: testUrl, useFirecrawl: false, mode: "browse" } });
          if (data?.html) samplePages.push({ url: testUrl, html: data.html });
        } catch { /* skip */ }
      }

      const { data: aiResult, error: aiError } = await supabase.functions.invoke("analyze-product-page", {
        body: { sampleHtmlPages: samplePages, mode: "fingerprint" },
      });
      if (aiError) throw aiError;

      const fingerprint = aiResult?.analysis?.fingerprint;
      if (!fingerprint?.product_indicators?.length) {
        toast.info("Não foi possível criar fingerprint automático.");
        setLoading(false); return;
      }

      const validProductUrls: string[] = [];
      const removedUrls: string[] = [];

      for (let i = 0; i < productUrls.length; i += 5) {
        const batch = productUrls.slice(i, i + 5);
        setCollectProgress({ current: i + batch.length, total: productUrls.length, label: "A filtrar não-produtos..." });

        const results = await Promise.allSettled(batch.map(async (testUrl) => {
          try {
            const { data } = await supabase.functions.invoke("proxy-page", { body: { url: testUrl, useFirecrawl: false, mode: "browse" } });
            if (!data?.html) return { url: testUrl, isProduct: false };
            const parser = new DOMParser();
            const doc = parser.parseFromString(data.html, "text/html");
            let productScore = 0, totalWeight = 0;
            for (const ind of fingerprint.product_indicators) {
              const weight = ind.confidence || 0.5;
              totalWeight += weight;
              try {
                if (ind.type === "selector" && doc.querySelector(ind.pattern)) productScore += weight;
                else if (ind.type === "text" && data.html.toLowerCase().includes(ind.pattern.toLowerCase())) productScore += weight;
              } catch { /* skip */ }
            }
            return { url: testUrl, isProduct: totalWeight > 0 ? productScore / totalWeight >= 0.4 : true };
          } catch { return { url: testUrl, isProduct: true }; }
        }));

        results.forEach(r => {
          if (r.status === "fulfilled") {
            if (r.value.isProduct) validProductUrls.push(r.value.url);
            else removedUrls.push(r.value.url);
          }
        });
      }

      setProductUrls(validProductUrls);
      setCollectProgress(null);
      toast.success(`Filtro IA: ${removedUrls.length} não-produtos removidos, ${validProductUrls.length} mantidos`);
    } catch (err: any) {
      toast.error("Erro no filtro IA", { description: err.message });
    } finally { setLoading(false); setCollectProgress(null); }
  };

  /* ── Field management ── */
  const handleRemoveField = (id: string) => setFields(prev => prev.filter(f => f.id !== id));
  const handleUpdateFieldName = (id: string, name: string) => setFields(prev => prev.map(f => f.id === id ? { ...f, name } : f));
  const handleUpdateFieldType = (id: string, type: SelectedField["type"]) => setFields(prev => prev.map(f => f.id === id ? { ...f, type } : f));
  const handleUpdateFieldSelector = (id: string, selector: string) => setFields(prev => prev.map(f => f.id === id ? { ...f, selector } : f));
  const handleToggleVariation = (id: string) => setFields(prev => prev.map(f => f.id === id ? { ...f, isVariation: !f.isVariation } : f));
  const handleUpdateFieldPurpose = (id: string, purpose: FieldPurpose) => setFields(prev => prev.map(f => f.id === id ? { ...f, purpose } : f));

  /* ── Push selected URL fields into categories/products workflow ── */
  const handleUseCategoryUrls = () => {
    const catFields = fields.filter(f => f.purpose === "category_url" && f.preview);
    if (catFields.length === 0) { toast.error("Nenhum URL de categoria selecionado."); return; }
    const links: ExtractedLink[] = catFields.map(f => ({
      url: f.preview.startsWith("http") ? f.preview : `${new URL(currentUrl).origin}${f.preview}`,
      text: f.name,
      selected: true,
      linkType: "categoria" as LinkType,
    }));
    setCurrentLinks(links);
    setLayers([{ label: pageTitle || currentUrl, links, sourceUrl: currentUrl, hasPagination: false, paginationUrls: [] }]);
    // Keep only extraction fields
    setFields(prev => prev.filter(f => f.purpose === "field"));
    setStep("categories");
    toast.success(`${links.length} URLs de categoria adicionadas`);
  };

  /* ── Drill into a single category URL from the fields panel ── */
  const handleDrillCategoryField = async (fieldUrl: string, fieldName: string) => {
    const resolvedUrl = fieldUrl.startsWith("http") ? fieldUrl : `${new URL(currentUrl).origin}${fieldUrl}`;
    // Accumulate products before drilling
    accumulateCurrentProducts();
    setLoading(true);
    try {
      const { links, nextPages } = await extractLinksFromPage(resolvedUrl);
      setCurrentLinks(links);
      setLayers([{
        label: fieldName || resolvedUrl,
        links,
        sourceUrl: resolvedUrl,
        hasPagination: nextPages.length > 0,
        paginationUrls: nextPages,
      }]);
      // Keep only extraction fields, remove used category URLs
      setFields(prev => prev.filter(f => f.purpose === "field"));
      setStep("categories");
      const cats = links.filter(l => l.linkType === "categoria" || l.linkType === "grupo").length;
      const prods = links.filter(l => l.linkType === "produto").length;
      toast.success(`${fieldName}: ${links.length} links (${cats} categorias · ${prods} produtos)`);
    } catch (err: any) {
      toast.error("Erro ao explorar categoria", { description: err.message });
    } finally { setLoading(false); }
  };

  const handleUseProductUrls = () => {
    const prodFields = fields.filter(f => f.purpose === "product_url" && f.preview);
    if (prodFields.length === 0) { toast.error("Nenhum URL de produto selecionado."); return; }
    const urls = prodFields.map(f => f.preview.startsWith("http") ? f.preview : `${new URL(currentUrl).origin}${f.preview}`);
    setProductUrls(urls);
    setFields(prev => prev.filter(f => f.purpose === "field"));
    setStep("products");
    toast.success(`${urls.length} URLs de produto adicionadas`);
  };

  /* ── Run batch extraction ── */
  const handleRunExtraction = async () => {
    if (fields.length === 0) { toast.error("Defina pelo menos um campo."); return; }
    const urls = productUrls.length > 0 ? productUrls : [currentUrl];
    setBatchLoading(true);
    setStep("extract");

    try {
      const allResults: ExtractedRow[] = [];
      const allErrors: any[] = [];

      for (let i = 0; i < urls.length; i += 5) {
        const chunk = urls.slice(i, i + 5);
        setCollectProgress({ current: i + chunk.length, total: urls.length });

        const { data, error } = await supabase.functions.invoke("scrape-with-selectors", {
          body: {
            urls: chunk,
            fields: fields.map(f => ({ name: f.name, selector: f.selector, type: f.type, isVariation: f.isVariation })),
            workspaceId: activeWorkspace?.id,
            useFirecrawl,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        allResults.push(...(data.results || []));
        allErrors.push(...(data.errors || []));

        if (urls.length > 5) toast.info(`Progresso: ${Math.min(i + 5, urls.length)}/${urls.length} páginas...`);
      }

      setResults(allResults);
      setErrors(allErrors);
      setCollectProgress(null);
      setStep("results");
      const costMsg = useFirecrawl ? "(modo premium)" : "(gratuito)";
      toast.success(`${allResults.length} produtos extraídos ${costMsg}`);
    } catch (err: any) {
      toast.error("Erro na extração", { description: err.message });
    } finally {
      setBatchLoading(false);
      setCollectProgress(null);
    }
  };

  /* ── Export Excel ── */
  const handleExportExcel = () => {
    if (results.length === 0) return;
    import("xlsx").then(XLSX => {
      const ws = XLSX.utils.json_to_sheet(results);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Scrape Results");
      XLSX.writeFile(wb, "scrape-results.xlsx");
    });
  };

  /* ── Send to ingestion ── */
  const handleSendToProducts = async () => {
    if (!activeWorkspace?.id || results.length === 0) return;
    if (!Object.values(scraperMapping).includes("title")) { toast.error("Mapeie pelo menos o Título."); return; }
    setBatchLoading(true);
    try {
      const { data: job, error: jobError } = await supabase
        .from("ingestion_jobs")
        .insert({
          workspace_id: activeWorkspace.id,
          user_id: (await supabase.auth.getUser()).data.user?.id,
          source_type: "api" as any,
          source_ref: currentUrl,
          status: "pending" as any,
          config: { type: "visual_scraper", fields: fields.map(f => f.name), mapping: scraperMapping },
        } as any)
        .select("id")
        .single();
      if (jobError) throw jobError;

      const items = results.map((row, idx) => {
        const mapped: Record<string, string> = {};
        Object.entries(scraperMapping).forEach(([k, v]) => { if (v && v !== "__ignore__" && row[k]) mapped[v] = row[k]; });
        return { job_id: job.id, item_index: idx, source_data: row, mapped_data: mapped, status: "pending" as any };
      });

      for (let i = 0; i < items.length; i += 50) {
        await supabase.from("ingestion_job_items").insert(items.slice(i, i + 50) as any);
      }

      toast.success(`Job de ingestão criado com ${results.length} itens!`);
      setShowSendDialog(false);
    } catch (err: any) {
      toast.error("Erro ao criar job", { description: err.message });
    } finally { setBatchLoading(false); }
  };

  /* ── URL import ── */
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const urls = text.split(/[\r\n,;]+/).map(u => u.trim().replace(/^["']|["']$/g, ""))
        .filter(u => u.startsWith("http://") || u.startsWith("https://"));
      if (urls.length === 0) { toast.error("Nenhum URL encontrado."); return; }
      setProductUrls(urls);
      setStep("products");
      toast.success(`${urls.length} URLs importadas`);
    } catch (err: any) {
      toast.error("Erro ao ler ficheiro", { description: err.message });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleManualUrlImport = () => {
    const urls = manualUrls.split(/[\r\n,;]+/).map(u => u.trim())
      .filter(u => u.startsWith("http://") || u.startsWith("https://"));
    if (urls.length === 0) { toast.error("Nenhum URL válido encontrado."); return; }
    const existing = new Set(productUrls);
    const newUrls = urls.filter(u => !existing.has(u));
    setProductUrls(prev => [...prev, ...newUrls]);
    setManualUrls("");
    setStep("products");
    toast.success(`${newUrls.length} URLs adicionadas.`);
  };

  /* ── Pattern detection ── */
  const detectUrlPatterns = () => {
    const patternMap = new Map<string, { urls: string[]; sample: string }>();
    currentLinks.forEach(link => {
      try {
        const u = new URL(link.url);
        const segments = u.pathname.split("/").map(seg => {
          if (/^\d+$/.test(seg)) return "{id}";
          if (/^[0-9a-f]{8}-/.test(seg)) return "{uuid}";
          return seg;
        });
        const pattern = u.hostname + segments.join("/");
        if (!patternMap.has(pattern)) patternMap.set(pattern, { urls: [], sample: link.url });
        patternMap.get(pattern)!.urls.push(link.url);
      } catch { /* ignore */ }
    });

    setUrlPatterns(
      Array.from(patternMap.entries())
        .map(([pattern, { urls, sample }]) => ({ pattern, count: urls.length, sample, selected: false }))
        .sort((a, b) => b.count - a.count)
    );
    setShowPatternDialog(true);
  };

  const applyPatternSelection = () => {
    const selectedPatterns = new Set(urlPatterns.filter(p => p.selected).map(p => p.pattern));
    if (selectedPatterns.size === 0) { toast.error("Selecione pelo menos um padrão."); return; }
    setCurrentLinks(prev => prev.map(link => {
      try {
        const u = new URL(link.url);
        const segments = u.pathname.split("/").map(seg => {
          if (/^\d+$/.test(seg)) return "{id}";
          if (/^[0-9a-f]{8}-/.test(seg)) return "{uuid}";
          return seg;
        });
        const pattern = u.hostname + segments.join("/");
        return { ...link, selected: selectedPatterns.has(pattern) };
      } catch { return link; }
    }));
    setShowPatternDialog(false);
    toast.success(`URLs filtradas por ${selectedPatterns.size} padrão(ões).`);
  };

  /* ── Helpers ── */
  const toggleLink = (url: string) => setCurrentLinks(prev => prev.map(l => l.url === url ? { ...l, selected: !l.selected } : l));
  const changeLinkType = (url: string, type: LinkType) => setCurrentLinks(prev => prev.map(l => l.url === url ? { ...l, linkType: type } : l));
  const removeProductUrl = (url: string) => setProductUrls(prev => prev.filter(u => u !== url));

  const categoryLinks = currentLinks.filter(l => l.linkType === "categoria" || l.linkType === "grupo" || l.linkType === "subcategoria");
  const productLinksInView = currentLinks.filter(l => l.linkType === "produto");
  const selectedCats = currentLinks.filter(l => (l.linkType === "categoria" || l.linkType === "grupo" || l.linkType === "subcategoria") && l.selected);
  const filteredLinks = currentLinks.filter(l => !linkFilter || l.url.toLowerCase().includes(linkFilter.toLowerCase()) || l.text.toLowerCase().includes(linkFilter.toLowerCase()));
  const currentLayer = layers[layers.length - 1];
  const categoryAgentCandidates = currentLinks.filter(l => l.linkType === "categoria" || l.linkType === "grupo" || l.linkType === "subcategoria");
  const selectedCategoryAgentCount = Object.values(categoryAgentSelection).filter(Boolean).length;

  const typeIcons: Record<string, React.ReactNode> = {
    text: <Type className="w-3 h-3" />, image: <ImageIcon className="w-3 h-3" />,
    link: <Link2 className="w-3 h-3" />, html: <FileText className="w-3 h-3" />,
  };

  /* ════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════ */
  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col gap-0">
      {/* Top toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background flex-shrink-0">
        <Globe className="w-5 h-5 text-primary" />
        <span className="font-semibold text-sm">Visual Scraper</span>

        {/* Step indicators */}
        <div className="flex gap-1 ml-3">
          {STEP_CONFIG.map(s => (
            <Badge key={s.key} variant={step === s.key ? "default" : "outline"} className="text-[10px] px-1.5 py-0">
              {s.label}
            </Badge>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {useFirecrawl ? (
            <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
              <Zap className="w-3 h-3 mr-1" /> Premium
            </Badge>
          ) : (
            <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px]">
              <Coins className="w-3 h-3 mr-1" /> Gratuito
            </Badge>
          )}
          <Switch checked={useFirecrawl} onCheckedChange={setUseFirecrawl} className="scale-75" />
        </div>
      </div>

      {/* ═══ STEP: URL Entry ═══ */}
      {step === "url" && (
        <ScrollArea className="flex-1">
          <div className="flex flex-col items-center gap-6 p-4">
            <Card className="max-w-2xl w-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Navigation className="w-5 h-5" />
                  Abrir Página do Fornecedor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Insira o URL da homepage ou página de categorias. Vai poder navegar, identificar as camadas de categorias, recolher URLs de produtos e depois definir os campos a extrair.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://fornecedor.com/produtos"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleLoadUrl()}
                      className="font-mono text-sm"
                    />
                    <Button onClick={handleLoadUrl} disabled={loading || !url.trim()}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                      <span className="ml-1">Abrir</span>
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-3 flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    Ou importe URLs de produtos diretamente
                  </p>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" onChange={handleFileImport} className="hidden" />
                      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="w-4 h-4 mr-1" /> Importar CSV/Excel
                      </Button>
                      <span className="text-xs text-muted-foreground self-center">Ficheiro com URLs (CSV, TXT)</span>
                    </div>
                    <div className="space-y-2">
                      <Textarea
                        placeholder={"Cole aqui URLs de produtos (um por linha):\nhttps://loja.com/produto-1\nhttps://loja.com/produto-2"}
                        value={manualUrls}
                        onChange={e => setManualUrls(e.target.value)}
                        rows={4}
                        className="font-mono text-xs"
                      />
                      <Button variant="secondary" size="sm" onClick={handleManualUrlImport} disabled={!manualUrls.trim()}>
                        <Plus className="w-3 h-3 mr-1" /> Adicionar URLs
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg p-3 bg-muted/30 space-y-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground text-sm">Fluxo por camadas:</p>
                  <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px]">1</Badge> Navegar o site e extrair links</div>
                  <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px]">2</Badge> Classificar links como categorias (níveis) ou produtos</div>
                  <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px]">3</Badge> Entrar nas categorias → marcar paginação → recolher produtos</div>
                  <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px]">4</Badge> Abrir um produto → selecionar/mapear campos visualmente</div>
                  <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px]">5</Badge> Executar extração em lote</div>
                </div>
              </CardContent>
            </Card>

            {/* Scraping Schedule Manager */}
            <div className="max-w-4xl w-full">
              <ScrapingScheduleManager />
            </div>
          </div>
        </ScrollArea>
      )}

      {/* ═══ STEP: Browse / Fields (iframe) ═══ */}
      {(step === "browse" || step === "fields") && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Browser chrome */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 flex-shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleGoBack} disabled={navHistory.length <= 1 || loading}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadPage(currentUrl, iframeMode)} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <div className="flex-1 flex items-center gap-2 bg-background border rounded-md px-3 py-1 text-xs font-mono text-muted-foreground truncate">
              {loading && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
              <span className="truncate">{currentUrl}</span>
            </div>
            <a href={currentUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="w-3.5 h-3.5" /></Button>
            </a>

            {/* Action buttons */}
            <div className="flex items-center gap-1 ml-2 border-l pl-2">
              {step === "browse" && (
                <>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExtractLinks} disabled={loading}>
                    <List className="w-3.5 h-3.5 mr-1" /> Extrair Links
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => { loadPage(currentUrl, "select"); setStep("fields"); }} disabled={loading}>
                    <MousePointerClick className="w-3.5 h-3.5 mr-1" /> Modo Seleção
                  </Button>
                </>
              )}
              {step === "fields" && (
                <>
                  <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-300">
                    <Crosshair className="w-3 h-3 mr-1" /> Modo Seleção
                  </Badge>
                  <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={handleAutoDetectFields} disabled={loading}>
                    <Wand2 className="w-3.5 h-3.5 mr-1" /> Auto-detetar
                  </Button>
                  {productUrls.length > 0 && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStep("products")}>
                      <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Voltar aos Produtos
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { loadPage(currentUrl, "browse"); setStep("browse"); }}>
                    <Navigation className="w-3.5 h-3.5 mr-1" /> Navegar
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 flex min-h-0">
            {/* Iframe */}
            <div className="flex-1 relative">
              <iframe
                ref={iframeRef}
                srcDoc={htmlContent}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin"
                title="Preview da página"
              />
              {step === "fields" && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-emerald-600 text-white px-4 py-1.5 rounded-full text-xs font-medium shadow-lg flex items-center gap-2 pointer-events-none">
                  <MousePointerClick className="w-3.5 h-3.5" />
                  Clique nos elementos que deseja extrair
                </div>
              )}
            </div>

            {/* Fields panel (only in fields step) */}
            {step === "fields" && (() => {
              const catCount = fields.filter(f => f.purpose === "category_url").length;
              const prodCount = fields.filter(f => f.purpose === "product_url").length;
              const fieldCount = fields.filter(f => f.purpose === "field").length;
              return (
              <div className="w-80 border-l flex flex-col bg-background flex-shrink-0">
                <div className="p-3 border-b space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Campos ({fields.length})</span>
                    <Button size="sm" className="h-7 text-xs" onClick={() => {
                      if (fields.length === 0) { toast.error("Selecione pelo menos um campo."); return; }
                      if (productUrls.length > 0) { setStep("products"); } else { handleRunExtraction(); }
                    }}>
                      Extrair <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>

                  {/* Action buttons for URLs */}
                  {(catCount > 0 || prodCount > 0) && (
                    <div className="flex flex-col gap-1.5">
                      {catCount > 0 && (
                        <Button size="sm" variant="secondary" className="h-7 text-xs w-full justify-start" onClick={handleUseCategoryUrls}>
                          <Layers className="w-3 h-3 mr-1" /> Usar {catCount} como Categorias →
                        </Button>
                      )}
                      {prodCount > 0 && (
                        <Button size="sm" variant="secondary" className="h-7 text-xs w-full justify-start" onClick={handleUseProductUrls}>
                          <Target className="w-3 h-3 mr-1" /> Usar {prodCount} como Produtos →
                        </Button>
                      )}
                    </div>
                  )}

                  {catCount === 0 && prodCount === 0 && fieldCount === 0 && fields.length === 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Clique nos links/elementos. Use o dropdown para classificar como URL de Categoria, Produto ou Campo.
                    </p>
                  )}
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-2">
                    {fields.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8 px-2">
                        Clique nos elementos da página para os adicionar. Classifique cada um como URL de Categoria, URL de Produto ou Campo de extração.
                      </p>
                    )}
                    {fields.map(f => (
                      <div key={f.id} className={`border rounded-lg p-2 space-y-1 ${f.purpose === "category_url" ? "border-blue-300 bg-blue-50/50 dark:bg-blue-950/20" : f.purpose === "product_url" ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20" : ""}`}>
                        <div className="flex items-center gap-1">
                          <Input value={f.name} onChange={e => handleUpdateFieldName(f.id, e.target.value)} className="h-6 text-xs font-medium flex-1" />
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleRemoveField(f.id)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>

                        {/* Purpose selector - key feature */}
                        <Select value={f.purpose} onValueChange={v => handleUpdateFieldPurpose(f.id, v as FieldPurpose)}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="category_url">
                              <span className="flex items-center gap-1"><Layers className="w-3 h-3 text-blue-500" /> URL de Categoria</span>
                            </SelectItem>
                            <SelectItem value="product_url">
                              <span className="flex items-center gap-1"><Target className="w-3 h-3 text-amber-500" /> URL de Produto</span>
                            </SelectItem>
                            <SelectItem value="field">
                              <span className="flex items-center gap-1"><Crosshair className="w-3 h-3 text-emerald-500" /> Campo de Extração</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                          {typeIcons[f.type]} {f.preview || "(vazio)"}
                        </p>

                        {f.purpose === "field" && (
                          <>
                            <div className="flex items-center gap-1">
                              <Select value={f.type} onValueChange={v => handleUpdateFieldType(f.id, v as any)}>
                                <SelectTrigger className="h-5 w-16 text-[10px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="text">Texto</SelectItem>
                                  <SelectItem value="image">Img</SelectItem>
                                  <SelectItem value="link">Link</SelectItem>
                                  <SelectItem value="html">HTML</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input value={f.selector} onChange={e => handleUpdateFieldSelector(f.id, e.target.value)} className="h-5 text-[9px] font-mono text-muted-foreground/60 flex-1" placeholder="Seletor CSS" />
                              <label className="flex items-center gap-1 cursor-pointer shrink-0">
                                <Checkbox checked={f.isVariation} onCheckedChange={() => handleToggleVariation(f.id)} className="h-3 w-3" />
                                <span className="text-[9px] text-muted-foreground">Var</span>
                              </label>
                            </div>
                          </>
                        )}

                        {f.purpose === "category_url" && (
                          <div className="flex items-center gap-1">
                            <p className="text-[9px] font-mono text-muted-foreground/60 truncate flex-1" title={f.selector}>{f.selector}</p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-5 text-[9px] px-1.5 shrink-0"
                              onClick={() => handleDrillCategoryField(f.preview, f.name)}
                              disabled={loading || !f.preview}
                              title="Entrar nesta categoria e ver sub-links"
                            >
                              {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <ChevronRight className="w-2.5 h-2.5" />}
                              Entrar
                            </Button>
                          </div>
                        )}

                        {f.purpose === "product_url" && (
                          <p className="text-[9px] font-mono text-muted-foreground/60 truncate" title={f.selector}>{f.selector}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <div className="p-2 border-t">
                  <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setFields(prev => [...prev, { id: crypto.randomUUID(), name: `Campo ${prev.length + 1}`, selector: "", type: "text", preview: "", isVariation: false, purpose: "field" }])}>
                    <Plus className="w-3 h-3 mr-1" /> Adicionar Campo Manual
                  </Button>
                </div>
                {fields.some(f => f.isVariation && f.purpose === "field") && (
                  <div className="p-2 border-t bg-muted/30">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Layers className="w-3 h-3" /> Campos "Variação" extraem múltiplos valores (separados por "|")
                    </p>
                  </div>
                )}
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ═══ STEP: Categories (layered) ═══ */}
      {step === "categories" && (
        <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
          {/* Header */}
          <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => {
              if (layers.length > 1) {
                const prev = layers.slice(0, -1);
                setLayers(prev);
                setCurrentLinks(prev[prev.length - 1].links);
              } else { setStep("browse"); }
            }}>
              <ArrowLeft className="w-3 h-3 mr-1" /> {layers.length > 1 ? "Nível Anterior" : "Voltar"}
            </Button>
            <h2 className="font-semibold text-sm">Estrutura do Site</h2>
            <Badge>{currentLinks.length} links</Badge>
            <Badge variant="outline" className="text-[10px]">{categoryLinks.length} categorias · {productLinksInView.length} produtos</Badge>
            {productUrls.length > 0 && (
              <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                <Target className="w-3 h-3 mr-1" /> {productUrls.length} produtos acumulados
              </Badge>
            )}
            {(productUrls.length > 0 || productLinksInView.filter(l => l.selected).length > 0) && (
              <Button size="sm" className="ml-auto h-7 text-xs" onClick={handleCollectProducts}>
                <ArrowRight className="w-3 h-3 mr-1" /> Avançar para Produtos ({productUrls.length + currentLinks.filter(l => l.linkType === "produto" && l.selected && !productUrls.includes(l.url)).length})
              </Button>
            )}
          </div>

          {/* Layer breadcrumbs */}
          {layers.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground border rounded-lg p-2 bg-muted/20 flex-shrink-0">
              <Layers className="w-3.5 h-3.5 mr-1" />
              {layers.map((layer, idx) => (
                <span key={idx} className="flex items-center gap-1">
                  {idx > 0 && <ChevronRight className="w-3 h-3" />}
                  <button
                    className={`hover:underline ${idx === layers.length - 1 ? "font-semibold text-foreground" : ""}`}
                    onClick={() => {
                      if (idx < layers.length - 1) {
                        const sliced = layers.slice(0, idx + 1);
                        setLayers(sliced);
                        setCurrentLinks(sliced[sliced.length - 1].links);
                      }
                    }}
                  >
                    {layer.label.length > 50 ? layer.label.substring(0, 50) + "…" : layer.label}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Actions panel */}
          <div className="flex flex-col gap-2 p-3 border rounded-lg bg-muted/30 flex-shrink-0">
            {/* Bulk type change - prominent when items selected */}
            {(() => {
              const selectedCount = currentLinks.filter(l => l.selected).length;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">Ações</span>
                  {selectedCount > 0 && (
                    <Badge className="text-[10px]">{selectedCount} selecionados</Badge>
                  )}
                  <div className="ml-auto flex gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground self-center mr-1">Alterar {selectedCount > 0 ? selectedCount : "selecionados"} para:</span>
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={selectedCount === 0}
                      onClick={() => setCurrentLinks(prev => prev.map(l => l.selected ? { ...l, linkType: "categoria" } : l))}>
                      Categoria
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={selectedCount === 0}
                      onClick={() => setCurrentLinks(prev => prev.map(l => l.selected ? { ...l, linkType: "subcategoria" } : l))}>
                      Subcategoria
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={selectedCount === 0}
                      onClick={() => setCurrentLinks(prev => prev.map(l => l.selected ? { ...l, linkType: "grupo" } : l))}>
                      Grupo
                    </Button>
                    <Button variant="default" size="sm" className="h-7 text-xs" disabled={selectedCount === 0}
                      onClick={() => setCurrentLinks(prev => prev.map(l => l.selected ? { ...l, linkType: "produto" } : l))}>
                      <Target className="w-3 h-3 mr-1" /> Produto
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" disabled={selectedCount === 0}
                      onClick={() => setCurrentLinks(prev => prev.filter(l => !l.selected))}>
                      <Trash2 className="w-3 h-3 mr-1" /> Remover
                    </Button>
                  </div>
                </div>
              );
            })()}

            <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
              {/* Drill selected categories */}
              {selectedCats.length > 0 && (
                <Button size="sm" onClick={() => handleDrillInto(selectedCats.map(l => l.url))} disabled={loading}>
                  {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Layers className="w-3 h-3 mr-1" />}
                  Entrar em {selectedCats.length} categorias (próximo nível)
                </Button>
              )}

              {/* Agent dialog */}
              {categoryLinks.length > 0 && (
                <Button size="sm" variant="secondary" onClick={openCategoryAgentDialog} disabled={loading}>
                  <Wand2 className="w-3 h-3 mr-1" /> Agente de Categorias
                </Button>
              )}

              {/* Pagination */}
              {currentLayer?.hasPagination && (
                <Button size="sm" variant="outline" onClick={handleFollowPagination} disabled={loading}>
                  {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                  ✓ Paginação ({currentLayer.paginationUrls.length} pág.)
                </Button>
              )}

              {/* Pagination config */}
              <Button size="sm" variant="outline" onClick={() => setShowPaginationConfig(!showPaginationConfig)} disabled={loading}>
                <Layers className="w-3 h-3 mr-1" /> Config Paginação
              </Button>

              {/* Auto-collect - works without manual selection */}
              <Button size="sm" variant="default" onClick={handleAutoCollect} disabled={loading} className="font-medium">
                {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                🚀 Auto-recolher TUDO ({categoryLinks.length} categorias + paginação)
              </Button>

              {/* Manual collect */}
              {productLinksInView.length > 0 && (
                <Button size="sm" variant="outline" onClick={handleCollectProducts}>
                  <Target className="w-3 h-3 mr-1" /> Recolher {productLinksInView.filter(l => l.selected).length} produtos →
                </Button>
              )}
            </div>

            {/* Pagination config panel */}
            {showPaginationConfig && (
              <div className="pt-2 border-t space-y-2">
                <p className="text-xs font-medium">Configuração de Paginação</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={paginationMode} onValueChange={v => setPaginationMode(v as "auto" | "pattern")}>
                    <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-detetar</SelectItem>
                      <SelectItem value="pattern">Padrão manual</SelectItem>
                    </SelectContent>
                  </Select>

                  {paginationMode === "pattern" && (
                    <Input
                      placeholder="Ex: ?page={n}  ou  /page/{n}/"
                      value={paginationPattern}
                      onChange={e => setPaginationPattern(e.target.value)}
                      className="h-7 text-xs font-mono max-w-60"
                    />
                  )}

                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">Máx págs:</span>
                    <Input
                      type="number"
                      min={2}
                      max={200}
                      value={maxPagesPerCategory}
                      onChange={e => setMaxPagesPerCategory(Number(e.target.value) || 50)}
                      className="h-7 w-16 text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">Profundidade máx:</span>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={maxCrawlDepth}
                      onChange={e => setMaxCrawlDepth(Number(e.target.value) || 5)}
                      className="h-7 w-16 text-xs"
                    />
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <p><strong>Auto-detetar:</strong> analisa os links de paginação da página e segue automaticamente.</p>
                  <p><strong>Padrão manual:</strong> use <code className="bg-muted px-1 rounded">{"{n}"}</code> para o número da página. Ex: <code className="bg-muted px-1 rounded">?page={"{n}"}</code>, <code className="bg-muted px-1 rounded">/page/{"{n}"}/</code>, <code className="bg-muted px-1 rounded">&amp;p={"{n}"}</code></p>
                  <p><strong>Profundidade:</strong> número máximo de níveis de subcategorias a explorar recursivamente (ex: Categoria → Subcategoria → Produtos = profundidade 2).</p>
                </div>
              </div>
            )}

            {collectProgress && (
              <div className="pt-2">
                <Progress value={(collectProgress.current / collectProgress.total) * 100} className="h-2" />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {collectProgress.label || `${collectProgress.current}/${collectProgress.total}`}
                  {collectProgress.pages ? ` · ${collectProgress.pages} páginas processadas` : ""}
                </p>
              </div>
            )}

            {crawlStats && !collectProgress && (
              <div className="pt-2 border-t">
                <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground text-xs">Último crawl:</span>
                  <Badge variant="outline" className="text-[10px]">{crawlStats.productsFound} produtos</Badge>
                  <Badge variant="outline" className="text-[10px]">{crawlStats.categoriesProcessed} categorias</Badge>
                  {crawlStats.subcategoriesFound > 0 && (
                    <Badge variant="outline" className="text-[10px]">{crawlStats.subcategoriesFound} subcategorias</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">{crawlStats.pagesProcessed} páginas</Badge>
                  <Badge variant="outline" className="text-[10px]">profundidade {crawlStats.maxDepthReached}</Badge>
                </div>
              </div>
            )}
          </div>

          {/* Filter & tools */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Input placeholder="Filtrar links..." value={linkFilter} onChange={e => setLinkFilter(e.target.value)} className="max-w-md" />
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={detectUrlPatterns}>
                <Wand2 className="w-3 h-3 mr-1" /> Padrões
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentLinks(prev => prev.map(l => ({ ...l, selected: true })))}>Selecionar Todos</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentLinks(prev => prev.map(l => ({ ...l, selected: false })))}>Limpar</Button>
            </div>
          </div>

          {/* Links table */}
          <ScrollArea className="flex-1 border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filteredLinks.length > 0 && filteredLinks.every(l => l.selected)}
                      onCheckedChange={(c) => {
                        const urls = new Set(filteredLinks.map(l => l.url));
                        setCurrentLinks(prev => prev.map(l => urls.has(l.url) ? { ...l, selected: !!c } : l));
                      }}
                    />
                  </TableHead>
                  <TableHead className="text-xs w-28">Tipo</TableHead>
                  <TableHead className="text-xs">URL</TableHead>
                  <TableHead className="text-xs">Texto</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLinks.map(link => (
                  <TableRow key={link.url} className={link.selected ? "bg-primary/5" : ""}>
                    <TableCell><Checkbox checked={link.selected} onCheckedChange={() => toggleLink(link.url)} /></TableCell>
                    <TableCell>
                      <Select value={link.linkType} onValueChange={v => changeLinkType(link.url, v as LinkType)}>
                        <SelectTrigger className="h-6 text-[10px] w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="categoria">Categoria</SelectItem>
                          <SelectItem value="subcategoria">Subcategoria</SelectItem>
                          <SelectItem value="grupo">Grupo</SelectItem>
                          <SelectItem value="produto">Produto</SelectItem>
                          <SelectItem value="outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs font-mono truncate max-w-md" title={link.url}>{link.url}</TableCell>
                    <TableCell className="text-xs truncate max-w-48">{link.text || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCurrentLinks(prev => prev.filter(l => l.url !== link.url))}>
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}

      {/* ═══ STEP: Products collected ═══ */}
      {step === "products" && (
        <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
          <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setStep("categories")}>
              <ArrowLeft className="w-3 h-3 mr-1" /> Voltar às Categorias
            </Button>
            <h2 className="font-semibold text-sm">URLs de Produto Recolhidas</h2>
            <Badge>{productUrls.length} produtos</Badge>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={handleAiFilterProducts} disabled={loading} title="IA filtra não-produtos">
                {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Brain className="w-3 h-3 mr-1" />}
                Filtrar (IA)
              </Button>
              <Button size="sm" variant="outline" onClick={handleAiAnalyzeFields} disabled={loading} title="IA deteta campos automaticamente">
                {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}
                Campos (IA)
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleOpenProductForFields()}>
                <Crosshair className="w-3 h-3 mr-1" /> Selecionar Campos
              </Button>
              {fields.length > 0 && (
                <Button size="sm" variant="default" onClick={handleRunExtraction}>
                  <Play className="w-3 h-3 mr-1" /> Extrair Todos ({productUrls.length} × {fields.length} campos)
                </Button>
              )}
            </div>
          </div>

          {fields.length > 0 && (
            <div className="p-3 border-2 border-primary/30 rounded-lg bg-primary/5 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Campos definidos ({fields.length}):</p>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" onClick={() => setFields([])}>
                  <Trash2 className="w-3 h-3 mr-1" /> Limpar todos
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {fields.map(f => (
                  <Badge key={f.id} variant="secondary" className="text-xs gap-1 pr-1 group">
                    {typeIcons[f.type]} {f.name}
                    {f.isVariation && <Layers className="w-2.5 h-2.5 text-amber-500" />}
                    {(f as any).confidence != null && (
                      <span className="text-[9px] text-muted-foreground ml-0.5">{Math.round((f as any).confidence * 100)}%</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setFields(prev => prev.filter(ff => ff.id !== f.id)); }}
                      className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5 opacity-60 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5 text-destructive" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {fields.length === 0 && (
            <div className="p-3 border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/20 flex-shrink-0">
              <p className="text-sm text-muted-foreground">
                <AlertTriangle className="w-4 h-4 inline mr-1 text-amber-500" />
                Ainda não definiu campos. Abra um produto para selecionar visualmente os campos a extrair.
              </p>
            </div>
          )}

          {/* Add more URLs */}
          <div className="flex gap-2 flex-shrink-0">
            <Input
              placeholder="Adicionar URL de produto..."
              className="text-xs font-mono max-w-lg"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val.startsWith("http") && !productUrls.includes(val)) {
                    setProductUrls(prev => [...prev, val]);
                    (e.target as HTMLInputElement).value = "";
                    toast.success("URL adicionada");
                  }
                }
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3 h-3 mr-1" /> Importar
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt" onChange={handleFileImport} className="hidden" />
          </div>

          <ScrollArea className="flex-1 border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="text-xs">URL do Produto</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productUrls.map((pUrl, idx) => (
                  <TableRow key={pUrl}>
                    <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="text-xs font-mono truncate max-w-lg" title={pUrl}>{pUrl}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleOpenProductForFields(pUrl)} title="Selecionar campos">
                          <Crosshair className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeProductUrl(pUrl)}>
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}

      {/* ═══ STEP: Extracting ═══ */}
      {step === "extract" && batchLoading && (
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center p-8 space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="font-semibold">A extrair dados...</p>
            {collectProgress && (
              <>
                <Progress value={(collectProgress.current / collectProgress.total) * 100} className="h-2" />
                <p className="text-sm text-muted-foreground">{collectProgress.current}/{collectProgress.total} páginas</p>
              </>
            )}
          </Card>
        </div>
      )}

      {/* ═══ STEP: Results ═══ */}
      {step === "results" && (
        <div className="flex-1 flex flex-col min-h-0 gap-3 p-4">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge>{results.length} produtos extraídos</Badge>
            {errors.length > 0 && <Badge variant="destructive">{errors.length} erros</Badge>}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("products")}>← Voltar</Button>
              <Button variant="outline" size="sm" onClick={handleExportExcel}>
                <Download className="w-3 h-3 mr-1" /> Excel
              </Button>
              <Button size="sm" onClick={() => setShowSendDialog(true)}>
                <ArrowRight className="w-3 h-3 mr-1" /> Enviar p/ Ingestão
              </Button>
            </div>
          </div>

          <ExcelPreviewTable
            data={results}
            mapping={scraperMapping}
            onMappingChange={setScraperMapping}
            maxPreviewRows={100}
          />

          {/* Send to ingestion dialog */}
          <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Mapear Campos → Produto</DialogTitle>
                <DialogDescription>
                  Associe cada campo extraído ao campo correspondente do produto. Mapeie pelo menos o <strong>Título</strong>.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {results[0] && Object.keys(results[0]).map(scraperKey => {
                  const sampleValue = results[0][scraperKey]?.substring(0, 80) || "—";
                  return (
                    <div key={scraperKey} className="grid grid-cols-[1fr,auto,1fr] items-center gap-2">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium">{scraperKey}</p>
                        <p className="text-[10px] text-muted-foreground truncate" title={sampleValue}>{sampleValue}</p>
                      </div>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <Select
                        value={scraperMapping[scraperKey] || "__ignore__"}
                        onValueChange={(v) => setScraperMapping(prev => {
                          const next = { ...prev };
                          if (v === "__ignore__") delete next[scraperKey];
                          else next[scraperKey] = v;
                          return next;
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Ignorar" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__ignore__"><span className="text-muted-foreground">— Ignorar —</span></SelectItem>
                          {DEFAULT_PRODUCT_FIELDS.map(pf => (
                            <SelectItem key={pf.key} value={pf.key}>{pf.label}{pf.required ? " *" : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>

              {Object.keys(scraperMapping).length > 0 && results.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Pré-visualização (1º produto)</p>
                  <div className="border rounded-lg p-2 space-y-1 bg-muted/30">
                    {Object.entries(scraperMapping).map(([scraperKey, productField]) => {
                      const pf = DEFAULT_PRODUCT_FIELDS.find(f => f.key === productField);
                      return (
                        <div key={scraperKey} className="flex gap-2 text-xs">
                          <Badge variant="secondary" className="text-[10px] shrink-0">{pf?.label || productField}</Badge>
                          <span className="truncate text-muted-foreground">{results[0][scraperKey]?.substring(0, 120) || "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setShowSendDialog(false)}>Cancelar</Button>
                <Button onClick={handleSendToProducts} disabled={batchLoading || !Object.values(scraperMapping).includes("title")}>
                  {batchLoading && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Criar Job de Ingestão ({results.length} itens)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Agent Category Selection Dialog */}
      <Dialog open={showCategoryAgentDialog} onOpenChange={setShowCategoryAgentDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-5 h-5" />
              Agente de Categorias
            </DialogTitle>
            <DialogDescription>
              Escolha as categorias/grupos para explorar automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{categoryAgentCandidates.length} categorias/grupos</Badge>
            <Badge variant="outline" className="text-[10px]">{selectedCategoryAgentCount} selecionados</Badge>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCategoryAgentSelection(Object.fromEntries(categoryAgentCandidates.map(l => [l.url, true])))}>Selecionar tudo</Button>
              <Button variant="outline" size="sm" onClick={() => setCategoryAgentSelection(Object.fromEntries(categoryAgentCandidates.map(l => [l.url, false])))}>Limpar</Button>
            </div>
          </div>

          <ScrollArea className="h-80 border rounded-lg">
            <div className="p-2 space-y-1.5">
              {categoryAgentCandidates.map(link => (
                <label key={link.url} className="flex items-start gap-2 border rounded-md p-2 cursor-pointer hover:bg-muted/40">
                  <Checkbox checked={!!categoryAgentSelection[link.url]} onCheckedChange={(c) => setCategoryAgentSelection(prev => ({ ...prev, [link.url]: !!c }))} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs truncate">{link.text || "Sem texto"}</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate" title={link.url}>{link.url}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{link.linkType}</Badge>
                </label>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCategoryAgentDialog(false)}>Cancelar</Button>
            <Button onClick={handleRunCategoryAgentFlow} disabled={selectedCategoryAgentCount === 0 || loading}>
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Layers className="w-3 h-3 mr-1" />}
              Explorar {selectedCategoryAgentCount} categorias
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pattern Detection Dialog */}
      <Dialog open={showPatternDialog} onOpenChange={setShowPatternDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-5 h-5" />
              Padrões de URL Detetados
            </DialogTitle>
            <DialogDescription>
              Selecione os padrões que correspondem a <strong>páginas de produto</strong> para filtrar automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {urlPatterns.map((p, idx) => (
              <div
                key={idx}
                className={`border rounded-lg p-3 cursor-pointer transition-colors ${p.selected ? "bg-primary/10 border-primary" : "hover:bg-muted/50"}`}
                onClick={() => setUrlPatterns(prev => prev.map((pp, i) => i === idx ? { ...pp, selected: !pp.selected } : pp))}
              >
                <div className="flex items-center gap-2">
                  <Checkbox checked={p.selected} onCheckedChange={() => setUrlPatterns(prev => prev.map((pp, i) => i === idx ? { ...pp, selected: !pp.selected } : pp))} />
                  <code className="text-xs font-mono flex-1 truncate">{p.pattern}</code>
                  <Badge variant="secondary" className="text-[10px]">{p.count} URLs</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 ml-6 truncate">Exemplo: {p.sample}</p>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPatternDialog(false)}>Cancelar</Button>
            <Button onClick={applyPatternSelection} disabled={!urlPatterns.some(p => p.selected)}>
              Selecionar URLs Correspondentes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
