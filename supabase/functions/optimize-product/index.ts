import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceFieldLimits } from "../_shared/ai/output-guardrails.ts";
import { formatProductOutput } from "../_shared/ai/output-formatter.ts";
import { cleanHtmlContentWithStats } from "../_shared/text/clean-html-content.ts";

/**
 * Validates content follows natural language guidelines
 * Logs warnings for monitoring (doesn't block generation)
 */
function validateNaturalLanguage(content: string, fieldName: string): void {
  if (!content) return;
  const warnings: string[] = [];
  
  // Check HORECA overuse
  const horecaCount = (content.match(/\bHORECA\b/gi) || []).length;
  if (horecaCount > 1) {
    warnings.push(`"HORECA" aparece ${horecaCount} vezes (máx: 1)`);
  }
  
  // Check "estabelecimentos" repetition
  const estabelCount = (content.match(/\bestablecimentos\b/gi) || []).length;
  if (estabelCount > 2) {
    warnings.push(`"estabelecimentos" aparece ${estabelCount} vezes (máx: 2)`);
  }
  
  // Check repetitive sentence starts
  const thisEquipCount = (content.match(/(Este equipamento|Este produto|Esta máquina|Este expositor)/gi) || []).length;
  if (thisEquipCount > 2) {
    warnings.push(`${thisEquipCount} frases começam com "Este equipamento/produto..." (repetitivo)`);
  }
  
  if (warnings.length > 0) {
    console.warn(`[language-quality] ${fieldName}:`, warnings);
  } else {
    console.log(`[language-quality] ${fieldName} ✓`);
  }
}

