import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getAiConfig(provider?: string) {
  const gateway = "https://ai.gateway.lovable.dev/v1/chat/completions";
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  switch (provider) {
    case "claude":
      return { url: gateway, key: lovableKey, model: "google/gemini-2.5-flash" };
    case "openai":
      return { url: gateway, key: lovableKey, model: "openai/gpt-5-mini" };
    case "gemini":
    default:
      return { url: gateway, key: lovableKey, model: "google/gemini-2.5-flash-lite" };
  }
}

function normalizeCategoryName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ─── HORECA patterns ─────────────────────────────────────
const DIMENSIONAL_PATTERNS = /^(linha\s*\d+|l\s*\d+|a\s*\d+|\d+\/\d+)/i;
const ENERGY_PATTERNS = /^(eletricos?|electricos?|gas|gaz|a\s+vapor)$/i;
const ACCESSORY_PATTERNS = /^(acessorios?|acessórios?|complementos?)$/i;
const FORMAT_PATTERNS = /^(snack|bar|gastronorm|pastelaria\s*\/?\s*padaria)$/i;

// Context-aware attribute inference
const CAPACITY_CONTEXTS = /armarios?|armários?|vitrines?|arcas?|abatedores?|camaras?|câmaras?/i;
const DEPTH_CONTEXTS = /bancadas?|confecao|confeção|fogoes|fogões|fornos?|fritadeiras?|grelhadores?|basculantes?|marmitas?/i;
const POSITION_CONTEXTS = /portas?|modulos?|módulos?|gavetas?/i;

type DimMeaning = { slug: string; label: string; unit: string };

function inferDimensionalMeaning(path: string): DimMeaning {
  const pathNorm = path.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (CAPACITY_CONTEXTS.test(pathNorm)) return { slug: "pa_capacidade_litros", label: "Capacidade (litros)", unit: "L" };
  if (POSITION_CONTEXTS.test(pathNorm)) return { slug: "pa_numero_portas", label: "Número/Posição", unit: "" };
  return { slug: "pa_profundidade_mm", label: "Profundidade (mm)", unit: "mm" };
}

// ─── Extract crossed attributes from path segments ──────
// e.g. path "CONFEÇÃO > Linha 700 > Eletricos > Fogões"
//   → attributes: [{ slug: "pa_linha", value: "700" }, { slug: "pa_tipo_energia", value: "Elétrico" }]
interface ExtractedAttribute {
  slug: string;
  label: string;
  value: string;
}

function extractCrossedAttributes(path: string): ExtractedAttribute[] {
  const attrs: ExtractedAttribute[] = [];
  const segments = path.split(" > ").map(s => s.trim());

  for (const seg of segments) {
    const segNorm = seg.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    // Dimensional: "Linha 700", "Linha 550 / 600", "Snack / Sob Bancada"
    if (DIMENSIONAL_PATTERNS.test(segNorm)) {
      const nums = seg.replace(/\D+/g, " ").trim();
      const meaning = inferDimensionalMeaning(path);
      attrs.push({
        slug: "pa_linha",
        label: "Linha",
        value: seg.replace(/^linha\s*/i, "").trim() || nums,
      });
    }
    // Special: "Snack / Sob Bancada" → a format/line variant
    else if (/^snack\s*\/?\s*sob\s*bancada$/i.test(segNorm)) {
      attrs.push({ slug: "pa_linha", label: "Linha", value: "Snack / Sob Bancada" });
    }
    // Special: "Linha 900 Top/Suspensão"
    else if (/^linha\s*\d+\s*top/i.test(segNorm)) {
      const nums = seg.match(/\d+/)?.[0] || "";
      attrs.push({ slug: "pa_linha", label: "Linha", value: `${nums} Top/Suspensão` });
    }
    // Energy: "Eletricos", "Gaz", "A vapor"
    else if (ENERGY_PATTERNS.test(segNorm)) {
      const normalized = segNorm.includes("eletric") || segNorm.includes("electri") ? "Elétrico"
        : segNorm.includes("gaz") || segNorm.includes("gas") ? "Gás"
        : segNorm.includes("vapor") ? "Vapor"
        : seg;
      attrs.push({ slug: "pa_tipo_energia", label: "Tipo de Energia", value: normalized });
    }
  }

  return attrs;
}

type CatClassification = "dimensional" | "energy_source" | "accessory" | "format_variant" | "crossed_subcategories" | "real_duplicate";

