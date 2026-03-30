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
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ─── HORECA dimensional patterns ─────────────────────────────────
const DIMENSIONAL_PATTERNS = /^(linha\s*\d+|l\s*\d+|a\s*\d+|\d+\/\d+)/i;
const ENERGY_PATTERNS = /^(eletricos?|electricos?|gas|gaz|a\s+vapor)$/i;
const ACCESSORY_PATTERNS = /^(acessorios?|acessórios?|complementos?)$/i;
const FORMAT_PATTERNS = /^(snack|bar|gastronorm|pastelaria\s*\/?\s*padaria)$/i;

type CatClassification = "dimensional" | "energy_source" | "accessory" | "format_variant" | "real_duplicate";

function classifyDuplicateGroup(
  name: string,
  entries: Array<{ id: string; name: string; path: string; parentName: string | null }>,
): CatClassification {
  const norm = normalizeCategoryName(name);
  if (DIMENSIONAL_PATTERNS.test(norm) || DIMENSIONAL_PATTERNS.test(name)) return "dimensional";
  if (ENERGY_PATTERNS.test(norm) || ENERGY_PATTERNS.test(name)) return "energy_source";
  if (ACCESSORY_PATTERNS.test(norm) || ACCESSORY_PATTERNS.test(name)) return "accessory";
  if (FORMAT_PATTERNS.test(norm) || FORMAT_PATTERNS.test(name)) return "format_variant";

  // Check if all entries share the same parent branch — if not, they're contextual, not duplicates
  const rootBranches = new Set(entries.map(e => e.path.split(" > ")[0]));
  if (rootBranches.size > 1) {
    // Same name in completely different root branches — likely contextual subcategories
    if (ACCESSORY_PATTERNS.test(norm)) return "accessory";
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
    // Need at least 2 entries in different paths
    const uniquePaths = new Set(items.map((item) => item.path));
    if (items.length < 2 || uniquePaths.size < 2) continue;

    const classification = classifyDuplicateGroup(items[0].name, items);
    const sorted = [...items].sort((a, b) => b.productCount - a.productCount || a.path.localeCompare(b.path));

    if (classification === "accessory") {
      // Acessórios/Complementos: NOT duplicates — they're contextual subcategories
      // Group them but suggest "keep" for all, with explanation
      results.push({
        groupName: `⚙️ ${sorted[0].name} (contextual)`,
        categories: sorted.map(item => ({
          id: item.id,
          name: item.name,
          path: item.path,
          productCount: item.productCount,
          suggestedAction: "keep" as const,
          mergeTarget: null,
        })),
        confidence: "low" as const,
        reason: `"${sorted[0].name}" existe em ${uniquePaths.size} ramos diferentes porque cada equipamento tem os seus próprios acessórios. NÃO são duplicados — são subcategorias contextuais (ex: Acessórios de Fornos ≠ Acessórios de Frio). Considere manter como estão ou converter para tags/atributos dentro de cada ramo.`,
      });
    } else if (classification === "dimensional") {
      // Linha 600/700/900, L500, a 600: dimensional specs → convert to attributes
      const dimValue = sorted[0].name.replace(/\D+/g, " ").trim().split(/\s+/)[0] || sorted[0].name;
      results.push({
        groupName: `📐 ${sorted[0].name} (especificação dimensional)`,
        categories: sorted.map(item => ({
          id: item.id,
          name: item.name,
          path: item.path,
          productCount: item.productCount,
          suggestedAction: "move_products" as const,
          mergeTarget: null,
        })),
        confidence: "high" as const,
        reason: `"${sorted[0].name}" é uma especificação dimensional/técnica (profundidade em mm), não uma categoria real. Aparece em ${uniquePaths.size} ramos diferentes (${[...new Set(sorted.map(s => s.path.split(" > ")[0]))].join(", ")}). Recomendação: converter para atributo (ex: pa_profundidade_mm = ${dimValue}) em cada ramo e mover os produtos para a categoria pai.`,
      });
    } else if (classification === "energy_source") {
      // Eletricos/Gaz/A vapor: energy source → convert to attributes
      results.push({
        groupName: `⚡ ${sorted[0].name} (tipo de energia)`,
        categories: sorted.map(item => ({
          id: item.id,
          name: item.name,
          path: item.path,
          productCount: item.productCount,
          suggestedAction: "move_products" as const,
          mergeTarget: null,
        })),
        confidence: "high" as const,
        reason: `"${sorted[0].name}" é um tipo de energia/alimentação, não uma categoria funcional. Recomendação: converter para atributo pa_tipo_energia = "${sorted[0].name}" e mover os produtos para a categoria pai funcional (ex: Fogões, Fritadeiras).`,
      });
    } else if (classification === "format_variant") {
      // Snack, Bar, Gastronorm: format/application context
      results.push({
        groupName: `🏷️ ${sorted[0].name} (formato/aplicação)`,
        categories: sorted.map((item, index) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          productCount: item.productCount,
          suggestedAction: index === 0 ? ("keep" as const) : ("merge_into" as const),
          mergeTarget: index === 0 ? null : sorted[0].id,
        })),
        confidence: "medium" as const,
        reason: `"${sorted[0].name}" aparece em ${uniquePaths.size} ramos. Pode representar um formato/aplicação (ex: equipamento Snack vs linha completa). Verifique se faz sentido unificar ou se cada instância serve um contexto diferente.`,
      });
    } else {
      // real_duplicate: same concept in different branches
      const keep = sorted[0];
      results.push({
        groupName: keep.name,
        categories: sorted.map((item, index) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          productCount: item.productCount,
          suggestedAction: index === 0 ? ("keep" as const) : ("merge_into" as const),
          mergeTarget: index === 0 ? null : keep.id,
        })),
        confidence: sorted.length >= 3 ? ("high" as const) : ("medium" as const),
        reason: `Categorias com o mesmo nome em ramos diferentes. A de maior volume (${keep.path}) é sugerida como principal.`,
      });
    }
  }

  // Sort: real duplicates first, then dimensional, then energy, then format, then accessories
  const classOrder: Record<CatClassification, number> = {
    real_duplicate: 0,
    dimensional: 1,
    energy_source: 2,
    format_variant: 3,
    accessory: 4,
  };

  return results.sort((a, b) => {
    const aClass = a.groupName.startsWith("📐") ? 1 : a.groupName.startsWith("⚡") ? 2 : a.groupName.startsWith("🏷️") ? 3 : a.groupName.startsWith("⚙️") ? 4 : 0;
    const bClass = b.groupName.startsWith("📐") ? 1 : b.groupName.startsWith("⚡") ? 2 : b.groupName.startsWith("🏷️") ? 3 : b.groupName.startsWith("⚙️") ? 4 : 0;
    return aClass - bClass;
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

    // 1. Load ALL categories
    const { data: allCats, error: catsErr } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id")
      .eq("workspace_id", workspaceId);
    if (catsErr) throw catsErr;
    if (!allCats || allCats.length < 2) {
      return new Response(JSON.stringify({ groups: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Build parent paths & helpers
    const catById = new Map(allCats.map(c => [c.id, c]));
    function getPath(catId: string): string {
      const parts: string[] = [];
      let current = catById.get(catId);
      while (current) {
        parts.unshift(current.name);
        current = current.parent_id ? catById.get(current.parent_id) : undefined;
      }
      return parts.join(" > ");
    }
    function getParentName(catId: string): string | null {
      const cat = catById.get(catId);
      if (!cat?.parent_id) return null;
      return catById.get(cat.parent_id)?.name ?? null;
    }

    // 3. Load product counts
    const { data: products } = await supabase
      .from("products")
      .select("category")
      .eq("workspace_id", workspaceId)
      .not("category", "is", null);

    const productCounts: Record<string, number> = {};
    for (const p of products || []) {
      if (p.category) {
        const parts = (p.category as string).split(">").map((s: string) => s.trim());
        for (const part of parts) {
          productCounts[part] = (productCounts[part] || 0) + 1;
        }
      }
    }

    // 4. Build HORECA-aware prompt
    const catsForAi = [...allCats]
      .sort((a, b) => (productCounts[b.name] ?? 0) - (productCounts[a.name] ?? 0))
      .slice(0, 120);
    const catList = catsForAi.map(c =>
      `- ${c.name} | path: ${getPath(c.id)} | products: ${productCounts[c.name] ?? 0}`
    ).join("\n");

    const systemPrompt = `You are a HORECA (Hotel, Restaurant, Catering) equipment taxonomy expert specializing in commercial kitchen and foodservice equipment catalogues.

## CRITICAL CLASSIFICATION RULES FOR HORECA CATALOGUES:

### 1. DIMENSIONAL SPECIFICATIONS (NEVER real categories):
- "Linha 550", "Linha 600", "Linha 700", "Linha 900", "Linha 1400" → These are EQUIPMENT DEPTH in mm
- "L500", "L600", "L700", "L800" → Same thing, depth/width specs
- "a 600" → depth specification
- "400/600/700/1400" → Combined dimension options
- ACTION: Always suggest converting to attribute (pa_profundidade_mm or pa_largura_mm) — NEVER merge across branches. "Linha 700" under CONFEÇÃO is about cooking equipment depth, "Linha 700" under FRIO COMERCIAL is about refrigeration unit depth — same spec, different product families.

### 2. ENERGY SOURCE (convert to attribute, NOT a category):
- "Eletricos", "Eléctricos", "Gaz", "Gás", "A vapor" → Energy/power source
- ACTION: Convert to attribute pa_tipo_energia = "Elétrico" / "Gás" / "Vapor". These split the same equipment type by power source.

### 3. ACCESSORIES & COMPLEMENTS (contextual, usually NOT duplicates):
- "Acessórios", "Acessorios", "Complementos" under different parents
- "Acessórios" under FORNOS ≠ "Acessórios" under FRIO COMERCIAL ≠ "Acessórios" under LAVAGEM LOUÇA
- ACTION: These are contextual subcategories — each equipment family has its own accessories. Do NOT merge across different equipment families. If the parent equipment categories are the same, THEN they may be duplicates.

### 4. FORMAT/APPLICATION VARIANTS:
- "Snack", "Bar", "Gastronorm", "Pastelaria / Padaria" appearing under different parents
- ACTION: Check if they represent the same products in different contexts or genuinely different product applications.

### 5. REAL DUPLICATES (should be merged):
- Same equipment type with identical names in different branches (e.g., "Abatedores de Temperatura" appearing 3x under FRIO COMERCIAL)
- Same concept with slight name variations (e.g., "Fornos Micro-Ondas" under both CONFEÇÃO and FORNOS)
- Corrupted names with ">" or "|" that represent broken hierarchy imports

## RESPONSE FORMAT:
Respond ONLY with a valid JSON array. For each group:
{
  "groupName": "descriptive name with emoji prefix: 📐 for dimensional, ⚡ for energy, ⚙️ for accessories, 🏷️ for format, ❌ for real duplicates",
  "categories": [{
    "id": "category UUID",
    "name": "category name",
    "path": "full > path",
    "productCount": number,
    "suggestedAction": "keep" | "merge_into" | "move_products",
    "mergeTarget": "target category UUID" | null
  }],
  "confidence": "high" | "medium" | "low",
  "reason": "Portuguese explanation of why these are grouped and what to do"
}

For dimensional/energy categories, suggestedAction should be "move_products" (move to parent, then convert category to attribute).
For accessories, suggestedAction should be "keep" (they are NOT duplicates).
For real duplicates, one should be "keep" and others "merge_into".`;

    const userPrompt = `Analisa estas categorias de um catálogo de equipamentos HORECA profissional e identifica:
1. Especificações dimensionais disfarçadas de categorias (Linha XXX, LXXX)
2. Fontes de energia como categorias (Eletricos, Gaz)
3. Acessórios/Complementos contextuais (mesmos nomes em ramos diferentes)
4. Duplicados reais (mesmo conceito repetido desnecessariamente)

${catList}`;

    const ai = getAiConfig(aiProvider);
    if (!ai.key) {
      // No AI key — use heuristic fallback
      const fallbackGroups = buildFallbackGroups(allCats, getPath, getParentName, productCounts);
      return new Response(JSON.stringify({
        groups: fallbackGroups,
        warning: "Análise heurística HORECA (sem chave IA configurada).",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let groups: any[];
    try {
      const aiResponse = await fetch(ai.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ai.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: ai.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (aiResponse.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`AI returned ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const rawContent = aiData.choices?.[0]?.message?.content || "";
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      groups = JSON.parse(cleaned);
    } catch (aiErr) {
      console.error("AI analysis failed, using HORECA-aware fallback:", aiErr);
      const fallbackGroups = buildFallbackGroups(allCats, getPath, getParentName, productCounts);
      return new Response(JSON.stringify({
        groups: fallbackGroups,
        warning: "A IA falhou temporariamente; a análise HORECA heurística identificou os padrões automaticamente.",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(groups)) groups = [];

    // Validate and enrich
    const validGroups = groups
      .filter((g: any) => g && g.groupName && Array.isArray(g.categories))
      .map((g: any) => ({
        groupName: g.groupName,
        categories: g.categories
          .filter((c: any) => c && c.id)
          .map((c: any) => ({
            id: c.id,
            name: c.name || "",
            path: c.path || "",
            productCount: productCounts[c.name] ?? c.productCount ?? 0,
            suggestedAction: ["keep", "merge_into", "move_products"].includes(c.suggestedAction) ? c.suggestedAction : "keep",
            mergeTarget: c.mergeTarget || null,
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
      JSON.stringify({
        groups: [],
        warning: "O serviço de análise está temporariamente indisponível. Tente novamente dentro de instantes.",
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