async function findSimilarProductsInMeilisearch(
  title: string,
  shortDesc: string
): Promise<Array<{ title: string; category: string; brand: string }>> {
  const MEILI_URL = "https://search.palamenta.com.pt";
  const MEILI_KEY = "ed7cabcddd7aeeed55e18972f4ec98dccd3c27bf78cb82962d04e1661778011e";
  const INDEX = "products_stage";

  const query = `${title} ${shortDesc}`.trim().substring(0, 200);

  try {
    const resp = await fetch(`${MEILI_URL}/indexes/${INDEX}/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MEILI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        limit: 8,
        attributesToRetrieve: ["title", "categories", "brand_names"],
      }),
    });

    if (!resp.ok) return [];

    const data = await resp.json();
    return (data.hits || [])
      .filter((h: any) => h.categories?.length > 0)
      .map((h: any) => {
        let categoryPath = "";
        const cats = h.categories;
        if (Array.isArray(cats)) {
          if (cats.length === 1 && (cats[0].includes("&gt;") || cats[0].includes(" > "))) {
            categoryPath = cats[0].replace(/&gt;/g, " > ");
          } else {
            // Assume the array is the hierarchy (usually root -> leaf)
            categoryPath = cats.join(" > ");
          }
        } else if (typeof cats === "string") {
          categoryPath = cats.replace(/&gt;/g, " > ");
        }

        return {
          title: h.title || "",
          category: categoryPath,
          brand: Array.isArray(h.brand_names) ? h.brand_names[0] : (h.brand_names || ""),
        };
      });
  } catch {
    return [];
  }
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_RATE_LIMIT_RETRIES = 4;
const AI_RATE_LIMIT_BASE_DELAY_MS = 2_000;
const AI_RATE_LIMIT_MAX_DELAY_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const retryAt = new Date(retryAfter).getTime();
  if (!Number.isNaN(retryAt)) {
    const diff = retryAt - Date.now();
    return diff > 0 ? diff : null;
  }

  return null;
}

async function callResolveAiRouteWithRetry(body: unknown): Promise<Response> {
  for (let attempt = 1; attempt <= AI_RATE_LIMIT_RETRIES; attempt++) {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status !== 429 || attempt === AI_RATE_LIMIT_RETRIES) {
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const delayMs = retryAfterMs ?? Math.min(AI_RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1), AI_RATE_LIMIT_MAX_DELAY_MS);
    const responseText = await response.text();

    console.warn(
      `[optimize-product] AI rate limit attempt ${attempt}/${AI_RATE_LIMIT_RETRIES}; retrying in ${delayMs}ms`,
      responseText.slice(0, 240),
    );

    await sleep(delayMs);
  }

  throw new Error("Falha inesperada ao contactar o motor de IA.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { productIds, fieldsToOptimize, modelOverride, workspaceId, phase, skipKnowledge, skipScraping, skipReranking, promptTemplateId } = await req.json();
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "productIds é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase-based field mapping
    const PHASE_FIELDS: Record<number, string[]> = {
      1: ["title", "description", "short_description", "tags", "category"],
      2: ["meta_title", "meta_description", "seo_slug", "faq", "image_alt"],
      3: ["price", "upsells", "crosssells"],
    };

    let fields: string[];
    if (phase && PHASE_FIELDS[phase]) {
      // Phase mode: use phase fields, intersected with fieldsToOptimize if provided
      const phaseFields = PHASE_FIELDS[phase];
      fields = fieldsToOptimize
        ? phaseFields.filter((f: string) => fieldsToOptimize.includes(f))
        : phaseFields;
      console.log(`🔄 Phase ${phase}: optimizing fields [${fields.join(", ")}]`);
    } else {
      fields = fieldsToOptimize || [
        "title", "description", "short_description",
        "meta_title", "meta_description", "seo_slug", "tags", "price", "faq",
        "upsells", "crosssells", "image_alt", "category"
      ];
    }

    // Fetch products
    const { data: products, error: fetchError } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (fetchError) throw fetchError;
    
    // EXCLUDE DISCONTINUED PRODUCTS
    const activeProducts = (products || []).filter(p => !p.is_discontinued);

    if (!activeProducts || activeProducts.length === 0) {
      console.log(`[optimize-product] Skipping optimization: all products are discontinued or not found.`);
      return new Response(JSON.stringify({ 
        success: true, 
        results: (products || []).map(p => ({ productId: p.id, status: "skipped", reason: "discontinued" }))
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use activeProducts from here on
    const productsToProcess = activeProducts;

    // Fetch user's optimization prompt from settings
    const { data: promptSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", "optimization_prompt")
      .maybeSingle();

    const customPrompt = promptSetting?.value || null;

    // When a specific prompt template is selected, check if it's a description-type template
    // If so, its prompt text should override the DEFAULT_FIELD_PROMPTS.description
    let descriptionTemplateOverride: string | null = null;
    if (promptTemplateId) {
      try {
        const { data: selectedTemplate } = await supabase
          .from("prompt_templates")
          .select("id, prompt_type, base_prompt")
          .eq("id", promptTemplateId)
          .maybeSingle();

        if (selectedTemplate?.prompt_type === "description") {
          // Try active version first
          const { data: activeVersion } = await supabase
            .from("prompt_versions")
            .select("prompt_text")
            .eq("template_id", promptTemplateId)
            .eq("is_active", true)
            .order("version_number", { ascending: false })
            .limit(1)
            .maybeSingle();

          descriptionTemplateOverride = activeVersion?.prompt_text || selectedTemplate.base_prompt || null;
          if (descriptionTemplateOverride) {
            console.log(`📋 [optimize-product] Description template override active from template "${promptTemplateId}"`);
          }
        }
      } catch (err) {
        console.warn(`⚠️ [optimize-product] Failed to fetch prompt template type:`, err);
      }
    }

    // Fetch per-field custom prompts + description template
    const fieldPromptKeys = [
      "prompt_field_title", "prompt_field_description", "prompt_field_short_description",
      "prompt_field_meta_title", "prompt_field_meta_description", "prompt_field_seo_slug",
      "prompt_field_tags", "prompt_field_price", "prompt_field_faq",
      "prompt_field_upsells", "prompt_field_crosssells", "prompt_field_image_alt",
      "prompt_field_category", "description_template",
    ];
    const { data: fieldPromptSettings } = await supabase
      .from("settings")
      .select("key, value")
      .eq("user_id", userId)
      .in("key", fieldPromptKeys);
    
    const fieldPrompts: Record<string, string> = {};
    let descriptionTemplate: string | null = null;
    (fieldPromptSettings || []).forEach((s: any) => {
      if (s.key === "description_template" && s.value) {
        descriptionTemplate = s.value;
      } else if (s.value) {
        fieldPrompts[s.key] = s.value;
      }
    });

    // Fetch existing categories for AI context
    // === SEMANTIC SYNONYM MAP for category matching ===
    const CATEGORY_SYNONYMS: Record<string, string[]> = {
      "gyros": ["kebab", "döner", "doner", "shawarma", "churrasco vertical"],
      "kebab": ["gyros", "döner", "doner", "shawarma", "churrasco vertical"],
      "fritadeira": ["fryer", "deep fryer", "frigideira industrial"],
      "forno": ["oven", "forno convetor", "forno combinado", "combi"],
      "fogão": ["fogao", "cooker", "placa", "cooking range"],
      "grelhador": ["grill", "char grill", "chapa", "plancha", "griddle"],
      "chapa": ["plancha", "griddle", "grelhador", "grill"],
      "vitrine": ["expositor", "display", "montra", "showcase"],
      "frigorifico": ["frigorífico", "refrigerador", "fridge", "refrigeration", "armário refrigerado"],
      "congelador": ["freezer", "ultracongelador", "abatedor", "blast chiller"],
      "lava-louça": ["lava louça", "máquina de lavar", "dishwasher", "lavagem"],
      "microondas": ["micro-ondas", "microwave"],
      "salamandra": ["salamander", "gratinador"],
      "banho-maria": ["banho maria", "bain marie", "aquecedor"],
      "cortador": ["slicer", "fatiador", "cortadora"],
      "batedeira": ["mixer", "misturadora", "amassadeira"],
      "tostadeira": ["torradeira", "toaster", "tostador"],
      "máquina de gelo": ["ice maker", "fabricador de gelo", "produtora de gelo"],
      "máquina de café": ["coffee machine", "cafeteira", "espresso"],
      "pizza": ["forno de pizza", "pizza oven"],
      "wok": ["wok range", "fogão wok"],
      "pasta": ["cozedor de massa", "pasta cooker"],
      "arroz": ["rice cooker", "cozedor de arroz"],
      // Exaustão / ventilação
      "exaustor": ["apanha fumos", "apanha-fumos", "hotte", "coifa", "hood", "extractor hood", "exaustão", "campânula", "campanula", "campana"],
      "apanha-fumos": ["exaustor", "hotte", "coifa", "hood", "extractor hood", "campânula", "campanula", "campana"],
      "hotte": ["exaustor", "apanha fumos", "coifa", "hood", "extractor hood", "campânula", "campanula", "campana"],
      "campânula": ["exaustor", "hotte", "coifa", "apanha fumos", "hood", "extractor hood", "campanula", "campana"],
      "campanula": ["exaustor", "hotte", "coifa", "apanha fumos", "hood", "extractor hood", "campânula", "campana"],
      "campana": ["exaustor", "hotte", "coifa", "apanha fumos", "hood", "extractor hood", "campânula", "campanula"],
      // Bancadas e mobiliário inox
      "bancada": ["mesa de trabalho", "bancada inox", "work table", "worktable", "mesa inox"],
      "lavatório": ["lavatorio", "pia", "sink", "lava-mãos", "lava maos"],
      // Cervejeira / vinho
      "cervejeira": ["beer cooler", "expositor cerveja", "fridge bebidas"],
      "garrafeira": ["wine cooler", "wine cellar", "adega", "expositor vinhos"],
      // Embalagem
      "seladora": ["sealer", "vacuum sealer", "embaladora vácuo", "máquina vácuo"],
      // Preparação
      "liquidificador": ["blender", "triturador", "varinha mágica", "robot copo"],
      "processador": ["food processor", "robot cozinha", "cutter"],
      "descascador": ["peeler", "descascadora batatas"],
      // Cozedura específica
      "crepeira": ["crepe maker", "máquina de crepes"],
      "waffle": ["waffle maker", "máquina de waffles"],
      "panela": ["marmita", "tacho", "stockpot", "panela cozedura"],
    };

    function normalizeForCategoryMatch(text: string): string {
      return text.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s>]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function getSynonymsForProduct(productTitle: string): string[] {
      const normalized = normalizeForCategoryMatch(productTitle);
      const words = normalized.split(" ").filter(w => w.length >= 3);
      const foundSyns = new Set<string>();
      
      for (const word of words) {
        // Check direct key
        if (CATEGORY_SYNONYMS[word]) {
          CATEGORY_SYNONYMS[word].forEach(s => foundSyns.add(s));
        }
        // Check if word is a synonym of something else
        for (const [key, syns] of Object.entries(CATEGORY_SYNONYMS)) {
          if (syns.includes(word)) {
            foundSyns.add(key);
            syns.forEach(s => {
              if (s !== word) foundSyns.add(s);
            });
          }
        }
      }
      return Array.from(foundSyns);
    }

    function findSemanticCategory(productTitle: string, productCategory: string, existingCats: string[]): string[] {
      const normalized = normalizeForCategoryMatch(`${productTitle} ${productCategory}`);
      const words = normalized.split(" ").filter(w => w.length >= 3);
      
      // Find matching categories using synonyms
      const matchedCats: { cat: string; score: number }[] = [];
      
      for (const cat of existingCats) {
        const normalizedCat = normalizeForCategoryMatch(cat);
        let score = 0;
        
        // Direct word match
        for (const word of words) {
          if (normalizedCat.includes(word)) score += 10;
        }
        
        // Synonym match
        for (const word of words) {
          const synonyms = CATEGORY_SYNONYMS[word] || [];
          for (const [key, syns] of Object.entries(CATEGORY_SYNONYMS)) {
            if (syns.includes(word) || key === word) {
              const allTerms = [key, ...syns];
              for (const term of allTerms) {
                if (normalizedCat.includes(normalizeForCategoryMatch(term))) {
                  score += 8;
                }
              }
            }
          }
        }

        // Bonus for hierarchical categories (more specific = better)
        if (cat.includes(">") && score > 0) score += 5;
        
        // Bonus for subcategory parts matching product words
        if (cat.includes(">")) {
          const parts = cat.split(">").map(p => normalizeForCategoryMatch(p.trim()));
          const lastPart = parts[parts.length - 1]; // most specific part
          for (const word of words) {
            if (lastPart.includes(word)) score += 6; // subcategory match is valuable
          }
        }
        
        if (score > 0) matchedCats.push({ cat, score });
      }
      
      return matchedCats
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(m => m.cat);
    }

    let existingCategories: { id: string; full_path: string }[] = [];
    if (fields.includes("category")) {
      // Use service role for categories to bypass restrictive RLS policies
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      // 1. Fetch from categories table (proper taxonomy with hierarchy)
      const { data: catTableData } = await supabaseAdmin
        .from("categories")
        .select("id, name, parent_id")
        .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
        .order("sort_order", { ascending: true });

      if (catTableData && catTableData.length > 0) {
        // Build hierarchy: "Parent > Child" format
        const catById = new Map<string, any>(catTableData.map((c: any) => [c.id, c]));
        const buildPath = (cat: any): string => {
          const parts: string[] = [cat.name];
          let current = cat;
          while (current.parent_id) {
            const parent = catById.get(current.parent_id);
            if (!parent) break;
            parts.unshift(parent.name);
            current = parent;
          }
          return parts.join(" > ");
        };

        for (const cat of catTableData) {
          existingCategories.push({
            id: cat.id,
            full_path: buildPath(cat)
          });
        }
      }

      // 2. Also include unique categories from products (for backward compat)
      const { data: catData } = await supabaseAdmin
        .from("products")
        .select("category")
        .eq("workspace_id", workspaceId)
        .not("category", "is", null);

      const uniqueLegacyCats = new Set<string>();
      (catData || []).forEach((p: any) => { 
        if (p.category && !existingCategories.some(c => c.full_path === p.category)) {
          uniqueLegacyCats.add(p.category);
        }
      });
      
      uniqueLegacyCats.forEach(cat => {
        existingCategories.push({ id: "legacy", full_path: cat });
      });

      existingCategories.sort((a, b) => a.full_path.localeCompare(b.full_path));

      // 🧠 Fetch learned patterns for smarter categorization
      const { data: learnedPatterns } = await supabaseAdmin
        .from("category_learning_patterns")
        .select("category_id, pattern_type, pattern_key, pattern_value, pattern_operator, confidence")
        .eq("workspace_id", workspaceId)
        .gte("confidence", 0.4) // Only use patterns with 40%+ confidence
        .order("confidence", { ascending: false });

      // Pattern-aware category hints logic handled inside product loop
    }

    // Mark as processing
    await supabase
      .from("products")
      .update({ status: "processing" })
      .in("id", productIds);

    // Fetch user's chosen AI model from settings
    // CANONICAL_MODEL_MAP: maps UI model keys to provider-registry format.
    const CANONICAL_MODEL_MAP: Record<string, { provider: string; model: string }> = {
      // Lovable Gateway models (primary — always available via LOVABLE_API_KEY)
      "google/gemini-2.5-pro":        { provider: "lovable_gateway", model: "google/gemini-2.5-pro" },
      "google/gemini-2.5-flash":      { provider: "lovable_gateway", model: "google/gemini-2.5-flash" },
      "google/gemini-2.5-flash-lite": { provider: "lovable_gateway", model: "google/gemini-2.5-flash-lite" },
      "google/gemini-3-flash-preview":  { provider: "lovable_gateway", model: "google/gemini-3-flash-preview" },
      "google/gemini-3.1-pro-preview":  { provider: "lovable_gateway", model: "google/gemini-3.1-pro-preview" },
      "google/gemini-3.1-flash-image-preview": { provider: "lovable_gateway", model: "google/gemini-3.1-flash-image-preview" },
      "openai/gpt-5":                 { provider: "lovable_gateway", model: "openai/gpt-5" },
      "openai/gpt-5-mini":            { provider: "lovable_gateway", model: "openai/gpt-5-mini" },
      "openai/gpt-5-nano":            { provider: "lovable_gateway", model: "openai/gpt-5-nano" },
      "openai/gpt-5.2":               { provider: "lovable_gateway", model: "openai/gpt-5.2" },
      // Direct provider models (used when user configures own API keys via AI Provider Center)
      "gemini-2.5-pro":               { provider: "gemini", model: "gemini-2.5-pro" },
      "gemini-2.5-flash":             { provider: "gemini", model: "gemini-2.5-flash" },
      "gemini-2.5-flash-lite":        { provider: "gemini", model: "gemini-2.5-flash-lite" },
      "gemini-3-flash-preview":       { provider: "gemini", model: "gemini-3-flash-preview" },
      "gemini-3.1-pro-preview":       { provider: "gemini", model: "gemini-3.1-pro-preview" },
      "gpt-4o":                       { provider: "openai", model: "gpt-4o" },
      "gpt-4o-mini":                  { provider: "openai", model: "gpt-4o-mini" },
      "gpt-5":                        { provider: "openai", model: "gpt-5" },
      "claude-sonnet-4-6":            { provider: "anthropic", model: "claude-sonnet-4-6" },
      // Legacy short-form keys (backward compat from old UI selections — route through gateway)
      "gemini-3-flash":               { provider: "lovable_gateway", model: "google/gemini-2.5-flash" },
      "gemini-3-pro":                 { provider: "lovable_gateway", model: "google/gemini-2.5-pro" },
      "gemini-3-pro-preview":         { provider: "lovable_gateway", model: "google/gemini-3.1-pro-preview" },
    };
    const DEFAULT_MODEL_KEY = "google/gemini-2.5-flash";
    const { data: modelSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", "default_model")
      .maybeSingle();
    // Use override if provided, otherwise fall back to settings, then to DEFAULT_MODEL_KEY
    const modelKey = modelOverride || modelSetting?.value || DEFAULT_MODEL_KEY;
    const chosenModel = CANONICAL_MODEL_MAP[modelKey] ?? CANONICAL_MODEL_MAP[DEFAULT_MODEL_KEY];
    if (!CANONICAL_MODEL_MAP[modelKey]) {
      console.warn(`[optimize-product] Unknown model key "${modelKey}" — falling back to ${DEFAULT_MODEL_KEY}`);
    }
    console.log(`[optimize-product] Model resolution: requested="${modelKey}" → resolved="${chosenModel.model}" via provider="${chosenModel.provider}" (override: ${modelOverride || "none"}, setting: ${modelSetting?.value || "default"})`);

    function detectCertifications(product: any): string[] {
      const certs = new Set<string>(["CE"]); // Always include CE (mandatory for EU)
      const searchText = [
        product.original_title || "",
        product.original_description || "",
        product.technical_specs || "",
        product.short_description || "",
      ].join(" ").toUpperCase();

      const patterns = {
        "HACCP": /\bHACCP\b/i,
        "NSF": /\bNSF\b/i,
        "RoHS": /\bROHS\b/i,
        "IP65": /\bIP65\b/i,
        "IP67": /\bIP67\b/i,
        "UL": /\bUL LISTED\b|\bUL CERTIFIED\b/i,
        "TÜV": /\bTÜV\b|\bTUV\b/i,
        "GS": /\bGEPRÜFTE SICHERHEIT\b|\bGS MARK\b/i,
        "ETL": /\bETL LISTED\b/i,
        "ISO 9001": /\bISO 9001\b/i,
        "WRAS": /\bWRAS\b/i,
      };

      for (const [cert, pattern] of Object.entries(patterns)) {
        if (pattern.test(searchText)) certs.add(cert);
      }

      // Sort: CE first, then alphabetically
      return Array.from(certs).sort((a, b) =>
        a === "CE" ? -1 : b === "CE" ? 1 : a.localeCompare(b)
      );
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

    // Fetch supplier mappings from settings
    let supplierMappings: Array<{ prefix: string; url: string; name?: string }> = [];
    const { data: suppliersConfig } = await supabase
      .from("settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", "suppliers_json")
      .maybeSingle();

    if (suppliersConfig?.value) {
      try {
        const parsed = JSON.parse(suppliersConfig.value);
        if (Array.isArray(parsed)) {
          supplierMappings = parsed.filter((s: any) => s.prefix && s.url);
          const allParsed = parsed.length;
          const withUrl = supplierMappings.length;
          if (allParsed > 0 && withUrl === 0) {
            console.warn(`⚠️ ${allParsed} fornecedores configurados mas NENHUM tem URL preenchido! Preencha o URL nas Configurações.`);
          } else {
            console.log(`📦 ${withUrl} fornecedores com URL activo: ${supplierMappings.map(s => `${s.prefix}→${s.url.substring(0, 40)}`).join(", ")}`);
          }
        }
      } catch { /* ignore parse errors */ }
    } else {
      console.log("⚠️ Nenhum fornecedor configurado (suppliers_json não encontrado)");
    }

    // === COMPATIBILITY ENGINE for upsell/cross-sell ===
    interface ProductAttrs {
      sku: string;
      title: string;
      category: string;
      price: number;
      line: string | null;       // "700", "900", etc.
      energy: string | null;     // "gas", "eletrico", "misto"
      capacity: number | null;   // liters, baskets size, etc.
      dimensions: string | null; // "40x40", "60x40", etc.
      type: string | null;       // "fritadeira", "fogao", etc.
      models: string[];          // compatible models mentioned: "ht", "lp", "gn 1/1", etc.
      brand: string | null;
      raw: any;
    }

    function extractAttrs(p: any): ProductAttrs {
      const title = (p.optimized_title || p.original_title || "").toLowerCase();
      const desc = (p.original_description || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      const combined = `${title} ${cat} ${desc}`;

      // Extract line/series
      const lineMatch = combined.match(/linha\s*(\d+)/i) || combined.match(/line\s*(\d+)/i) || combined.match(/s[eé]rie\s*(\d+)/i);
      const line = lineMatch ? lineMatch[1] : null;

      // Extract energy type
      let energy: string | null = null;
      if (/\bg[aá]s\b/i.test(combined)) energy = "gas";
      else if (/\bel[eé]tric/i.test(combined)) energy = "eletrico";
      else if (/\bmist[oa]\b/i.test(combined)) energy = "misto";

      // Extract capacity (liters, baskets, burners)
      let capacity: number | null = null;
      const litersMatch = combined.match(/(\d+)\s*(?:litros?|l\b)/i);
      const cestoMatch = combined.match(/cesto\s*(\d+)/i);
      const bicosMatch = combined.match(/(\d+)\s*(?:bicos?|queimadores?)/i);
      if (litersMatch) capacity = parseInt(litersMatch[1]);
      else if (cestoMatch) capacity = parseInt(cestoMatch[1]);
      else if (bicosMatch) capacity = parseInt(bicosMatch[1]);

      // Extract dimensions
      const dimMatch = combined.match(/(\d+)\s*x\s*(\d+)/i);
      const dimensions = dimMatch ? `${dimMatch[1]}x${dimMatch[2]}` : null;

      // Extract compatible models/series (HT, LP, GN 1/1, etc.)
      const models: string[] = [];
      const modelPatterns = [
        /\b(ht)\b/gi, /\b(lp)\b/gi, /\b(hp)\b/gi, /\b(hr)\b/gi,
        /\b(gn\s*\d+\/\d+)\b/gi, /\b(gn\d+\/\d+)\b/gi,
        /\b([A-Z]{1,4}-?\d+[A-Z0-9\-]*)\b/gi, // Broader SKU-like pattern (e.g., XC-440C, XCLD-440)
        /\bp\/?\s*mod(?:elo)?s?\s*\.?\s*([a-z0-9\-]+(?:\s*[-\/,]\s*[a-z0-9\-]+)*)/gi,
        /\bmod(?:elo)?s?\s*\.?\s*([a-z0-9\-]+(?:\s*[-\/,]\s*[a-z0-9\-]+)*)/gi,
      ];
      for (const pat of modelPatterns) {
        let m;
        while ((m = pat.exec(combined)) !== null) {
          const vals = (m[1] || m[0]).split(/[\s,\/\-]+/).filter(v => v.length >= 2);
          for (const v of vals) {
            const norm = v.trim().toLowerCase().replace(/\s+/g, "");
            if (norm && !models.includes(norm)) models.push(norm);
          }
        }
      }

      // Extract product type
      const typePatterns = [
        "depurador", "descalcificador", "amaciador", "abrilhantador", "detergente", "bomba",
        "fritadeira", "fogao", "fogão", "forno", "bancada", "mesa", "armario", "armário",
        "maquina de lavar", "máquina de lavar", "lava-louça", "lava louça",
        "maquina", "máquina", "lava",
        "frigorifico", "frigorífico", "vitrine", "exaustor",
        "grelhador", "chapa", "basculante", "marmita", "batedeira", "cortador", "ralador",
        "microondas", "tostadeira", "torradeira", "salamandra", "abatedor", "ultracongelador",
        "dispensador", "doseador", "cesto", "tabuleiro", "prateleira", "estante", "escorredor",
        "cuba", "torneira", "pia", "suporte", "carro",
      ];
      let type: string | null = null;
      for (const t of typePatterns) {
        if (combined.includes(t)) { type = t; break; }
      }
      // Normalize compound types
      if (type === "maquina de lavar" || type === "máquina de lavar" || type === "lava-louça" || type === "lava louça") {
        type = "lava";
      }

      return {
        sku: p.sku || "",
        title: p.optimized_title || p.original_title || "Sem título",
        category: p.category || "",
        price: parseFloat(p.original_price) || 0,
        line, energy, capacity, dimensions, type, models, brand: null, raw: p,
      };
    }

    function computeCompatibility(current: ProductAttrs, candidate: ProductAttrs, mode: "upsell" | "crosssell"): { score: number; reasons: string[] } {
      if (candidate.sku === current.sku) return { score: -1, reasons: [] };
      let score = 0;
      const reasons: string[] = [];

      // === MODEL COMPATIBILITY: if product mentions models, boost candidates that ARE those models or mention same models ===
      const sharedModels = current.models.filter(m => candidate.models.includes(m));
      if (sharedModels.length > 0) {
        score += 20; reasons.push(`modelo compatível (${sharedModels.join(", ")})`);
      }
      // If current mentions a model and candidate title/type matches that model name
      for (const model of current.models) {
        if (candidate.title.toLowerCase().includes(model)) {
          score += 25; reasons.push(`produto modelo ${model.toUpperCase()}`);
        }
      }
      // If candidate mentions a model and current title matches it
      for (const model of candidate.models) {
        if (current.title.toLowerCase().includes(model)) {
          score += 15; reasons.push(`compatível com ${model.toUpperCase()}`);
        }
      }

      if (mode === "upsell") {
        // Upsell: same type, same or higher line, bigger/better
        if (current.type && candidate.type === current.type) { score += 40; reasons.push("mesmo tipo"); }
        if (current.line && candidate.line) {
          if (candidate.line === current.line) { score += 20; reasons.push("mesma linha"); }
          else if (parseInt(candidate.line) > parseInt(current.line)) { score += 30; reasons.push(`linha superior (${candidate.line})`); }
        }
        if (current.energy && candidate.energy === current.energy) { score += 10; reasons.push("mesma energia"); }
        if (current.capacity && candidate.capacity && candidate.capacity > current.capacity) {
          score += 25; reasons.push(`maior capacidade (${candidate.capacity})`);
        }
        if (candidate.price > current.price && candidate.price <= current.price * 3) {
          score += 15; reasons.push("preço superior");
        }
        // Same category boost (more aggressive)
        if (current.category && candidate.category) {
          if (candidate.category === current.category) {
            score += 30; reasons.push("mesma categoria exata");
          } else if (candidate.category.split(">")[0]?.trim() === current.category.split(">")[0]?.trim()) {
            score += 15; reasons.push("mesma categoria principal");
          }
        }
        // For accessories: upsell the machine they work with
        const accessoryToMachine: Record<string, string[]> = {
          "depurador": ["lava", "maquina", "máquina"],
          "descalcificador": ["lava", "maquina", "máquina"],
          "abrilhantador": ["lava", "maquina", "máquina"],
          "detergente": ["lava", "maquina", "máquina"],
          "bomba": ["lava", "maquina", "máquina"],
          "cesto": ["lava", "maquina", "máquina", "fritadeira"],
          "doseador": ["lava", "maquina", "máquina"],
          "tabuleiro": ["forno", "armario", "armário"],
          "prateleira": ["forno", "frigorifico", "frigorífico", "armario", "armário", "vitrine"],
          "estante": ["frigorifico", "frigorífico", "armario", "armário", "vitrine"],
          "escorredor": ["lava", "fritadeira"],
        };
        if (current.type && candidate.type) {
          const machines = accessoryToMachine[current.type];
          if (machines && machines.includes(candidate.type)) {
            score += 35; reasons.push(`máquina compatível (${candidate.type})`);
          }
        }
      } else {
        // Cross-sell: complementary products (different type, same line/family)
        if (current.type && candidate.type && candidate.type !== current.type) {
          score += 20; reasons.push("tipo complementar");
        }
        if (current.type && candidate.type === current.type) {
          score -= 15; // penalize same type for cross-sell
        }
        if (current.line && candidate.line === current.line) {
          score += 35; reasons.push("mesma linha (cross-sell)");
        }
        if (current.energy && candidate.energy === current.energy) {
          score += 5; reasons.push("mesma energia");
        }
        // Accessory patterns - expanded with dishwasher ecosystem
        const accessoryPairs: Record<string, string[]> = {
          "fritadeira": ["cesto", "doseador", "bancada", "escorredor", "prateleira"],
          "fogao": ["forno", "bancada", "exaustor", "prateleira", "salamandra"],
          "fogão": ["forno", "bancada", "exaustor", "prateleira", "salamandra"],
          "forno": ["tabuleiro", "prateleira", "bancada", "exaustor", "carro"],
          "maquina": ["cesto", "doseador", "mesa", "prateleira", "depurador", "descalcificador", "abrilhantador", "detergente", "bomba", "escorredor"],
          "máquina": ["cesto", "doseador", "mesa", "prateleira", "depurador", "descalcificador", "abrilhantador", "detergente", "bomba", "escorredor"],
          "lava": ["cesto", "doseador", "mesa", "escorredor", "depurador", "descalcificador", "abrilhantador", "detergente", "bomba", "suporte", "prateleira"],
          "armario": ["prateleira", "estante", "cesto", "tabuleiro", "bancada"],
          "armário": ["prateleira", "estante", "cesto", "tabuleiro", "bancada"],
          "vitrine": ["prateleira", "estante", "suporte", "bancada"],
          "frigorifico": ["prateleira", "estante", "suporte", "bancada"],
          "frigorífico": ["prateleira", "estante", "suporte", "bancada"],
          "grelhador": ["bancada", "exaustor", "chapa"],
          "chapa": ["bancada", "exaustor", "grelhador"],
          // Accessories should cross-sell with the machines AND with other accessories
          "depurador": ["lava", "maquina", "máquina", "cesto", "abrilhantador", "detergente", "bomba", "doseador", "escorredor"],
          "descalcificador": ["lava", "maquina", "máquina", "cesto", "abrilhantador", "detergente", "bomba"],
          "abrilhantador": ["lava", "maquina", "máquina", "depurador", "detergente", "bomba", "doseador"],
          "detergente": ["lava", "maquina", "máquina", "depurador", "abrilhantador", "bomba", "doseador"],
          "bomba": ["lava", "maquina", "máquina", "depurador", "abrilhantador", "detergente", "doseador"],
          "cesto": ["lava", "maquina", "máquina", "escorredor", "suporte", "prateleira"],
          "doseador": ["lava", "maquina", "máquina", "depurador", "abrilhantador", "detergente"],
          "tabuleiro": ["forno", "carro", "prateleira", "armario", "armário"],
          "estante": ["armario", "armário", "vitrine", "frigorifico", "frigorífico"],
          "prateleira": ["armario", "armário", "vitrine", "frigorifico", "frigorífico", "forno", "maquina", "máquina", "lava"],
          "escorredor": ["lava", "maquina", "máquina", "cesto"],
          "carro": ["forno", "tabuleiro"],
        };
        if (current.type && candidate.type) {
          const accessories = accessoryPairs[current.type];
          if (accessories && accessories.includes(candidate.type)) {
            score += 30; reasons.push(`acessório compatível (${candidate.type})`);
          }
        }
        // Same category boost for cross-sell
        if (current.category && candidate.category && candidate.category === current.category) {
          score += 15; reasons.push("mesma categoria (complementar)");
        }
        // Same dimensions boost (fits same workspace)
        if (current.dimensions && candidate.dimensions === current.dimensions) {
          score += 10; reasons.push("mesmas dimensões");
        }
        // Text-based model match in title: if current says "para modelos HT" and candidate has "HT" in title
        const titleLower = candidate.title.toLowerCase();
        for (const model of current.models) {
          if (titleLower.includes(model) && current.type !== candidate.type) {
            score += 20; reasons.push(`nome contém modelo ${model.toUpperCase()}`);
          }
        }
      }

      return { score, reasons };
    }

    let catalogContext = "";
    let allProductAttrs: ProductAttrs[] = [];
    if (fields.includes("upsells") || fields.includes("crosssells")) {
      const { data: allProducts } = await supabase
        .from("products")
        .select("sku, original_title, optimized_title, original_description, category, original_price")
        .order("created_at", { ascending: false })
        .limit(2000);

      if (allProducts && allProducts.length > 1) {
        allProductAttrs = allProducts.filter((p: any) => p.sku).map(extractAttrs);
      }
    }

    // 13. Fetch business terminology for prompt context
    const { data: terminologyData } = await supabase
      .from("business_terminology")
      .select("term, type, replacement, category, context, disambiguation")
      .or(`workspace_id.eq.${workspaceId},is_global.eq.true`);

    const buildTerminologyPrompt = (
      contextFilter: 'title' | 'description' | 'tags',
      productCategory: string
    ): string => {
      const relevantTerms = (terminologyData || []).filter((t: any) => {
        const contextMatch = !t.context || t.context === 'all' || t.context === contextFilter;
        const categoryMatch = !t.category ||
          productCategory.toLowerCase().includes(t.category.toLowerCase()) ||
          t.category.toLowerCase().includes(productCategory.toLowerCase().split('>')[0].trim());
        return contextMatch && categoryMatch;
      });

      const avoid = relevantTerms.filter((t: any) => t.type === 'avoid');
      const preferred = relevantTerms.filter((t: any) => t.type === 'preferred');
      const synonyms = relevantTerms.filter((t: any) => t.type === 'synonym');

      const lines: string[] = [];

      if (avoid.length > 0) {
        lines.push('TERMOS PROIBIDOS (substituir obrigatoriamente):');
        avoid.forEach((t: any) => {
          const rep = t.replacement === 'CONTEXT_DEPENDENT'
            ? '[ver regra de desambiguação abaixo]'
            : `"${t.replacement}"`;
          const note = t.disambiguation ? `\n     ⚠ REGRA: ${t.disambiguation}` : '';
          lines.push(`  ✗ "${t.term}" → ${rep}${note}`);
        });
      }

      if (preferred.length > 0) {
        lines.push('\nTERMOS PREFERENCIAIS:');
        preferred.forEach((t: any) => {
          const note = t.disambiguation ? ` [${t.disambiguation}]` : '';
          lines.push(`  ✓ "${t.term}"${note}`);
        });
      }

      if (synonyms.length > 0 && contextFilter !== 'title') {
        lines.push('\nSINÓNIMOS (distribuir 1 por parágrafo, nunca repetir o termo do título):');
        synonyms.forEach((t: any) => lines.push(`  ≈ "${t.term}"`));
      }

      if (contextFilter === 'tags') {
        lines.push('\nREGRAS TAGS: nunca repetir o título exacto | máx 15 tags | incluir variações com dimensão (ex: "fritadeira 20l") | termos EN/ES de pesquisa profissional | para termos com hífen incluir SEMPRE as duas formas: com e sem hífen (ex: "snack-bar" e "snack bar", "take-away" e "take away")');
      }

      return lines.join('\n');
    };

    const results: any[] = [];

    // Process products in parallel batches of 2 (reduced to avoid WORKER_LIMIT)
    const CONCURRENCY = 2;
    for (let batchStart = 0; batchStart < productsToProcess.length; batchStart += CONCURRENCY) {
      const batch = productsToProcess.slice(batchStart, batchStart + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(async (product) => {
      try {
        let patternHints = "";

        // === SAVE VERSION BEFORE OPTIMIZING (keep max 3) — only in phase 1 or no-phase mode ===
        if (!phase || phase === 1) if (product.optimized_title || product.optimized_description) {
          // Get current version count
          const { data: existingVersions } = await supabase
            .from("product_versions")
            .select("id, version_number")
            .eq("product_id", product.id)
            .order("version_number", { ascending: false });

          const nextVersion = (existingVersions?.[0]?.version_number ?? 0) + 1;

          // Save current state as version
          await supabase.from("product_versions").insert({
            product_id: product.id,
            user_id: userId,
            version_number: nextVersion,
            optimized_title: product.optimized_title,
            optimized_description: product.optimized_description,
            optimized_short_description: product.optimized_short_description,
            meta_title: product.meta_title,
            meta_description: product.meta_description,
            seo_slug: product.seo_slug,
            tags: product.tags,
            optimized_price: product.optimized_price,
            faq: product.faq,
          });

          // Delete oldest versions if more than 3
          if (existingVersions && existingVersions.length >= 3) {
            const toDelete = existingVersions.slice(2).map((v: any) => v.id);
            if (toDelete.length > 0) {
              await supabase.from("product_versions").delete().in("id", toDelete);
            }
          }
        }
        
        // === AUTO-INFER MODEL FROM SKU IF MISSING ===
        let inferredModel = product.model;
        if (!inferredModel && product.sku) {
          const sku = product.sku;
          
          // Se o SKU tem mais de 2 caracteres, removemos as 2 primeiras letras (o prefixo do fornecedor)
          // para obter o modelo de origem puro.
          if (sku && sku.length > 2) {
            inferredModel = sku.substring(2);
          } else {
            inferredModel = sku;
          }
          console.log(`🤖 [optimize-product] Inferred model for ${sku}: ${inferredModel}`);
        }

        // 1. HYBRID RAG: keyword + trigram + family search with reranking
        // OPTIMIZATION: Skip RAG/scraping in phases 2 and 3 — context already available from phase 1
        const isLaterPhase = phase && phase > 1;
        let knowledgeContext = "";
        const allChunks: any[] = [];
        let topChunks: any[] = [];
        let ragMatchTypeCounts: Record<string, number> = {};

        if (isLaterPhase) {
          console.log(`⏭️ Phase ${phase}: skipping RAG (context from phase 1 already in product data)`);
        } else if (skipKnowledge) {
          console.log("⏭️ Knowledge base skipped (skipKnowledge=true)");
        } else {

        // Extract product family/line keywords for targeted search
        const titleRaw = product.original_title || "";
        const cleanTitle = titleRaw
          .replace(/[+\-\/\\()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // Detect product family patterns (e.g., "Linha 700", "Cesto 40", "Serie 900")
        const familyPatterns = [
          /linha\s*\d+/i, /line\s*\d+/i, /serie\s*\d+/i, /series\s*\d+/i,
          /cesto\s*\d+/i, /basket\s*\d+/i,
          /\d+\s*litros?/i, /\d+\s*l\b/i,
          /\d+x\d+/i, // dimensions like 40x40
          /\d+\s*bicos?/i, /\d+\s*queimadores?/i,
          /gn\s*\d+\/\d+/i, // gastronorm sizes
          /monof[aá]sic[oa]/i, /trif[aá]sic[oa]/i,
          /g[aá]s/i, /el[eé]tric[oa]/i,
        ];
        const familyMatches: string[] = [];
        for (const pattern of familyPatterns) {
          const match = titleRaw.match(pattern);
          if (match) familyMatches.push(match[0]);
        }
        // Also check category
        const categoryRaw = product.category || "";
        for (const pattern of familyPatterns) {
          const match = categoryRaw.match(pattern);
          if (match && !familyMatches.includes(match[0])) familyMatches.push(match[0]);
        }
        const familyKeywords = familyMatches.length > 0 
          ? familyMatches.join(" ") + " " + cleanTitle.split(" ").filter((w: string) => w.length >= 4).slice(0, 3).join(" ")
          : null;

        // Extract meaningful title words for FTS
        const titleWords = cleanTitle.split(" ").filter((w: string) => w.length >= 3 && !/^\d+$/.test(w));
        const titleQuery = titleWords.slice(0, 6).join(" ");

        // Category query
        const categoryQuery = categoryRaw
          .replace(/>/g, " ")
          .replace(/[+\-\/\\()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // SKU query  
        const skuQuery = product.sku || product.supplier_ref || "";

        // Build multiple search queries
        const searchQueries = [
          { query: titleQuery, family: familyKeywords },
          { query: categoryQuery, family: familyKeywords },
          { query: skuQuery, family: null },
        ].filter((q) => q.query.length > 2);

        // Also add a family-only search if we have family keywords
        if (familyKeywords && familyKeywords.length > 3) {
          searchQueries.push({ query: familyKeywords, family: familyKeywords });
        }

        // Run all hybrid searches in parallel
        const searchPromises = searchQueries.map(async ({ query, family }) => {
          try {
            const { data: chunks } = await supabase.rpc("search_knowledge_hybrid", {
              _query: query,
              _workspace_id: workspaceId || null,
              _family_keywords: family,
              _limit: 10,
            });
            return chunks || [];
          } catch (e: unknown) {
            // Fallback to old search if hybrid fails
            console.warn(`Hybrid search failed for "${query.substring(0, 30)}", falling back:`, e);
            try {
              const searchArgs: any = { _query: query, _limit: 8 };
              if (workspaceId) searchArgs._workspace_id = workspaceId;
              const { data: chunks } = await supabase.rpc("search_knowledge", searchArgs);
              return (chunks || []).map((c: any) => ({ ...c, match_type: "fts_fallback" }));
            } catch { return []; }
          }
        });
        const searchResults = await Promise.all(searchPromises);
        
        // Deduplicate and merge results
        const seenIds = new Set<string>();
        for (const chunks of searchResults) {
          for (const c of chunks) {
            if (!seenIds.has(c.id)) {
              seenIds.add(c.id);
              allChunks.push(c);
            }
          }
        }

        // Sort by rank and take top results
        allChunks.sort((a: any, b: any) => (b.rank || 0) - (a.rank || 0));

        // AI Reranking: if we have many chunks, use AI to pick the most relevant
        topChunks = allChunks.slice(0, 12);
        if (topChunks.length > 5 && !skipReranking) {
          try {
            const rerankPrompt = `Tens ${topChunks.length} excertos de conhecimento e precisas escolher os 6 mais relevantes para otimizar este produto:
Produto: ${product.original_title || "N/A"} | Categoria: ${product.category || "N/A"} | SKU: ${product.sku || "N/A"}
${familyKeywords ? `Família técnica: ${familyKeywords}` : ""}

Excertos:
${topChunks.map((c: any, i: number) => `[${i}] (${c.source_name || "?"}, match: ${c.match_type || "?"}): ${c.content.substring(0, 200)}`).join("\n")}

Devolve os índices dos 6 excertos mais relevantes, priorizando:
1. Informação técnica específica deste produto
2. Informação da mesma família/linha técnica
3. Fichas técnicas e tabelas de preços
4. Informação genérica sobre a categoria`;

            const rerankResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/resolve-ai-route`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({
                taskType: "knowledge_reranking",
                workspaceId: workspaceId,
                modelOverride: "gemini-2.5-flash-lite",
                providerOverride: "gemini",
                systemPrompt: "Responde APENAS com a tool call. Seleciona os excertos mais relevantes.",
                messages: [{ role: "user", content: rerankPrompt }],
                options: {
                  tools: [{
                    type: "function",
                    function: {
                      name: "select_chunks",
                      description: "Seleciona os índices dos chunks mais relevantes",
                      parameters: {
                        type: "object",
                        properties: {
                          selected_indices: {
                            type: "array",
                            items: { type: "integer" },
                            description: "Índices dos chunks selecionados (0-based)",
                          },
                          reasoning: { type: "string", description: "Breve justificação" },
                        },
                        required: ["selected_indices"],
                        additionalProperties: false,
                      },
                    },
                  }],
                  tool_choice: { type: "function", function: { name: "select_chunks" } },
                },
              }),
            });

            if (rerankResponse.ok) {
              const rerankWrapper = await rerankResponse.json();
              const rerankData = rerankWrapper.result || rerankWrapper;
              const rerankCall = rerankData.choices?.[0]?.message?.tool_calls?.[0];
              if (rerankCall) {
                const { selected_indices, reasoning } = JSON.parse(rerankCall.function.arguments);
                if (Array.isArray(selected_indices) && selected_indices.length > 0) {
                  const reranked = selected_indices
                    .filter((i: number) => i >= 0 && i < topChunks.length)
                    .map((i: number) => topChunks[i]);
                  if (reranked.length >= 3) {
                    topChunks = reranked;
                    console.log(`🧠 AI Reranking: selected ${reranked.length} chunks. Reason: ${reasoning || "N/A"}`);
                  }
                }
              }
            }
          } catch (rerankErr) {
            console.warn("AI reranking failed (non-fatal), using rank-sorted chunks:", rerankErr);
          }
        } else if (topChunks.length > 5 && skipReranking) {
          console.log("⏭️ AI Reranking skipped (skipReranking=true), using top 6 by rank");
          topChunks = topChunks.slice(0, 6);
        }

        // Cap at 8 after reranking
        topChunks = topChunks.slice(0, 8);

        // Count match types for RAG metrics
        ragMatchTypeCounts = {};
        if (topChunks.length > 0) {
          topChunks.forEach((c: any) => {
            const mt = c.match_type || "unknown";
            ragMatchTypeCounts[mt] = (ragMatchTypeCounts[mt] || 0) + 1;
          });
          const matchSummary = Object.entries(ragMatchTypeCounts).map(([k, v]) => `${k}:${v}`).join("+");
          console.log(`✅ Hybrid RAG: ${topChunks.length} chunks (${matchSummary}) from: ${[...new Set(topChunks.map((c: any) => c.source_name))].join(", ")}${familyKeywords ? ` | Family: ${familyKeywords}` : ""}`);
          const parts = topChunks.map((c: any) => `[${c.source_name}] ${c.content}`).join("\n\n");
          knowledgeContext = `\n\nINFORMAÇÃO DE REFERÊNCIA (conhecimento relevante — hybrid RAG: keywords + fuzzy + família técnica):\n${parts.substring(0, 14000)}`;
        } else {
          console.log(`⚠️ No knowledge found via hybrid search for: "${titleQuery.substring(0, 30)}" (workspace: ${workspaceId || "all"})${familyKeywords ? ` | Family: ${familyKeywords}` : ""}`);
        }
        } // end of skipKnowledge else block

        // 2. Auto-scrape supplier page by SKU
        let supplierContext = "";
        if (isLaterPhase) {
          console.log(`⏭️ Phase ${phase}: skipping supplier scraping (already done in phase 1)`);
        } else if (skipScraping) {
          console.log("⏭️ Supplier scraping skipped (skipScraping=true)");
        } else if (FIRECRAWL_API_KEY && product.sku && product.sku.length > 2) {
          const skuUpper = product.sku.toUpperCase();
          const matchedSupplier = supplierMappings.find((s) => 
            skuUpper.startsWith(s.prefix.toUpperCase())
          );

          if (matchedSupplier) {
            try {
              const prefixLen = matchedSupplier.prefix.length;
              const cleanSku = product.sku.substring(prefixLen);
              const supplierUrl = matchedSupplier.url.endsWith("=") || matchedSupplier.url.endsWith("/")
                ? `${matchedSupplier.url}${encodeURIComponent(cleanSku)}`
                : `${matchedSupplier.url}/${encodeURIComponent(cleanSku)}`;
              console.log(`Auto-scraping supplier [${matchedSupplier.prefix}] for SKU ${product.sku}: ${supplierUrl}`);

              const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  url: supplierUrl,
                  formats: ["markdown"],
                  onlyMainContent: true,
                  waitFor: 2000,
                }),
              });

              if (scrapeResponse.ok) {
                const scrapeData = await scrapeResponse.json();
                const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
                if (markdown.length > 100) {
                  supplierContext = `\n\nINFORMAÇÃO DO FORNECEDOR "${matchedSupplier.name || matchedSupplier.prefix}" (página do produto):\n${markdown.substring(0, 8000)}`;
                  console.log(`Got ${markdown.length} chars from supplier page`);
                }
              } else {
                console.warn(`Supplier scrape failed: ${scrapeResponse.status}`);
              }
            } catch (scrapeErr) {
              console.warn("Auto-scrape error (non-fatal):", scrapeErr);
            }
          } else {
            console.log(`No supplier mapping found for SKU prefix of: ${product.sku}`);
          }
        }

        // Fetch parent product context for variations
        let parentContext = "";
        let parentProduct: any = null;
        if (product.product_type === "variation" && product.parent_product_id) {
          const { data: parent } = await supabase
            .from("products")
            .select("*")
            .eq("id", product.parent_product_id)
            .maybeSingle();
          if (parent) {
            parentProduct = parent;
            parentContext = `\n\nPRODUTO PAI (variable):
- Título: ${parent.optimized_title || parent.original_title || "N/A"}
- Descrição: ${(parent.optimized_description || parent.original_description || "").substring(0, 1000) || "N/A"}
- Descrição Curta: ${parent.optimized_short_description || parent.short_description || "N/A"}
- Categoria: ${parent.category || "N/A"}
- Atributos do pai: ${JSON.stringify(parent.attributes || [])}
IMPORTANTE: Esta é uma VARIAÇÃO. Mantém consistência com o produto pai. Adapta o título e descrição com o sufixo do atributo específico desta variação.`;
          }
        }

        // For variable products, add info about variations
        let variationsContext = "";
        if (product.product_type === "variable") {
          const { data: variations } = await supabase
            .from("products")
            .select("sku, original_title, attributes")
            .eq("parent_product_id", product.id)
            .limit(50);
          if (variations && variations.length > 0) {
            variationsContext = `\n\nEste é um produto VARIÁVEL com ${variations.length} variações:
${variations.map((v: any) => `- SKU: ${v.sku} | ${v.original_title} | Attrs: ${JSON.stringify(v.attributes || [])}`).join("\n")}
IMPORTANTE: Otimiza o conteúdo BASE que será propagado para todas as variações. Não incluas atributos específicos (cor, tamanho) no título/descrição do pai.`;
          }
        }

        // === FASE 1: Limpeza HTML inteligente (sem truncar) ===
        // Remove apenas lixo (HTML, estilos, scripts, boilerplate). Preserva 100% da informação técnica.
        const descClean = cleanHtmlContentWithStats(product.original_description);
        const shortDescClean = cleanHtmlContentWithStats(product.short_description);
        const techClean = cleanHtmlContentWithStats(product.technical_specs);
        if (descClean.reductionPct >= 30 || techClean.reductionPct >= 30) {
          console.log(
            `🧹 [optimize-product] HTML cleanup for ${product.sku || product.id}: ` +
            `desc ${descClean.originalLength}→${descClean.cleanedLength} (-${descClean.reductionPct}%), ` +
            `short ${shortDescClean.originalLength}→${shortDescClean.cleanedLength} (-${shortDescClean.reductionPct}%), ` +
            `tech ${techClean.originalLength}→${techClean.cleanedLength} (-${techClean.reductionPct}%)`
          );
        }

        // === FASE 1.1: Extração de Sinónimos SEO ===
        const productSynonyms = getSynonymsForProduct(product.original_title || product.optimized_title || "");
        const synonymsContext = productSynonyms.length > 0
          ? `\n\nSINÓNIMOS SEO RELEVANTES (inclui estes termos naturalmente na descrição para melhorar o SEO):\n${productSynonyms.join(", ")}`
          : "";
        console.log(`🔍 [optimize-product] Found ${productSynonyms.length} synonyms for "${product.sku || product.id}"`);

        const productInfo = `Produto original:
- Título: ${product.original_title || "N/A"}
- Descrição: ${descClean.cleaned || "N/A"}
- Descrição Curta: ${shortDescClean.cleaned || "N/A"}
- Características Técnicas: ${techClean.cleaned || "N/A"}
- Categoria: ${product.category || "N/A"}
- Preço: ${product.original_price || "N/A"}€
- SKU: ${product.sku || "N/A"}
- Ref. Fornecedor: ${product.supplier_ref || "N/A"}
- Tipo: ${product.product_type || "simple"}
- Atributos: ${JSON.stringify(product.attributes || [])}${parentContext}${variationsContext}${synonymsContext}${
  (phase === 2 || phase === 3) ? `\n\nDADOS JÁ OTIMIZADOS (Fase anterior):