function classifyDuplicateGroup(
  name: string,
  entries: Array<{ id: string; name: string; path: string; parentName: string | null }>,
): CatClassification {
  const norm = normalizeCategoryName(name);
  if (DIMENSIONAL_PATTERNS.test(norm) || DIMENSIONAL_PATTERNS.test(name)) return "dimensional";
  if (ENERGY_PATTERNS.test(norm) || ENERGY_PATTERNS.test(name)) return "energy_source";
  if (ACCESSORY_PATTERNS.test(norm) || ACCESSORY_PATTERNS.test(name)) return "accessory";
  if (FORMAT_PATTERNS.test(norm) || FORMAT_PATTERNS.test(name)) return "format_variant";

  // Check if this is a "leaf" equipment type (e.g. Fogões) repeated under
  // crossed dimensional+energy subcategories
  const hasLinhaInPaths = entries.some(e => DIMENSIONAL_PATTERNS.test(normalizeCategoryName(e.path.split(" > ").find(s => DIMENSIONAL_PATTERNS.test(normalizeCategoryName(s))) || "")));
  const hasEnergyInPaths = entries.some(e => e.path.split(" > ").some(s => ENERGY_PATTERNS.test(normalizeCategoryName(s))));
  if (hasLinhaInPaths || hasEnergyInPaths) {
    // Equipment type under crossed subcategories — extract attributes
    return "crossed_subcategories";
  }

  return "real_duplicate";
}

function buildFallbackGroups(
  allCats: Array<{ id: string; name: string; parent_id: string | null }>,
  getPath: (catId: string) => string,
  getParentName: (catId: string) => string | null,
  productCounts: Record<string, number>,
) {
  const grouped = new Map<string, Array<{ id: string; name: string; path: string; parentName: string | null; productCount: number }>>();

  for (const cat of allCats) {
    const normalized = normalizeCategoryName(cat.name);
    if (!normalized) continue;
    const entry = {
      id: cat.id,
      name: cat.name,
      path: getPath(cat.id),
      parentName: getParentName(cat.id),
      productCount: productCounts[cat.name] ?? 0,
    };
    const existing = grouped.get(normalized) ?? [];
    existing.push(entry);
    grouped.set(normalized, existing);
  }

  const results: any[] = [];

  for (const [normName, items] of grouped) {
    const uniquePaths = new Set(items.map(item => item.path));
    if (items.length < 2 || uniquePaths.size < 2) continue;

    const classification = classifyDuplicateGroup(items[0].name, items);
    const sorted = [...items].sort((a, b) => b.productCount - a.productCount || a.path.localeCompare(b.path));

    if (classification === "accessory") {
      results.push({
        groupName: `⚙️ ${sorted[0].name} (contextual)`,
        categories: sorted.map(item => ({
          id: item.id, name: item.name, path: item.path,
          productCount: item.productCount,
          suggestedAction: "keep" as const, mergeTarget: null,
          extractedAttributes: [],
        })),
        confidence: "low" as const,
        reason: `"${sorted[0].name}" existe em ${uniquePaths.size} ramos diferentes — cada equipamento tem os seus próprios acessórios. NÃO são duplicados.`,
      });
    } else if (classification === "dimensional") {
      const dimValue = sorted[0].name.replace(/\D+/g, " ").trim().split(/\s+/)[0] || sorted[0].name;
      const meanings = sorted.map(item => inferDimensionalMeaning(item.path));
      const uniqueSlugs = new Set(meanings.map(m => m.slug));
      const hasMixedMeaning = uniqueSlugs.size > 1;

      results.push({
        groupName: `📐 ${sorted[0].name} (especificação técnica${hasMixedMeaning ? " — significado varia por ramo" : ""})`,
        categories: sorted.map(item => {
          const meaning = inferDimensionalMeaning(item.path);
          return {
            id: item.id, name: item.name, path: item.path,
            productCount: item.productCount,
            suggestedAction: "move_products" as const, mergeTarget: null,
            extractedAttributes: [{ slug: meaning.slug, label: meaning.label, value: `${dimValue}${meaning.unit}` }],
          };
        }),
        confidence: "high" as const,
        reason: hasMixedMeaning
          ? `"${sorted[0].name}" tem significado diferente conforme o ramo. Converter para o atributo correto em cada contexto.`
          : `"${sorted[0].name}" é uma especificação técnica (${meanings[0].label}). Converter para atributo.`,
      });
    } else if (classification === "energy_source") {
      const energyValue = sorted[0].name;
      const normalized = normalizeCategoryName(energyValue).includes("eletric") ? "Elétrico"
        : normalizeCategoryName(energyValue).includes("gaz") || normalizeCategoryName(energyValue).includes("gas") ? "Gás"
        : normalizeCategoryName(energyValue).includes("vapor") ? "Vapor" : energyValue;

      results.push({
        groupName: `⚡ ${sorted[0].name} (tipo de energia)`,
        categories: sorted.map(item => ({
          id: item.id, name: item.name, path: item.path,
          productCount: item.productCount,
          suggestedAction: "move_products" as const, mergeTarget: null,
          extractedAttributes: [{ slug: "pa_tipo_energia", label: "Tipo de Energia", value: normalized }],
        })),
        confidence: "high" as const,
        reason: `"${sorted[0].name}" é um tipo de energia. Converter para atributo pa_tipo_energia = "${normalized}".`,
      });
    } else if (classification === "crossed_subcategories") {
      // KEY FEATURE: Equipment type (Fogões, Fritadeiras, etc.) repeated under
      // crossed Linha x Energia subcategories
      // → Merge all into the simplest path, extract pa_linha + pa_tipo_energia per item

      // Find the "cleanest" category (shortest path, usually "CONFEÇÃO > Fogões")
      const byPathLen = [...sorted].sort((a, b) => a.path.split(" > ").length - b.path.split(" > ").length);
      const keepTarget = byPathLen[0];

      results.push({
        groupName: `❌ ${sorted[0].name} (duplicados com atributos cruzados)`,
        categories: sorted.map(item => {
          const attrs = extractCrossedAttributes(item.path);
          const isKeep = item.id === keepTarget.id;
          return {
            id: item.id, name: item.name, path: item.path,
            productCount: item.productCount,
            suggestedAction: isKeep ? ("keep" as const) : ("merge_into" as const),
            mergeTarget: isKeep ? null : keepTarget.id,
            extractedAttributes: attrs,
          };
        }),
        confidence: "high" as const,
        reason: `"${sorted[0].name}" aparece ${sorted.length}x debaixo de combinações Linha × Energia. Estrutura ideal: manter "${keepTarget.path}" como categoria principal e converter Linha/Energia em atributos-filtro (pa_linha, pa_tipo_energia) para cada produto migrado.`,
      });
    } else if (classification === "format_variant") {
      results.push({
        groupName: `🏷️ ${sorted[0].name} (formato/aplicação)`,
        categories: sorted.map((item, index) => ({
          id: item.id, name: item.name, path: item.path,
          productCount: item.productCount,
          suggestedAction: index === 0 ? ("keep" as const) : ("merge_into" as const),
          mergeTarget: index === 0 ? null : sorted[0].id,
          extractedAttributes: [],
        })),
        confidence: "medium" as const,
        reason: `"${sorted[0].name}" aparece em ${uniquePaths.size} ramos. Verifique se cada instância serve um contexto diferente.`,
      });
    } else {
      const keep = sorted[0];
      results.push({
        groupName: `❌ ${keep.name} (duplicados reais)`,
        categories: sorted.map((item, index) => ({
          id: item.id, name: item.name, path: item.path,
          productCount: item.productCount,
          suggestedAction: index === 0 ? ("keep" as const) : ("merge_into" as const),
          mergeTarget: index === 0 ? null : keep.id,
          extractedAttributes: [],
        })),
        confidence: sorted.length >= 3 ? ("high" as const) : ("medium" as const),
        reason: `Categorias com o mesmo nome em ramos diferentes. A de maior volume (${keep.path}) é sugerida como principal.`,
      });
    }
  }

  const orderMap: Record<string, number> = { "❌": 0, "📐": 1, "⚡": 2, "🏷️": 3, "⚙️": 4 };
  return results.sort((a, b) => {
    const aO = orderMap[a.groupName.substring(0, 2)] ?? 5;
    const bO = orderMap[b.groupName.substring(0, 2)] ?? 5;
    return aO - bO;
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId, aiProvider } = await req.json();

    if (!workspaceId || typeof workspaceId !== "string") {
      return new Response(JSON.stringify({ error: "workspaceId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: allCats, error: catsErr } = await supabase
      .from("categories").select("id, name, slug, parent_id").eq("workspace_id", workspaceId);
    if (catsErr) throw catsErr;
    if (!allCats || allCats.length < 2) {
      return new Response(JSON.stringify({ groups: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const catById = new Map(allCats.map(c => [c.id, c]));
    function getPath(catId: string): string {
      const parts: string[] = [];
      let current = catById.get(catId);
      while (current) { parts.unshift(current.name); current = current.parent_id ? catById.get(current.parent_id) : undefined; }
      return parts.join(" > ");
    }
    function getParentName(catId: string): string | null {
      const cat = catById.get(catId);
      if (!cat?.parent_id) return null;
      return catById.get(cat.parent_id)?.name ?? null;
    }

    const { data: products } = await supabase
      .from("products").select("category").eq("workspace_id", workspaceId).not("category", "is", null);
    const productCounts: Record<string, number> = {};
    for (const p of products || []) {
      if (p.category) {
        for (const part of (p.category as string).split(">").map((s: string) => s.trim())) {
          productCounts[part] = (productCounts[part] || 0) + 1;
        }
      }
    }

    // Build HORECA-aware prompt
    const catsForAi = [...allCats].sort((a, b) => (productCounts[b.name] ?? 0) - (productCounts[a.name] ?? 0)).slice(0, 120);
    const catList = catsForAi.map(c => `- id: ${c.id} | ${c.name} | path: ${getPath(c.id)} | products: ${productCounts[c.name] ?? 0}`).join("\n");

    const systemPrompt = `You are a HORECA equipment taxonomy expert.

## CRITICAL RULES:

### CROSSED SUBCATEGORIES (most important pattern):
Equipment types like "Fogões", "Fry-Tops", "Fritadeiras", "Fornos", "Banhos-Maria" often appear multiple times under CROSSED combinations of:
- Line/depth: "Linha 550/600", "Linha 700", "Linha 900", "Linha 900 Top/Suspensão", "Snack / Sob Bancada"
- Energy: "Eletricos", "Gaz"

Example: "CONFEÇÃO > Linha 700 > Gaz > Fogões" and "CONFEÇÃO > Linha 900 > Eletricos > Fogões"
These are the SAME equipment type split by crossed attributes. 
ACTION: Keep the simplest path (e.g. "CONFEÇÃO > Fogões"), merge others into it, and for each merged category extract TWO attributes from its path segments:
- pa_linha = value from dimensional segment
- pa_tipo_energia = value from energy segment

### DIMENSIONAL SPECS: "Linha XXX" → pa_profundidade_mm or pa_linha attribute
### ENERGY SOURCE: "Eletricos"/"Gaz" → pa_tipo_energia attribute  
### ACCESSORIES: Different parents = NOT duplicates, keep separate
### REAL DUPLICATES: Same concept repeated → merge

## RESPONSE: JSON array of groups. Each category MUST include:
- extractedAttributes: array of {slug, label, value} extracted from path segments
For crossed subcategories, extract BOTH pa_linha and pa_tipo_energia from the path.

{
  "groupName": "emoji + name",
  "categories": [{
    "id": "MUST be the exact UUID from the input data, NOT a placeholder",
    "name": "name", "path": "full > path",
    "productCount": N,
    "suggestedAction": "keep" | "merge_into" | "move_products",
    "mergeTarget": "uuid" | null,
    "extractedAttributes": [{"slug": "pa_linha", "label": "Linha", "value": "700"}, {"slug": "pa_tipo_energia", "label": "Tipo de Energia", "value": "Gás"}]
  }],
  "confidence": "high"|"medium"|"low",
  "reason": "Portuguese explanation"
}`;

    const userPrompt = `Analisa estas categorias HORECA e identifica padrões cruzados (Linha × Energia × Tipo de Equipamento), especificações técnicas, fontes de energia, acessórios contextuais e duplicados reais:\n\n${catList}`;

    const ai = getAiConfig(aiProvider);
    if (!ai.key) {
      const fallbackGroups = buildFallbackGroups(allCats, getPath, getParentName, productCounts);
      return new Response(JSON.stringify({ groups: fallbackGroups, warning: "Análise heurística HORECA (sem chave IA)." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let groups: any[];
    try {
      const aiResponse = await fetch(ai.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: ai.model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (aiResponse.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI returned ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const rawContent = aiData.choices?.[0]?.message?.content || "";
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      groups = JSON.parse(cleaned);
    } catch (aiErr) {
      console.error("AI failed, using HORECA fallback:", aiErr);
      const fallbackGroups = buildFallbackGroups(allCats, getPath, getParentName, productCounts);
      return new Response(JSON.stringify({ groups: fallbackGroups, warning: "Análise heurística HORECA aplicada." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(groups)) groups = [];

    const validGroups = groups
      .filter((g: any) => g && g.groupName && Array.isArray(g.categories))
      .map((g: any) => ({
        groupName: g.groupName,
        categories: g.categories
          .filter((c: any) => c && c.id)
          .map((c: any) => ({
            id: c.id, name: c.name || "", path: c.path || "",
            productCount: productCounts[c.name] ?? c.productCount ?? 0,
            suggestedAction: ["keep", "merge_into", "move_products"].includes(c.suggestedAction) ? c.suggestedAction : "keep",
            mergeTarget: c.mergeTarget || null,
            extractedAttributes: Array.isArray(c.extractedAttributes) ? c.extractedAttributes : [],
          })),
        confidence: ["high", "medium", "low"].includes(g.confidence) ? g.confidence : "medium",
        reason: g.reason || "",
      }))
      .filter((g: any) => g.categories.length >= 2);

    return new Response(JSON.stringify({ groups: validGroups }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("detect-duplicate-categories error:", err);
    return new Response(
      JSON.stringify({ groups: [], warning: "Serviço temporariamente indisponível.", error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