- Título Otimizado: ${product.optimized_title || "N/A"}
- Descrição Otimizada: ${(product.optimized_description || "").substring(0, 500) || "N/A"}
- Descrição Curta Otimizada: ${product.optimized_short_description || "N/A"}
- Tags: ${(product.tags || []).join(", ") || "N/A"}
- Focus Keywords: ${(product.focus_keyword || []).join(", ") || "N/A"}` : ""}`;

        // === COMPATIBILITY ENGINE: score products for upsell/cross-sell ===
        let productCatalogContext = "";
        if (allProductAttrs.length > 0 && (fields.includes("upsells") || fields.includes("crosssells"))) {
          const currentAttrs = extractAttrs(product);
          
          // Score all candidates
          const upsellCandidates: { attrs: ProductAttrs; score: number; reasons: string[] }[] = [];
          const crosssellCandidates: { attrs: ProductAttrs; score: number; reasons: string[] }[] = [];
          
          for (const candidate of allProductAttrs) {
            if (candidate.sku === currentAttrs.sku) continue;
            
            if (fields.includes("upsells")) {
              const { score, reasons } = computeCompatibility(currentAttrs, candidate, "upsell");
              if (score > 10) upsellCandidates.push({ attrs: candidate, score, reasons });
            }
            if (fields.includes("crosssells")) {
              const { score, reasons } = computeCompatibility(currentAttrs, candidate, "crosssell");
              if (score > 10) crosssellCandidates.push({ attrs: candidate, score, reasons });
            }
          }
          
          // Sort by score and take top
          upsellCandidates.sort((a, b) => b.score - a.score);
          crosssellCandidates.sort((a, b) => b.score - a.score);
          
          const topUpsells = upsellCandidates.slice(0, 10);
          const topCrosssells = crosssellCandidates.slice(0, 10);
          
          const parts: string[] = [];
          if (topUpsells.length > 0) {
            parts.push(`\nPRODUTOS CANDIDATOS A UPSELL (pré-filtrados por compatibilidade técnica — score de confiança):`);
            for (const u of topUpsells) {
              parts.push(`  SKU: ${u.attrs.sku} | ${u.attrs.title} | ${u.attrs.price}€ | Score: ${u.score}/100 | ${u.reasons.join(", ")}`);
            }
          }
          if (topCrosssells.length > 0) {
            parts.push(`\nPRODUTOS CANDIDATOS A CROSS-SELL (pré-filtrados por compatibilidade técnica — score de confiança):`);
            for (const c of topCrosssells) {
              parts.push(`  SKU: ${c.attrs.sku} | ${c.attrs.title} | ${c.attrs.price}€ | Score: ${c.score}/100 | ${c.reasons.join(", ")}`);
            }
          }
          
          if (parts.length > 0) {
            productCatalogContext = `\n${parts.join("\n")}`;
            console.log(`🎯 Compatibility: ${topUpsells.length} upsell candidates (top: ${topUpsells[0]?.score || 0}), ${topCrosssells.length} cross-sell candidates (top: ${topCrosssells[0]?.score || 0})`);
            // Also keep detected attributes for logging
            console.log(`📋 Product attrs: type=${currentAttrs.type}, line=${currentAttrs.line}, energy=${currentAttrs.energy}, capacity=${currentAttrs.capacity}, dims=${currentAttrs.dimensions}`);
          }
        }
        
        // Use compatibility-filtered catalog instead of raw dump
        catalogContext = productCatalogContext;

        // Build field-specific instructions using per-field prompts
        // Default prompts match the frontend defaults in useFieldPrompts.ts
        const productCat = product.category || '';
        const terminologyForTitle = buildTerminologyPrompt('title', productCat);
        const terminologyForDescription = buildTerminologyPrompt('description', productCat);
        const terminologyForTags = buildTerminologyPrompt('tags', productCat);

        const DEFAULT_FIELD_PROMPTS: Record<string, string> = {
          title: `Gera um título otimizado para SEO (50-60 chars) em Português de Portugal (PT-PT).
REGRAS OBRIGATÓRIAS:
- NUNCA incluas "HORECA" no título.
- TERMINOLOGIA PROFISSIONAL: Prioriza termos como "Hotte" em vez de "Campânula" se for para exaustão industrial.
- TRADUZ OBRIGATORIAMENTE termos em Espanhol para Português (ex: "Campana" -> "Hotte" ou "Campânula").
- Foco: Tipo de Produto + Característica Distintiva + Dimensão/Capacidade.
- Usar termo específico se necessário: "Profissional", "Industrial", "Comercial".
- NÃO incluas marca ou códigos EAN no título.
- PRESERVA apenas a referência técnica/modelo (ex: "CHST400B") se for a forma principal como o produto é conhecido, integrando-a no fim.
- NÃO inventes especificações.
- Inclui linha/série se aplicável (ex: "Linha 700").
- Inclui tipo de energia se aplicável (Gás, Elétrico).
${terminologyForTitle}\nREGRAS TÍTULO: Dimensões sempre abreviadas no título (20L, 600mm, GN 1/1). Nunca marca, EAN, HORECA. "Fregadero" → verificar estrutura antes de traduzir. "Vitrina" → ler descrição completa antes de classificar.`,
          description: `Gera uma descrição otimizada (HTML) que soe humana e natural e inclua OBRIGATORIAMENTE sinónimos relevantes para SEO.
${terminologyForDescription}\nREGRAS ANTI-REPETIÇÃO: Se o título usa termo X, a descrição usa os sinónimos de X — NUNCA o mesmo termo do título no primeiro parágrafo. Máximo 1 sinónimo por parágrafo. Nunca o mesmo sinónimo 2x em toda a descrição.\nTERMOS PROIBIDOS (brasileirismos e erros): "cocção"→"confeção"; "lanchonete"→"snack-bar"; "geladeira"→"frigorífico"; "cardápio"→"ementa"; "garçom"→"empregado de mesa"; "fast casual"→"restauração rápida"; "buffet line"→"linha de buffet".
REGRAS DE LINGUAGEM NATURAL — OBRIGATÓRIO:
- NUNCA soar robótico ou repetitivo. Limitar "HORECA" a máx 1 menção.
- OTIMIZAÇÃO SEO: Inclui OBRIGATORIAMENTE os sinónimos fornecidos de forma fluída no texto (ex: se o produto é um 'Exaustor', deves usar também 'hotte', 'coifa' e 'campânula' ao longo da descrição).
- REVISÃO DE TEXTO: Garante que as palavras estão separadas corretamente (ex: NUNCA escrever "hottede", escreve sempre "hotte de").
- Substituir "HORECA" por: "o seu restaurante", "o seu bar", "cozinhas profissionais".
- Dirigir-se ao cliente: "Perfeito para o seu bar", "A sua equipa vai apreciar".
- VARIAR CONSTRUÇÕES: Nunca começar parágrafos seguidos com "Este equipamento...".
- BENEFÍCIOS REAIS: Impacto no negócio (custos, ruído, rapidez) em vez de apenas specs.

ESTRUTURA OBRIGATÓRIA:
Envolve TUDO num div: <div class="product-description" style="font-size:15px; line-height:1.65; color:#2c2c2c;"> ... </div> (Obrigatório fechar o div no final).
Usa h3 com OBRIGATÓRIO — Todos os h3 DEVEM ter EXACTAMENTE este style, sem excepção: style="margin:0 0 10px; font-size:18px; font-weight:700; color:#00526d; border-bottom:2px solid #e5e7eb; padding-bottom:6px;"

1. <div class="product-benefits" style="margin-bottom:22px;"> com <h3>[Keyword curta do produto — máx 5 palavras] — Principais Vantagens</h3>
REGRA ABSOLUTA: Apenas UM segmento antes de "— Principais Vantagens". 
CORRECTO: "Hotte Exaustora 1200mm — Principais Vantagens"
ERRADO: "hotte exaustora profissional — Hotte Júnior Snack 1200mm — Principais Vantagens"
Se a focus keyword já aparece antes do "—", NÃO a repetir depois.
2. <div class="product-applications" style="margin-bottom:22px;"> com <h3>Aplicações</h3> (Contextos concretos: "buffet de hotel", "cafetaria movimentada")
FORMATO INTELIGENTE — escolhe conforme o produto:
- Equipamentos principais (vitrines, fornos, fritadeiras, máquinas de lavar, grelhadores): 1-2 parágrafos em PROSA FLUÍDA, SEM bullet points.
- Produtos simples/versáteis (cubas GN, talheres, acessórios, utensílios): lista curta com 4-5 bullets é aceitável.
Em ambos os casos: usar contextos reais (buffet de hotel, cafetaria, restaurante, catering, fast food, snack-bar).
3. <div class="product-specs" style="margin-bottom:22px;"> com <h3>Características Técnicas</h3> (Tabela HTML completa com TODAS as especificações, exceto Marca, Modelo e EAN)
4. <div class="product-faq" style="margin-bottom:22px;"> com <h3>Perguntas Frequentes</h3> (EXATAMENTE 5 perguntas detalhadas) (NUNCA uses "Campana" nas perguntas se o produto for uma Campânula)
REGRA HTML: O div raiz <div class="product-description"> DEVE ser fechado com </div> no final. Verificar que cada <div> aberto tem o seu </div> correspondente.`,

          short_description: `Gera uma descrição curta (máx 160 chars) para listagens.
CONTEÚDO NATURAL: NUNCA usar \"HORECA\". Substituir por contextos específicos.`,
          meta_title: `Gera meta title SEO (máx 60 chars).
- Keyword principal no início.
- Inclui \"Comprar\" ou \"Preço\".
- NÃO incluas marca, códigos EAN ou referências.`,
          meta_description: `Gera meta description SEO (140-155 chars).
REGRAS OBRIGATÓRIAS:
- NUNCA usar \"HORECA\". Usar: \"restaurantes\", \"hotéis\", \"bares\".
- Dirigir-se ao cliente: \"para o seu restaurante\", \"ideal para o seu bar\".
- Benefício concreto + contexto específico + call-to-action (ex: \"Entrega 24-48h\").
- NÃO incluas marca. Usa linguagem que gere cliques.`,
          meta_description: `Gera meta description SEO (140-155 chars).
REGRAS OBRIGATÓRIAS:
- NUNCA usar \"HORECA\". Usar: \"restaurantes\", \"hotéis\", \"bares\".
- Dirigir-se ao cliente: \"para o seu restaurante\", \"ideal para o seu bar\".
- Benefício concreto + contexto específico + call-to-action (ex: \"Entrega 24-48h\").
- NÃO incluas marca. Usa linguagem que gere cliques.`,
          seo_slug: `Gera um slug SEO-friendly.
REGRAS OBRIGATÓRIAS:
- Lowercase, sem acentos, com hífens
- Inclui keyword principal + tipo + linha
- NÃO incluas marca no slug
- NÃO incluas códigos EAN ou referências no slug
- Máx 5-7 palavras
- Exemplo: fritadeira-gas-linha-700-8-litros`,
          tags: `${terminologyForTags}`,
          price: `Sugere um preço otimizado.
REGRAS:
- Mantém o preço original se parecer correto para o mercado
- Ajusta ligeiramente se for claramente abaixo ou acima do mercado
- Considera o posicionamento do produto (entrada, médio, premium)`,
          faq: `Gera EXATAMENTE 5 FAQs sobre o produto.
REGRAS OBRIGATÓRIAS:
- Gera SEMPRE 5 perguntas relevantes. Se não houver informação suficiente, gera perguntas baseadas nas especificações técnicas e aplicação prática.
- Pergunta sobre dimensões/espaço necessário
- Pergunta sobre instalação/requisitos (gás, electricidade, água)
- Pergunta sobre manutenção/limpeza
- Pergunta sobre garantia/assistência se aplicável
- Pergunta sobre acessórios incluídos/compatíveis
- Respostas detalhadas e úteis (não genéricas)`,
          upsells: `Sugere 2-4 produtos SUPERIORES do catálogo como upsell.
REGRAS OBRIGATÓRIAS:
- Usa APENAS SKUs reais do catálogo fornecido
- Prioriza: mesmo tipo mas maior capacidade, mesma linha mas modelo superior
- NÃO sugiras produtos de categorias completamente diferentes
- NÃO incluas o próprio produto`,
          crosssells: `Sugere 2-4 produtos COMPLEMENTARES do catálogo como cross-sell.
REGRAS OBRIGATÓRIAS:
- Usa APENAS SKUs reais do catálogo fornecido
- Prioriza: acessórios, produtos da mesma linha/família, consumíveis
- Procura produtos que formem uma "estação de trabalho" completa
- NÃO sugiras produtos redundantes`,
          image_alt: `Gera alt text SEO para CADA UMA das imagens do produto (máx 125 chars cada).
REGRAS OBRIGATÓRIAS:
- Deves gerar EXATAMENTE 1 alt text por cada URL de imagem fornecida — sem exceção
- Usa OBRIGATORIAMENTE o título otimizado em português como base para o alt text
- NÃO incluas a marca no alt text
- Inclui keyword principal + linha/modelo
- Tom descritivo e direto, sem nomes de marcas
- Inclui ângulo/perspetiva se possível (ex: "vista frontal", "detalhe do painel")
- Não comeces com "Imagem de" — sê direto
- Se houver imagens originais e optimizadas do mesmo produto, diferencia os alt texts`,
          certifications: `Identifica certificações relevantes baseadas na ficha técnica (ex: CE, HACCP, NSF, RoHS).
REGRAS OBRIGATÓRIAS:
- Devolve apenas um array de strings ["CE", "HACCP"]
- Se não encontrares nada, devolve apenas ["CE"]
- NUNCA inventes certificações que não estejam implícitas ou explícitas`,
          category: `Analisa o produto e sugere a melhor categoria e subcategoria da taxonomia fornecida.
REGRAS OBRIGATÓRIAS:
- Usa o formato "Categoria > Subcategoria" (ex: "Cozinha > Fritadeiras").
- ESPECIFICIDADE: Escolhe sempre o nó mais profundo (folha).
- ALINHAMENTO DE KEYWORDS: Se o título contém "Kebab", prefere "Assadores Kebab" em vez de "Assadores de Frangos e Kebab".
- MEILISEARCH: Usa os produtos similares como guia, mas se a nossa taxonomia local tiver uma categoria mais específica para o termo principal do produto, usa a local.
- Se o produto for um acessório, extra ou peça de substituição (ex: estante, prateleira, grelha, cesto), procura OBRIGATORIAMENTE uma subcategoria chamada "Acessorios" dentro do setor correto.
- Se a categoria atual parecer incorreta, sugere uma melhor baseada nas CATEGORIAS DISPONÍVEIS listadas abaixo.
- Prioriza categorias que já existam no catálogo.
- NUNCA inventes ou cries categorias novas. Se não houver uma correspondência exata, escolhe a categoria existente mais próxima.`,
        };

        const getFieldPrompt = (key: string, fallback: string) => {
          return fieldPrompts[`prompt_field_${key}`] || DEFAULT_FIELD_PROMPTS[key] || fallback;
        };

        // If description already has FAQ section, extract from there instead of generating new ones
        if (
          fields.includes("faq") &&
          typeof product.optimized_description === "string" &&
          product.optimized_description.includes("product-faq")
        ) {
          // Remove faq from fields — will be extracted from existing description
          fields = fields.filter((f: string) => f !== "faq");
          console.log("[optimize-product] FAQ will be extracted from existing description, not regenerated");
        }

        const fieldInstructions: string[] = [];
        if (fields.includes("title")) fieldInstructions.push(`TÍTULO:\n${getFieldPrompt("title", "Um título otimizado")}`);
        if (fields.includes("description")) {
          // If a description-type prompt template was selected, use its text as the field prompt
          // This ensures Bullet Points vs Paragraph format is respected in the user prompt too
          let descPrompt: string;
          if (descriptionTemplateOverride) {
            descPrompt = descriptionTemplateOverride;
            console.log(`📋 Using description template override for field prompt (${descPrompt.substring(0, 60)}...)`);
          } else {
            descPrompt = getFieldPrompt("description", "Uma descrição otimizada");
          }
          if (descriptionTemplate) {
            descPrompt += `\n\nTEMPLATE DE ESTRUTURA OBRIGATÓRIO — segue EXATAMENTE esta estrutura, substituindo as variáveis {{...}} pelo conteúdo gerado:\n${descriptionTemplate}`;
          }
          fieldInstructions.push(`DESCRIÇÃO COMPLETA:\n${descPrompt}`);
        }
        if (fields.includes("short_description")) fieldInstructions.push(`DESCRIÇÃO CURTA:\n${getFieldPrompt("short_description", "Descrição curta concisa")}`);
        if (fields.includes("meta_title")) fieldInstructions.push(`META TITLE:\n${getFieldPrompt("meta_title", "Meta title SEO")}`);
        if (fields.includes("meta_description")) fieldInstructions.push(`META DESCRIPTION:\n${getFieldPrompt("meta_description", "Meta description SEO")}`);
        if (fields.includes("seo_slug")) fieldInstructions.push(`SEO SLUG:\n${getFieldPrompt("seo_slug", "SEO slug")}`);
        if (fields.includes("tags")) fieldInstructions.push(`TAGS:\n${getFieldPrompt("tags", "Tags relevantes")}`);
        
        if (fields.includes("faq")) fieldInstructions.push(`FAQ:\n${getFieldPrompt("faq", "FAQ com 3-5 perguntas")}`);
        if (fields.includes("upsells")) fieldInstructions.push(`UPSELLS (escolhe dos candidatos pré-filtrados acima):\n${getFieldPrompt("upsells", "Sugere upsells com SKUs REAIS")}`);
        if (fields.includes("crosssells")) fieldInstructions.push(`CROSS-SELLS (escolhe dos candidatos pré-filtrados acima):\n${getFieldPrompt("crosssells", "Sugere cross-sells com SKUs REAIS")}`);
        if (fields.includes("image_alt") && product.image_urls && product.image_urls.length > 0) {
          fieldInstructions.push(`ALT TEXT IMAGENS (${product.image_urls.length} imagens):\n${getFieldPrompt("image_alt", "Alt text descritivo")}`);
        }
        if (fields.includes("category")) {
          // 🧠 Build pattern-aware category hints (if learnedPatterns exists and has results)
          // We check for learnedPatterns which was fetched once at the top level
          if (typeof learnedPatterns !== 'undefined' && learnedPatterns && learnedPatterns.length > 0) {
            const patternsByCategory = new Map<string, string[]>();
            
            for (const pattern of learnedPatterns) {
              if (!patternsByCategory.has(pattern.category_id)) {
                patternsByCategory.set(pattern.category_id, []);
              }
              
              let hint = "";
              if (pattern.pattern_type === "title_keyword") {
                hint = `título contém "${pattern.pattern_value}"`;
              } else if (pattern.pattern_type === "attribute_value") {
                hint = `${pattern.pattern_key} = "${pattern.pattern_value}"`;
              } else if (pattern.pattern_type === "brand_model") {
                hint = `marca/modelo: ${pattern.pattern_value}`;
              }
              
              if (hint) {
                patternsByCategory.get(pattern.category_id)!.push(
                  `${hint} (${Math.round(pattern.confidence * 100)}% confiança)`
                );
              }
            }

            // Build hint text
            const hintLines: string[] = [];
            for (const [catId, hints] of patternsByCategory.entries()) {
              const cat = existingCategories.find(c => c.id === catId);
              if (cat && hints.length > 0) {
                hintLines.push(`- ${cat.full_path}: ${hints.join(", ")}`);
              }
            }

            if (hintLines.length > 0) {
              patternHints = `\n\n🧠 PADRÕES APRENDIDOS (baseado em produtos já categorizados):\n${hintLines.join("\n")}`;
            }
          }

          // Use semantic matching to find best candidate categories
          const catPaths = existingCategories.map(c => c.full_path);
          const semanticMatches = findSemanticCategory(
            product.title || product.original_title || "",
            product.category || product.original_description || "",
            catPaths
          );

          // Query Meilisearch for similar products
          const similarProducts = await findSimilarProductsInMeilisearch(
            product.title || product.original_title || "",
            product.short_description || ""
          );

          const similarContext = similarProducts.length > 0
            ? `\n\nPRODUTOS SIMILARES JÁ PUBLICADOS (referência principal):\n${
                similarProducts.map(p => {
                  let path = p.category;
                  // Se o Meilisearch trouxer um caminho incompleto (apenas 1 nível), 
                  // tenta encontrar o caminho completo na nossa taxonomia local
                  if (!path.includes(">")) {
                    const match = existingCategories.find(c => c.full_path.endsWith(path));
                    if (match) path = match.full_path;
                  }
                  return `- "${p.title}" → ${path}`;
                }).join("\n")
              }`
            : "";

          // Prefer hierarchical categories (with ">") for better context
          const hierarchicalCats = existingCategories.filter(c => c.full_path.includes(">"));
          const catsToUse = hierarchicalCats.length > 0 ? hierarchicalCats : existingCategories;
          
          const catList = catsToUse.length > 0
            ? `\n\nCATEGORIAS DISPONÍVEIS (usa APENAS uma destas - escolhe o nó folha mais específico):\n${catsToUse.map(c => `- [${c.id}] ${c.full_path}`).join("\n")}`
            : "";
          const semanticHint = semanticMatches.length > 0
            ? `\n\nCATEGORIAS MAIS RELEVANTES (por análise semântica): ${semanticMatches.join(", ")}`
            : "";
          const noCatHint = !product.category 
            ? "\n\nATENÇÃO: Este produto NÃO tem categoria atribuída. Analisa os dados para sugerir a melhor categoria da lista."
            : "";
          const accessoryRule = "\n\nREGRA DE ACESSÓRIOS: Se o produto for uma peça ou extra, escolhe OBRIGATORIAMENTE uma subcategoria 'Acessorios'.";
          fieldInstructions.push(`CATEGORIA SUGERIDA:\n${getFieldPrompt("category", "Escolhe a categoria mais específica da lista.")}${similarContext}${catList}${semanticHint}${patternHints}${accessoryRule}${noCatHint}`);
        }

        const defaultPrompt = `Optimiza o seguinte produto de e-commerce para SEO e conversão em português europeu.

${productInfo}${knowledgeContext}${supplierContext}${catalogContext}

INSTRUÇÕES POR CAMPO:
${fieldInstructions.join("\n\n---\n\n")}

REGRAS GLOBAIS (MÁXIMA PRIORIDADE — violações resultam em rejeição):
- NUNCA incluas o nome da marca/fabricante (ex: LIZOTEL, Zanussi, Sammic, Fagor, Electrolux, etc.) em NENHUM campo de texto (título, descrição, meta title, meta description, slug, tags, alt text). A marca é tratada separadamente como atributo técnico.
- NUNCA incluas códigos EAN, GTIN, códigos de barras, referências numéricas de fornecedor ou SKUs no título ou na descrição curta.
- NUNCA incluas quantidades de embalagem (ex: "Pack 6", "caixa de 12") no título.
- Mantém specs técnicas na tabela, texto comercial nos parágrafos
- Se existir informação de referência ou do fornecedor, usa-a
- Para upsells/cross-sells, usa APENAS SKUs do catálogo. NÃO inventes.
- Traduz tudo para português europeu.
- Gera SEMPRE 1 a 3 focus keywords SEO principais (a primeira é a principal). Devem ser keywords de pesquisa reais que um comprador usaria no Google.`;

        // Category-aware writing context: add domain-specific quality cues
        const categoryLower = (product.category || "").toLowerCase();
        const CATEGORY_WRITING_CUES: Record<string, string> = {
          "frio": "Foca em: gama de temperaturas, eficiência energética (classe), capacidade em litros, tipo de refrigerante, isolamento, consumo kWh.",
          "refrigera": "Foca em: gama de temperaturas, eficiência energética (classe), capacidade em litros, tipo de refrigerante, isolamento, consumo kWh.",
          "congela": "Foca em: temperatura mínima, velocidade de congelação, capacidade, isolamento, classe energética.",
          "inox": "Foca em: grau de aço (AISI 304/430), higiene HACCP, resistência à corrosão, facilidade de limpeza, durabilidade.",
          "lavagem": "Foca em: ciclos de lavagem (segundos), consumo de água por ciclo, temperatura de enxaguamento, capacidade de cestos, tipo de detergente.",
          "lava": "Foca em: ciclos de lavagem (segundos), consumo de água por ciclo, temperatura de enxaguamento, capacidade de cestos.",
          "forno": "Foca em: tipo (conveção/combinado/pizza), número de tabuleiros/GN, gama de temperatura, potência, fonte de energia.",
          "fritadeira": "Foca em: capacidade em litros, tipo de energia (gás/elétrico), potência, dimensões do cesto, produtividade kg/h.",
          "grelhador": "Foca em: superfície útil, tipo de energia, potência, material da grelha, produtividade.",
          "chapa": "Foca em: superfície útil (lisa/estriada/mista), espessura da placa, tipo de energia, potência.",
        };
        let categoryWritingCue = "";
        for (const [key, cue] of Object.entries(CATEGORY_WRITING_CUES)) {
          if (categoryLower.includes(key)) {
            categoryWritingCue = `\n\nCONTEXTO DE CATEGORIA (${key}): ${cue}`;
            break;
          }
        }

        const finalPrompt = customPrompt
          ? `${customPrompt}\n\n${productInfo}${knowledgeContext}${supplierContext}${catalogContext}${categoryWritingCue}\n\nINSTRUÇÕES POR CAMPO:\n${fieldInstructions.join("\n\n---\n\n")}`
          : `${defaultPrompt}${categoryWritingCue}`;

        // Build tool properties dynamically
        const toolProperties: Record<string, any> = {};
        const requiredFields: string[] = [];

        if (fields.includes("title")) { toolProperties.optimized_title = { type: "string" }; requiredFields.push("optimized_title"); }
        if (fields.includes("description")) { toolProperties.optimized_description = { type: "string", description: "Descrição completa com: parágrafo comercial + tabela HTML de specs + secção FAQ em HTML" }; requiredFields.push("optimized_description"); }
        if (fields.includes("short_description")) { toolProperties.optimized_short_description = { type: "string", description: "Descrição curta concisa para listagens, máx 160 chars" }; requiredFields.push("optimized_short_description"); }
        if (fields.includes("meta_title")) { toolProperties.meta_title = { type: "string" }; requiredFields.push("meta_title"); }
        if (fields.includes("meta_description")) { toolProperties.meta_description = { type: "string" }; requiredFields.push("meta_description"); }
        if (fields.includes("seo_slug")) { toolProperties.seo_slug = { type: "string" }; requiredFields.push("seo_slug"); }
        if (fields.includes("tags")) { toolProperties.tags = { type: "array", items: { type: "string" } }; requiredFields.push("tags"); }
        
        if (fields.includes("faq")) {
          toolProperties.faq = {
            type: "array",
            items: {
              type: "object",
              properties: { question: { type: "string" }, answer: { type: "string" } },
              required: ["question", "answer"],
            },
          };
          requiredFields.push("faq");
        }
        if (fields.includes("upsells")) {
          toolProperties.upsell_skus = {
            type: "array",
            description: "SKUs reais de produtos superiores sugeridos como upsell (apenas os SKUs, sem títulos)",
            items: { type: "string" },
          };
          requiredFields.push("upsell_skus");
        }
        if (fields.includes("crosssells")) {
          toolProperties.crosssell_skus = {
            type: "array",
            description: "SKUs reais de produtos complementares sugeridos como cross-sell (apenas os SKUs, sem títulos)",
            items: { type: "string" },
          };
          requiredFields.push("crosssell_skus");
        }
        if (fields.includes("image_alt") && product.image_urls && product.image_urls.length > 0) {
          toolProperties.image_alt_texts = {
            type: "array",
            description: "Alt text SEO para cada imagem do produto, na mesma ordem",
            items: {
              type: "object",
              properties: { url: { type: "string" }, alt_text: { type: "string" } },
              required: ["url", "alt_text"],
            },
          };
          requiredFields.push("image_alt_texts");
        }
        if (fields.includes("category")) {
          toolProperties.suggested_category = { type: "string", description: "Categoria principal sugerida no formato 'Categoria > Subcategoria'. DEVE ser uma das categorias existentes fornecidas na lista." };
          toolProperties.suggested_categories = {
            type: "array",
            description: "Até 3 sugestões de categorias alternativas caso a principal não seja a ideal.",
            items: {
              type: "object",
              properties: {
                category_id: { type: "string", description: "ID da categoria (UUID extraído da lista fornecida)" },
                category_name: { type: "string", description: "Nome da categoria (formato 'Pai > Filho')" },
                confidence_score: { type: "number", description: "Nível de confiança de 0 a 1" },
                reasoning: { type: "string", description: "Breve explicação da escolha" }
              },
              required: ["category_id", "category_name", "confidence_score"]
            }
          };
          toolProperties.optimization_notes = {
            type: "string",
            description: "Preencher APENAS se tiveres dúvidas sobre a classificação do produto. Ex: 'Vitrine 1500 vidro curvo — não foi possível determinar se é pastelaria ou charcutaria'. Deixar vazio se sem dúvidas."
          };
          requiredFields.push("suggested_category", "suggested_categories");
        }
        // Only generate focus keywords in phase 1 (or when no phase is set)
        if (!phase || phase === 1) {
          toolProperties.focus_keywords = {
            type: "array",
            description: "1 a 3 focus keywords SEO principais para este produto, ordenadas por relevância. A primeira é a principal.",
            items: { type: "string" },
          };
          requiredFields.push("focus_keywords");
        }

        const aiResponse = await callResolveAiRouteWithRetry({
          taskType: "product_optimization",
          workspaceId: workspaceId,
          modelOverride: chosenModel.model,
          providerOverride: chosenModel.provider,
          ...(promptTemplateId ? { promptTemplateId } : {}),
          systemPrompt: "És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional. Mantém sempre as características técnicas do produto NUMA TABELA HTML separada do texto comercial na aba 'Características'. Traduz tudo para português europeu.\n\nREGRAS CRÍTICAS DE CONTEÚDO:\n- Na tabela HTML de especificações (aba Características), inclui TODA a informação técnica disponível.\n- NUNCA coloques Marca, Modelo ou EAN na tabela HTML da descrição, pois esses dados são injetados automaticamente noutra aba.\n- PRECISÃO TÉCNICA: Respeita rigorosamente os dados técnicos fornecidos (especificações e descrição original). NUNCA inventes ou assumas capacidades que não estão explícitas. Em caso de dúvida, mantém o valor original.\n\nREGRAS DE QUALIDADE DE ESCRITA:\n- Escreve sempre em português europeu (PT-PT), nunca em português do Brasil.\n- HUMANIZAÇÃO E VARIABILIDADE: Evita repetições robóticas. Usa sinónimos inteligentes para termos técnicos e de negócio (ex: em vez de repetir sempre 'cozinha profissional', usa 'ambiente gastronómico', 'espaço de confeção', 'unidade de restauração').\n- SINÓNIMOS E FLUIDEZ: Enriquece as descrições (longa e curta) com vocabulário variado. Alterna entre termos como 'equipamento', 'maquinaria', 'solução profissional', 'sistema de alto rendimento'.\n- Mantém um tom profissional e orientado a vendas B2B para setor HORECA e hotelaria.\n- Nunca cortes frases a meio — cada campo deve terminar com pontuação completa.\n- Nunca mistures a tabela técnica com o texto descritivo — a tabela vai SEMPRE separada.\n- ABERTURA ÚNICA: Primeiro parágrafo NUNCA repete a ideia do título. Começa com facto técnico ou benefício directo.\n- PROIBIDO começar com: \"Descubra\", \"Conheça\", \"Apresentamos\", \"Esta é a solução perfeita\".\n- PROIBIDO repetir estrutura: se parágrafo 1 começa com \"Este\", parágrafo 2 NÃO pode começar com \"Este\", \"Esta\", \"O equipamento\", \"O produto\".\n- VARIEDADE DE ABERTURA: usar \"Concebido para...\", \"Com capacidade para...\", \"Ideal para cozinhas que...\", \"Quando o volume de trabalho exige...\".\n- REGRA DE HONESTIDADE: Se não conseguires determinar o tipo exacto do produto (ex: vitrine ambígua entre pastelaria e charcutaria), usa um termo genérico seguro e preenche optimization_notes com a dúvida.\n- TERMOS PROIBIDOS: \"cocção\"→\"confeção\"; \"fast casual\"→\"restauração rápida\"; \"buffet line\"→\"linha de buffet\"; \"lanchonete\"→\"snack-bar\"; \"geladeira\"→\"frigorífico\"; \"cardápio\"→\"ementa\"; \"garçom\"→\"empregado de mesa\".\n- TERMOS ACEITES (gíria profissional PT-PT legítima): \"catering\", \"buffet\", \"take-away\", \"snack-bar\", \"food service\" são correctos. \"coffee shop\" é aceitável nas tags; no título/descrição preferir \"café\" ou \"pastelaria\".\n- HÍFEN: \"take-away\" e \"snack-bar\" escrevem-se SEMPRE com hífen no título e descrição.",
          messages: [{ role: "user", content: finalPrompt }],
          options: {
            tools: [
              {
                type: "function",
                function: {
                  name: "optimize_product",
                  description: "Devolve os campos otimizados do produto",
                  parameters: {
                    type: "object",
                    properties: toolProperties,
                    required: requiredFields,
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "optimize_product" } },
          },
        });

        if (!aiResponse.ok) {
          const status = aiResponse.status;
          if (status === 429) {
            await supabase.from("products").update({ status: "pending" }).in("id", productIds);
            throw new Error("Limite de pedidos excedido. Tente novamente mais tarde.");
          }
          if (status === 402) {
            await supabase.from("products").update({ status: "pending" }).in("id", productIds);
            throw new Error("Créditos insuficientes. Adicione créditos ao workspace.");
          }
          const errText = await aiResponse.text();
          let routeErrorDetail = errText;
          try {
            const parsed = JSON.parse(errText);
            if (parsed?.error) {
              routeErrorDetail = parsed.details
                ? `${parsed.error} | ${parsed.details}`
                : parsed.error;
            }
          } catch {
            // keep raw text
          }
          console.error("AI error:", status, routeErrorDetail);
          await supabase.from("products").update({ status: "error" }).eq("id", product.id);
          return { id: product.id, status: "error" as const, error: `AI route ${status}: ${routeErrorDetail}` };
        }

        const aiWrapper = await aiResponse.json();
        const promptVersionId: string | null = aiWrapper.meta?.promptVersionId ?? null;
        const aiMeta = aiWrapper.meta || {};
        const promptSource = aiMeta.promptSource || "unknown";
        console.log(`📋 [optimize-product] Prompt source for "${product.original_title || product.sku}": ${promptSource} | Provider: ${aiMeta.usedProvider || "?"} | Model: ${aiMeta.usedModel || "?"} | Decision: ${aiMeta.decisionSource || "?"}`);
        
        const aiData = aiWrapper.result || aiWrapper;
        const message = aiData.choices?.[0]?.message;
        const toolCall = message?.tool_calls?.[0];

        let rawOptimized: any;
        if (toolCall?.function?.arguments) {
          rawOptimized = JSON.parse(toolCall.function.arguments);
        } else {
          // Fallback path for providers/models that return JSON in message.content
          const contentText = typeof message?.content === "string"
            ? message.content
            : Array.isArray(message?.content)
              ? message.content
                  .map((c: any) => typeof c?.text === "string" ? c.text : "")
                  .join("\n")
              : "";

          if (!contentText.trim()) {
            await supabase.from("products").update({ status: "error" }).eq("id", product.id);
            return { id: product.id, status: "error" as const, error: "No tool call/content JSON in response" };
          }

          const normalizedContent = contentText
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
          rawOptimized = JSON.parse(normalizedContent);
        }

        // Capture real model traceability from AI router meta
        const usedProvider: string = aiMeta.usedProvider || chosenModel.provider;
        const usedModel: string = aiMeta.usedModel || chosenModel.model;
        const requestedModel: string = chosenModel.model;
        const fallbackUsed: boolean = aiMeta.fallbackUsed || false;
        const fallbackReason: string | null = aiMeta.fallbackReason || null;
        const attemptedModels: string[] = aiMeta.attemptedModels || [chosenModel.model];

        if (fallbackUsed) {
          console.warn(`[optimize-product] ${product.id}: fallback used — requested=${requestedModel}, used=${usedModel}, reason=${fallbackReason}`);
        }

        // Capture token usage from AI response
        const usage = aiData.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

        const guardrailed = enforceFieldLimits(rawOptimized);
        const { fields: finalOptimized, issues: outputIssues } = formatProductOutput(guardrailed, fields);
        if (outputIssues.length > 0) {
          console.warn("[optimize-product] output quality issues:", outputIssues);
        }
        const optimized = finalOptimized;

        // --- PROGRAMMATIC CERTIFICATIONS DETECTION ---
        const detectedCerts = detectCertifications(product);
        // Merge with AI results (prefer set to avoid duplicates)
        const aiCerts = Array.isArray(optimized.certifications) ? optimized.certifications : [];
        const finalCerts = new Set([...detectedCerts, ...aiCerts]);
        
        // Ensure "CE" is ALWAYS present if nothing else is found
        if (finalCerts.size === 0) finalCerts.add('CE');
        
        optimized.certifications = Array.from(finalCerts).sort((a, b) => 
          a === 'CE' ? -1 : b === 'CE' ? 1 : a.localeCompare(b)
        );
        console.log(`[certifications] Final certs for ${product.sku}: ${optimized.certifications.join(", ")}`);

        // === VALIDATE upsell/crosssell SKUs against real DB (SKU-only format) ===
        if (optimized.upsell_skus && Array.isArray(optimized.upsell_skus) && optimized.upsell_skus.length > 0) {
          // Normalize: handle both string[] and {sku}[] formats for backward compat
          const rawSkus = optimized.upsell_skus.map((u: any) => typeof u === "string" ? u : u.sku).filter(Boolean);
          if (rawSkus.length > 0) {
            const { data: validProducts } = await supabase
              .from("products")
              .select("sku")
              .in("sku", rawSkus);
            const validSet = new Set((validProducts || []).map((p: any) => p.sku));
            const before = rawSkus.length;
            optimized.upsell_skus = rawSkus.filter((s: string) => validSet.has(s) && s !== product.sku);
            console.log(`Upsells validated: ${optimized.upsell_skus.length}/${before} SKUs are real`);
          }
        }
        if (optimized.crosssell_skus && Array.isArray(optimized.crosssell_skus) && optimized.crosssell_skus.length > 0) {
          const rawSkus = optimized.crosssell_skus.map((u: any) => typeof u === "string" ? u : u.sku).filter(Boolean);
          if (rawSkus.length > 0) {
            const { data: validProducts } = await supabase
              .from("products")
              .select("sku")
              .in("sku", rawSkus);
            const validSet = new Set((validProducts || []).map((p: any) => p.sku));
            const before = rawSkus.length;
            optimized.crosssell_skus = rawSkus.filter((s: string) => validSet.has(s) && s !== product.sku);
            console.log(`Cross-sells validated: ${optimized.crosssell_skus.length}/${before} SKUs are real`);
          }
        }

        // === PLACEHOLDER RESOLUTION: resolve known template placeholders before saving ===
        const PLACEHOLDER_REGEX = /\{\{[^}]+\}\}/g;
        if (
          (fields.includes("faq") || (typeof product.optimized_description === "string" && product.optimized_description.includes("product-faq"))) 
          && typeof optimized.optimized_description !== "string"
          && typeof product.optimized_description === "string"
        ) {
          optimized.optimized_description = product.optimized_description;
        }

        if (typeof optimized.optimized_description === "string") {
          // --- FAQ EXTRACTION (Always try to sync structured FAQ with HTML description FAQ if present) ---
          if (optimized.optimized_description.includes("product-faq")) {
            try {
              // More lenient regex to match the product-faq div, regardless of outer divs
              const faqMatch = optimized.optimized_description.match(/<div[^>]*class=["']product-faq["'][^>]*>([\s\S]*?)(?:<\/div>\s*<\/div>|<\/div>\s*$)/i);
              if (faqMatch) {
                const faqHtml = faqMatch[1];
                const qas = [];
                // Match: <p><strong>Question</strong></p><p>Answer</p>
                // OR: <p>P: Question</p><p>R: Answer</p>
                const qRegex = /<p[^>]*>(?:<strong[^>]*>|<b[^>]*>)?\s*(?:\d+\.\s*)?(.*?)(?:<\/strong>|<\/b>)?\s*(?:<\/p>\s*<p[^>]*>|<br\/?>)\s*(?!(?:<strong|<b))([\s\S]*?)(?:<\/p>|$)/gi;
                let m;
                while ((m = qRegex.exec(faqHtml)) !== null) {
                  const q = m[1].replace(/<[^>]*>/g, "").replace(/^\d+\.\s*/, "").trim();
                  const a = m[2].replace(/<[^>]*>/g, "").trim();
                  if (q && a && q.length > 5) {
                    qas.push({ question: q, answer: a });
                  }
                }
                
                if (qas.length > 0) {
                  console.log(`[optimize-product] Synced ${qas.length} FAQs from HTML description to structured field`);
                  optimized.faq = qas;
                }
              }
            } catch (e) {
              console.warn("[optimize-product] Failed to extract FAQs from HTML:", e);
            }
          }

          const hadFaqPlaceholder = /\{\{faq\}\}/i.test(optimized.optimized_description);
          // Replace {{faq}} with actual FAQ HTML if we have FAQ data
          if (optimized.faq && Array.isArray(optimized.faq) && optimized.faq.length > 0) {
            const limitedFaqs = optimized.faq.slice(0, 5);
            const faqHtml = limitedFaqs.map((f: any) =>
              `<p style="font-weight:bold; margin:0 0 4px; color:#2c2c2c;">${f.question}</p>\n<p style="margin:0 0 16px; color:#374151; line-height:1.6;">${f.answer}</p>`
            ).join("\n");
            optimized.optimized_description = optimized.optimized_description.replace(/\{\{faq\}\}/gi, faqHtml);

            // Check if FAQ section exists but is truncated/incomplete
            const hasFaqWrapper = /class=["'][^"']*product-faq[^"']*["']/i.test(optimized.optimized_description);
            const faqWrapperClosed = /<\/div>\s*<\/div>\s*$/.test(optimized.optimized_description.trim()) || 
              (hasFaqWrapper && (optimized.optimized_description.match(/<div/g) || []).length <= (optimized.optimized_description.match(/<\/div>/g) || []).length);
            
            if (hasFaqWrapper && !faqWrapperClosed) {
              // FAQ section was truncated — remove the broken part and rebuild
              console.log(`[optimize-product] FAQ section truncated — rebuilding from structured data`);
              // Remove everything from the incomplete FAQ div onwards
              optimized.optimized_description = optimized.optimized_description.replace(
                /<div class="product-faq"[\s\S]*$/i,
                ""
              ).trim();
              // Close the root div if it was left open
              const rootDivOpen = (optimized.optimized_description.match(/<div/g) || []).length;
              const rootDivClose = (optimized.optimized_description.match(/<\/div>/g) || []).length;
              // Don't close root — we'll append FAQ then close
            }

            // Re-check after potential rebuild
            const hasFaqWrapperAfter = /class=["'][^"']*product-faq[^"']*["']/i.test(optimized.optimized_description);
            if (!hadFaqPlaceholder && !hasFaqWrapperAfter) {
              // Ensure we're inside the root div
              const endsWithRootClose = /(<\/div>)\s*$/.test(optimized.optimized_description);
              const faqBlock = `<div class="product-faq" style="margin-top:24px; margin-bottom:22px;"><h3 style="margin:0 0 12px; font-size:18px; font-weight:700; color:#00526d; border-bottom:2px solid #e5e7eb; padding-bottom:6px;">Perguntas Frequentes</h3>\n${faqHtml}\n</div>`;
              if (endsWithRootClose) {
                // Insert FAQ before the closing root </div>
                optimized.optimized_description = optimized.optimized_description.replace(
                  /(<\/div>)\s*$/,
                  `\n${faqBlock}\n$1`
                );
              } else {
                optimized.optimized_description = `${optimized.optimized_description}\n${faqBlock}`;
              }
            }
          }
          // Replace {{tabela_specs}} with specs table from product data if available
          if (product.technical_specs) {
            optimized.optimized_description = optimized.optimized_description.replace(
              /\{\{tabela_specs\}\}/gi,
              `<table><tbody>${product.technical_specs}</tbody></table>`
            );
          }
          // Strip any remaining unresolved placeholders
          optimized.optimized_description = optimized.optimized_description.replace(PLACEHOLDER_REGEX, "");
        }

        // === STATUS GATING: determine real status based on output quality ===
        const statusIssues: string[] = [];

        // Check required fields based on what was requested
        const hasTitle = typeof optimized.optimized_title === "string" && optimized.optimized_title.trim().length > 0;
        const hasShortDesc = typeof optimized.optimized_short_description === "string" && optimized.optimized_short_description.trim().length > 0;
        const hasDescription = typeof optimized.optimized_description === "string" && optimized.optimized_description.trim().length > 0;

        if (fields.includes("title") && !hasTitle) statusIssues.push("optimized_title missing");
        if (fields.includes("short_description") && !hasShortDesc) statusIssues.push("optimized_short_description missing");
        if (fields.includes("description") && !hasDescription) statusIssues.push("optimized_description missing");

        // Check SEO fields if they were requested
        if (fields.includes("meta_title") && (typeof optimized.meta_title !== "string" || !optimized.meta_title.trim())) {
          statusIssues.push("meta_title missing");
        }
        if (fields.includes("meta_description") && (typeof optimized.meta_description !== "string" || !optimized.meta_description.trim())) {
          statusIssues.push("meta_description missing");
        }

        // Check for leftover placeholders in any text field
        const textFieldsToCheck = [optimized.optimized_title, optimized.optimized_short_description, optimized.optimized_description, optimized.meta_title, optimized.meta_description];
        for (const val of textFieldsToCheck) {
          if (typeof val === "string" && PLACEHOLDER_REGEX.test(val)) {
            statusIssues.push("unresolved placeholder in output");
            break;
          }
        }

        // Also consider output quality issues from formatter/guardrails
        const criticalIssues = outputIssues.filter((i: string) =>
          i.includes("required field") || i.includes("unclosed HTML tag") || i.includes("mismatched")
        );
        statusIssues.push(...criticalIssues);

        const productStatus = statusIssues.length === 0 ? "optimized" : "needs_review";
        if (productStatus === "needs_review") {
          console.warn(`[optimize-product] ${product.id} → needs_review: ${statusIssues.join("; ")}`);
        }

        const updateData: Record<string, any> = { 
          status: productStatus,
          model: inferredModel || null
        };
        if (optimized.optimized_title) updateData.optimized_title = optimized.optimized_title;
        if (optimized.optimized_description) {
          // POST-PROCESSING: Ensure first H3 contains focus keyword
          let desc = optimized.optimized_description as string;
          const focusKw = optimized.focus_keywords?.[0] || updateData.focus_keyword?.[0] || "";
          if (focusKw) {
            const h3Match = desc.match(/<h3([^>]*)>(.*?)<\/h3>/i);
            if (h3Match && !h3Match[2].toLowerCase().includes(focusKw.toLowerCase().substring(0, 20))) {
              const originalH3Content = h3Match[2];
              const newH3Content = `${focusKw} — ${originalH3Content}`;
              desc = desc.replace(h3Match[0], `<h3${h3Match[1]}>${newH3Content}</h3>`);
              console.log(`✅ Focus keyword injected into first H3: "${newH3Content}"`);
            }
          }
          updateData.optimized_description = desc;
        }
        if (optimized.optimized_short_description !== undefined) {
          updateData.optimized_short_description = optimized.optimized_short_description || null;
          updateData.seo_short_description = optimized.optimized_short_description || null;
        }
        if (optimized.meta_title) updateData.meta_title = optimized.meta_title;
        if (optimized.meta_description) {
          updateData.meta_description = optimized.meta_description;
          // Use meta_description as fallback for seo_short_description if not already set
          if (!updateData.seo_short_description) {
            updateData.seo_short_description = optimized.meta_description;
          }
        }
        if (optimized.seo_slug) updateData.seo_slug = optimized.seo_slug;
        if (optimized.tags) updateData.tags = optimized.tags;

        if (optimized.faq) updateData.faq = optimized.faq;
        if (optimized.upsell_skus) updateData.upsell_skus = optimized.upsell_skus;
        if (optimized.crosssell_skus) updateData.crosssell_skus = optimized.crosssell_skus;
        if (optimized.image_alt_texts || (product.image_urls && product.image_urls.length > 0)) {
          // Convert array format [{url, alt_text}] to object format {url: alt_text} for DB
          let altObj: Record<string, string> = {};
          if (optimized.image_alt_texts) {
            if (Array.isArray(optimized.image_alt_texts)) {
              for (const item of optimized.image_alt_texts) {
                if (item?.url && item?.alt_text) {
                  altObj[item.url] = item.alt_text;
                }
              }
            } else {
              altObj = optimized.image_alt_texts as Record<string, string>;
            }
          }
          // FALLBACK: Ensure ALL image URLs have alt text — fill missing ones
          if (product.image_urls && Array.isArray(product.image_urls)) {
            // Priority for Alt Text: Optimized Title (Portuguese) -> Focus Keywords -> Original Title
            const baseAltText = (
              optimized.optimized_title || 
              updateData.optimized_title || 
              product.optimized_title || 
              (optimized.focus_keywords && optimized.focus_keywords[0]) ||
              updateData.focus_keyword?.[0] || 
              product.focus_keyword?.[0] ||
              product.original_title || 
              "equipamento profissional"
            ).substring(0, 100);

            for (let i = 0; i < product.image_urls.length; i++) {
              const url = product.image_urls[i];
              if (url && !altObj[url]) {
                const suffix = product.image_urls.length > 1 ? ` — vista ${i + 1}` : "";
                altObj[url] = `${baseAltText}${suffix}`.substring(0, 125);
                console.log(`⚠️ Alt text fallback generated for image ${i + 1} (Portuguese): ${altObj[url]}`);
              }
            }
          }
          updateData.image_alt_texts = altObj;
        }
        if (optimized.suggested_category) updateData.suggested_category = optimized.suggested_category;
        if (optimized.suggested_categories) updateData.suggested_categories = optimized.suggested_categories;
        if (optimized.focus_keywords && Array.isArray(optimized.focus_keywords) && optimized.focus_keywords.length > 0) {
          updateData.focus_keyword = optimized.focus_keywords.slice(0, 5);
        }
        
        // --- LANGUAGE QUALITY VALIDATION ---
        validateNaturalLanguage(updateData.optimized_description, "description");
        validateNaturalLanguage(updateData.optimized_short_description, "short_description");
        validateNaturalLanguage(updateData.meta_description, "meta_description");

        // --- CRITICAL FIX: MAP CERTIFICATIONS AND PROFESSIONAL CONTENT TO DB ---
        if (optimized.certifications) updateData.certifications = optimized.certifications;
        if (optimized.professional_use_content) updateData.professional_use_content = optimized.professional_use_content;

        const { error: updateError } = await supabase
          .from("products")
          .update({ ...updateData, optimization_notes: optimized.optimization_notes || null })
          .eq("id", product.id);

        if (updateError) {
          console.error("Update error:", updateError);
          return { id: product.id, status: "error" as const, error: updateError.message };
        }

        // --- AUTOMATIC CATEGORY APPLICATION ---
        // If the AI suggested a category and it differs from the current one, update it automatically.
        if (optimized.suggested_category && optimized.suggested_category !== product.category) {
          console.log(`🏷️ Auto-applying suggested category for ${product.sku}: "${product.category}" → "${optimized.suggested_category}"`);
          const { error: catUpdateError } = await supabase
            .from("products")
            .update({ category: optimized.suggested_category })
            .eq("id", product.id);
          
          if (catUpdateError) {
            console.error(`⚠️ Failed to auto-apply category for ${product.id}:`, catUpdateError);
          } else {
            // Update the local product object so that variation propagation uses the new category
            product.category = optimized.suggested_category;
          }
        }

        // === PROPAGATE TO VARIATIONS if this is a variable product ===
        if (product.product_type === "variable") {
          const { data: variations } = await supabase
            .from("products")
            .select("id, sku, attributes, original_title, category")
            .eq("parent_product_id", product.id);

          if (variations && variations.length > 0) {
            // === CATEGORY CONCORDANCE ANALYSIS ===
            // Check if variations have a more concordant category than the parent
            const parentCategory = updateData.suggested_category || product.category || "";
            const variationCategories = variations
              .map((v: any) => v.category)
              .filter((c: string | null) => c && c.trim() !== "");
            
            let finalCategory = parentCategory;
            let categoryChanged = false;
            
            if (variationCategories.length > 0) {
              // Count category occurrences among variations
              const catCounts: Record<string, number> = {};
              for (const cat of variationCategories) {
                catCounts[cat!] = (catCounts[cat!] || 0) + 1;
              }
              
              // Find the most common category among variations
              const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
              const mostCommonCat = sortedCats[0][0];
              const mostCommonCount = sortedCats[0][1];
              
              // If majority of variations agree on a different category, adopt it
              if (mostCommonCat && mostCommonCat !== parentCategory && mostCommonCount > variationCategories.length / 2) {
                // Verify the category exists in the system
                if (existingCategories.includes(mostCommonCat)) {
                  console.log(`🔄 Category concordance: variations prefer "${mostCommonCat}" (${mostCommonCount}/${variationCategories.length}) over parent "${parentCategory}" → updating parent`);
                  finalCategory = mostCommonCat;
                  categoryChanged = true;
                  
                  // Update the parent product category
                  await supabase.from("products").update({ 
                    category: mostCommonCat,
                    suggested_category: parentCategory !== mostCommonCat ? parentCategory : null,
                    suggested_categories: updateData.suggested_categories || null
                  }).eq("id", product.id);
                }
              }
            }

            const TECH_ATTR_NAMES = new Set(["marca","brand","ean","ean13","gtin","barcode","modelo","model","referência","reference","código","code"]);
            const isEanLike = (v: string) => /^\d{8,14}$/.test(v.replace(/\s/g, ""));

            let propagated = 0;
            for (const variation of variations) {
              // Build attribute suffix ONLY from variation=true attrs, excluding tech values
              const attrParts: string[] = [];
              if (Array.isArray(variation.attributes)) {
                for (const attr of variation.attributes as any[]) {
                  // Skip non-variation and technical attributes
                  if (attr.variation === false) continue;
                  const attrName = (attr.name || "").toLowerCase().trim();
                  if (TECH_ATTR_NAMES.has(attrName)) continue;
                  const vals = Array.isArray(attr.values) ? attr.values.join("/") : (attr.value || "");
                  // Skip EAN-like values (pure numbers 8+ digits)
                  if (!vals || isEanLike(vals)) continue;
                  attrParts.push(vals);
                }
              }
              const suffix = attrParts.length > 0 ? ` - ${attrParts.join(", ")}` : "";

              const variationUpdate: Record<string, any> = {
                status: "optimized",
                category: finalCategory,
                suggested_category: updateData.suggested_category || null,
                suggested_categories: updateData.suggested_categories || null,
              };

              // Propagate title with attribute suffix
              if (updateData.optimized_title) {
                variationUpdate.optimized_title = `${updateData.optimized_title}${suffix}`;
              }
              // Propagate description (same base for all variations)
              if (updateData.optimized_description) {
                variationUpdate.optimized_description = updateData.optimized_description;
              }
              if (updateData.optimized_short_description) {
                variationUpdate.optimized_short_description = updateData.optimized_short_description;
              }
              // Propagate SEO with variation suffix
              if (updateData.meta_title) {
                variationUpdate.meta_title = `${updateData.meta_title}${suffix}`.substring(0, 60);
              }
              if (updateData.meta_description) {
                variationUpdate.meta_description = updateData.meta_description;
              }
              if (updateData.seo_slug) {
                const slugSuffix = attrParts.join("-").toLowerCase()
                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9\-]/g, "-").replace(/-+/g, "-");
                variationUpdate.seo_slug = slugSuffix ? `${updateData.seo_slug}-${slugSuffix}` : updateData.seo_slug;
              }
              if (updateData.tags) variationUpdate.tags = updateData.tags;
              if (updateData.faq) variationUpdate.faq = updateData.faq;
              if (updateData.focus_keyword) variationUpdate.focus_keyword = updateData.focus_keyword;

              await supabase.from("products").update(variationUpdate).eq("id", variation.id);
              propagated++;
            }
            console.log(`📦 Propagated optimization to ${propagated} variations of variable product ${product.sku}`);

            // === PROPAGATE LIFESTYLE IMAGES to all family members ===
            try {
              // Collect all lifestyle images from parent + all variations
              const allFamilyIds = [product.id, ...variations.map((v: any) => v.id)];
              const { data: allLifestyleImages } = await supabase
                .from("images")
                .select("product_id, optimized_url, original_url")
                .in("product_id", allFamilyIds)
                .like("s3_key", "%lifestyle%")
                .eq("status", "done");

              if (allLifestyleImages && allLifestyleImages.length > 0) {
                // Unique lifestyle URLs
                const lifestyleUrls = [...new Set(allLifestyleImages.map((img: any) => img.optimized_url).filter(Boolean))];
                
                if (lifestyleUrls.length > 0) {
                  console.log(`🖼️ Found ${lifestyleUrls.length} lifestyle images to propagate across ${allFamilyIds.length} family members`);
                  
                  for (const fid of allFamilyIds) {
                    const { data: famProduct } = await supabase
                      .from("products")
                      .select("id, image_urls")
                      .eq("id", fid)
                      .single();
                    
                    if (!famProduct) continue;
                    const existing = Array.isArray(famProduct.image_urls) ? famProduct.image_urls : [];
                    const merged = [...existing];
                    let added = 0;
                    for (const url of lifestyleUrls) {
                      if (!merged.includes(url)) { merged.push(url); added++; }
                    }
                    
                    if (added > 0) {
                      await supabase.from("products").update({ image_urls: merged }).eq("id", fid);
                      
                      // Also ensure image records exist for this family member
                      const { data: existingImgRecords } = await supabase
                        .from("images")
                        .select("optimized_url")
                        .eq("product_id", fid)
                        .like("s3_key", "%lifestyle%");
                      const existingOptUrls = new Set((existingImgRecords || []).map((r: any) => r.optimized_url));
                      
                      for (const url of lifestyleUrls) {
                        if (!existingOptUrls.has(url)) {
                          await supabase.from("images").insert({
                            product_id: fid,
                            original_url: existing[0] || null,
                            optimized_url: url,
                            s3_key: `lifestyle_shared_from_family`,
                            sort_order: merged.indexOf(url),
                            status: "done",
                          });
                        }
                      }
                      console.log(`  ✅ Added ${added} lifestyle images to ${fid}`);
                    }
                  }
                }
              }
            } catch (lifestyleErr) {
              console.warn("Lifestyle propagation error (non-fatal):", lifestyleErr);
            }

            // ── AI attribute extraction for variable products ──
            // Check if children lack proper variation attributes
            const childrenNeedAttrs = variations.filter((v: any) => {
              const attrs = Array.isArray(v.attributes) ? v.attributes : [];
              const TECH = new Set(["marca","brand","ean","ean13","gtin","barcode","modelo","model"]);
              const varAttrs = attrs.filter((a: any) => a.variation !== false && !TECH.has((a.name || "").toLowerCase().trim()));
              return varAttrs.length === 0;
            });

            if (childrenNeedAttrs.length > 0) {
              console.log(`🤖 Attempting AI attribute extraction for ${childrenNeedAttrs.length} variations...`);
              // AI calls go through resolve-ai-route (no LOVABLE_API_KEY dependency)
              if (true) {
                try {
                  const parentTitleForAI = updateData.optimized_title || product.optimized_title || product.original_title || "";
                  const childTitles: Record<string, string> = {};
                  for (const v of childrenNeedAttrs) {
                    // Re-fetch updated title after propagation
                    const { data: freshChild } = await supabase.from("products").select("optimized_title, original_title").eq("id", v.id).single();
                    childTitles[v.id] = freshChild?.optimized_title || freshChild?.original_title || v.original_title || "";
                  }

                  const aiResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/resolve-ai-route`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                    },
                    body: JSON.stringify({
                      taskType: "variation_attribute_extraction",
                      workspaceId: workspaceId,
                      modelOverride: "gemini-2.5-flash-lite",
                      providerOverride: "gemini",
                      systemPrompt: "Extrais atributos de variação a partir de títulos de produtos. Compara o título do produto pai com cada título filho para identificar o atributo diferenciador (ex: Cor, Tamanho, Material, Capacidade, Dimensões). Devolve dados estruturados via tool call. CRÍTICO: NUNCA uses códigos EAN, códigos de barras, referências numéricas (8+ dígitos), nomes de marca ou códigos SKU como valores de atributo. Usa apenas atributos físicos com significado como tamanho, cor, capacidade, material.",
                      messages: [{
                        role: "user",
                        content: `Parent product title: "${parentTitleForAI}"\n\nChild variation titles:\n${Object.entries(childTitles).map(([id, t]) => `- ID ${id}: "${t}"`).join("\n")}\n\nExtract the variation attribute name and value for each child. The differentiating attribute should be a PHYSICAL characteristic (size, color, capacity, dimensions, etc.), NEVER an EAN code, barcode, reference number, or brand name.`
                      }],
                      options: {
                        tools: [{
                          type: "function",
                          function: {
                            name: "extract_variation_attributes",
                            description: "Extract the variation attribute name and per-child values from title differences",
                            parameters: {
                              type: "object",
                              properties: {
                                attribute_name: { type: "string", description: "Name of the variation attribute in Portuguese (e.g. Cor, Tamanho, Material, Capacidade)" },
                                confident: { type: "boolean", description: "true if the extraction is clear and unambiguous" },
                                variations: {
                                  type: "array",
                                  items: {
                                    type: "object",
                                    properties: {
                                      child_id: { type: "string" },
                                      value: { type: "string", description: "The attribute value for this variation" }
                                    },
                                    required: ["child_id", "value"],
                                    additionalProperties: false
                                  }
                                }
                              },
                              required: ["attribute_name", "confident", "variations"],
                              additionalProperties: false
                            }
                          }
                        }],
                        tool_choice: { type: "function", function: { name: "extract_variation_attributes" } },
                      },
                    }),
                  });

                  if (aiResponse.ok) {
                    const aiWrapper = await aiResponse.json();
                    const aiData = aiWrapper.result || aiWrapper;
                    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
                    if (toolCall?.function?.arguments) {
                      const extracted = JSON.parse(toolCall.function.arguments);
                      console.log(`🤖 AI extracted: attr="${extracted.attribute_name}", confident=${extracted.confident}, ${extracted.variations?.length} values`);

                      if (extracted.variations && Array.isArray(extracted.variations)) {
                        const TECH = new Set(["marca","brand","ean","ean13","gtin","barcode","modelo","model"]);
                        const baseTitle = updateData.optimized_title || product.optimized_title || product.original_title || "";
                        const baseSlug = updateData.seo_slug || "";
                        const baseMetaTitle = updateData.meta_title || "";

                      for (const v of extracted.variations) {
                          if (!v.child_id || !v.value) continue;
                          // Reject EAN-like values as variation attributes
                          if (/^\d{8,14}$/.test(v.value.replace(/\s/g, ""))) {
                            console.warn(`⚠️ Rejected EAN-like variation value: ${v.value} for child ${v.child_id}`);
                            continue;
                          }
                          // Reject brand/model references as variation values
                          const lowerVal = v.value.toLowerCase();
                          if (lowerVal === "lizotel" || lowerVal.startsWith("lz") || /^[a-z]{2}\d{6,}$/i.test(v.value)) {
                            console.warn(`⚠️ Rejected brand/ref-like variation value: ${v.value} for child ${v.child_id}`);
                            continue;
                          }
                          const child = variations.find((c: any) => c.id === v.child_id);
                          if (!child) continue;
                          const existingAttrs = Array.isArray(child.attributes) ? [...child.attributes as any[]] : [];
                          const techOnly = existingAttrs.filter((a: any) => a.variation === false || TECH.has((a.name || "").toLowerCase().trim()));
                          const newAttrs = [
                            ...techOnly,
                            { name: extracted.attribute_name, value: v.value, variation: true }
                          ];

                          // Build title with attribute suffix — this is the key fix:
                          // re-apply after AI extraction so the title is correct
                          const childUpdate: Record<string, any> = { attributes: newAttrs };

                          if (baseTitle) {
                            childUpdate.optimized_title = `${baseTitle} - ${v.value}`;
                          }

                          if (baseMetaTitle) {
                            childUpdate.meta_title = `${baseMetaTitle} - ${v.value}`.substring(0, 60);
                          }

                          if (baseSlug) {
                            const slugSuffix = v.value.toLowerCase()
                              .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                              .replace(/[^a-z0-9\-]/g, "-").replace(/-+/g, "-");
                            childUpdate.seo_slug = slugSuffix ? `${baseSlug}-${slugSuffix}` : baseSlug;
                          }

                          console.log(`📝 Variation ${v.child_id}: title="${childUpdate.optimized_title}", attr=${extracted.attribute_name}=${v.value}`);
                          await supabase.from("products").update(childUpdate).eq("id", v.child_id);
                        }
                      }

                      // Set parent status based on confidence
                      if (extracted.confident) {
                        await supabase.from("products").update({ status: "optimized" }).eq("id", product.id);
                        console.log(`✅ Variable product ${product.sku}: AI confident → status=optimized`);
                      } else {
                        await supabase.from("products").update({ status: "needs_review" }).eq("id", product.id);
                        console.log(`⚠️ Variable product ${product.sku}: AI not confident → status=needs_review`);
                      }
                    }
                  } else {
                    console.error(`AI attribute extraction failed: ${aiResponse.status}`);
                    await supabase.from("products").update({ status: "needs_review" }).eq("id", product.id);
                  }
                } catch (aiErr) {
                  console.error("AI attribute extraction error:", aiErr);
                  await supabase.from("products").update({ status: "needs_review" }).eq("id", product.id);
                }
              // (unreachable — AI always attempted via resolve-ai-route)
              }
            }
          }
        }

        // Will return success after logging below

        // Log activity
        const matchedForLog = supplierMappings.find((s) => 
          product.sku?.toUpperCase().startsWith(s.prefix.toUpperCase())
        );
        await supabase.from("activity_log").insert({
          user_id: userId,
          action: "optimize",
          details: { 
            product_id: product.id, 
            sku: product.sku, 
            fields, 
            supplier_name: matchedForLog?.name || matchedForLog?.prefix || null,
            had_supplier_context: !!supplierContext, 
            had_knowledge_context: !!knowledgeContext,
          },
        });

        // Log optimization details (tokens, sources, etc.)
        // Build knowledge sources from already-fetched chunks
        let knowledgeSources: Array<{ source: string; chunks: number }> = [];
        if (topChunks.length > 0) {
          const sourceMap = new Map<string, number>();
          topChunks.forEach((c: any) => {
            const name = c.source_name || "Desconhecido";
            sourceMap.set(name, (sourceMap.get(name) || 0) + 1);
          });
          knowledgeSources = Array.from(sourceMap.entries()).map(([source, chunks]) => ({ source, chunks }));
        }

        const matchedSupplierForLog = supplierMappings.find((s) => 
          product.sku?.toUpperCase().startsWith(s.prefix.toUpperCase())
        );
        let logSupplierUrl: string | null = null;
        if (matchedSupplierForLog && product.sku) {
          const prefixLen = matchedSupplierForLog.prefix.length;
          const cleanSku = product.sku.substring(prefixLen);
          logSupplierUrl = matchedSupplierForLog.url.endsWith("=") || matchedSupplierForLog.url.endsWith("/")
            ? `${matchedSupplierForLog.url}${encodeURIComponent(cleanSku)}`
            : `${matchedSupplierForLog.url}/${encodeURIComponent(cleanSku)}`;
        }

        // Best-effort logging — failure must never mark the product as error
        try {
          await supabase.from("optimization_logs").insert({
            product_id: product.id,
            user_id: userId,
            model: usedModel,
            requested_model: requestedModel,
            used_provider: usedProvider,
            fallback_used: fallbackUsed,
            fallback_reason: fallbackReason,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            knowledge_sources: knowledgeSources,
            supplier_name: matchedForLog?.name || matchedForLog?.prefix || null,
            supplier_url: logSupplierUrl,
            had_knowledge: !!knowledgeContext,
            had_supplier: !!supplierContext,
            had_catalog: !!catalogContext,
            fields_optimized: fields,
            prompt_length: finalPrompt.length,
            chunks_used: topChunks.length,
            rag_match_types: ragMatchTypeCounts,
            prompt_version_id: promptVersionId,
            decision_source: aiMeta.decisionSource || null,
            prompt_source: promptSource || null,
          } as any);
        } catch (logErr) {
          console.warn(
            `[optimize-product] optimization_logs insert failed for ${product.id} (non-blocking):`,
            {
              error: logErr instanceof Error ? logErr.message : String(logErr),
              requestedModel,
              usedModel,
              usedProvider,
              fallbackUsed,
              fallbackReason,
            },
          );
        }

        return {
          id: product.id,
          status: productStatus as "optimized" | "needs_review",
          meta: { usedProvider, usedModel, requestedModel, fallbackUsed, fallbackReason, attemptedModels },
        };
      } catch (productError) {
        console.error(`Error optimizing product ${product.id}:`, productError);
        await supabase.from("products").update({ status: "error" }).eq("id", product.id);
        return { id: product.id, status: "error" as const, error: productError instanceof Error ? productError.message : "Unknown" };
      }
      }));

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({ id: "unknown", status: "error", error: String(result.reason) });
        }
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("optimize-product error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? (e as Error).message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
