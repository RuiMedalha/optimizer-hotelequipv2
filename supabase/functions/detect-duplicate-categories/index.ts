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

function buildFallbackGroups(
  allCats: Array<{ id: string; name: string; parent_id: string | null }>,
  getPath: (catId: string) => string,
  productCounts: Record<string, number>,
) {
  const grouped = new Map<string, Array<{ id: string; name: string; path: string; productCount: number }>>();

  for (const cat of allCats) {
    const normalized = normalizeCategoryName(cat.name);
    if (!normalized) continue;
    const entry = {
      id: cat.id,
      name: cat.name,
      path: getPath(cat.id),
      productCount: productCounts[cat.name] ?? 0,
    };
    const existing = grouped.get(normalized) ?? [];
    existing.push(entry);
    grouped.set(normalized, existing);
  }

  return Array.from(grouped.values())
    .map((items) => {
      const uniquePaths = new Set(items.map((item) => item.path));
      if (items.length < 2 || uniquePaths.size < 2) return null;

      const sorted = [...items].sort((a, b) => b.productCount - a.productCount || a.path.localeCompare(b.path));
      const keep = sorted[0];

      return {
        groupName: keep.name,
        categories: sorted.map((item, index) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          productCount: item.productCount,
          suggestedAction: index === 0 ? "keep" : "merge_into",
          mergeTarget: index === 0 ? null : keep.id,
        })),
        confidence: sorted.length >= 3 ? "high" : "medium",
        reason: "Análise de fallback: categorias com o mesmo nome normalizado foram encontradas em ramos diferentes do catálogo.",
      };
    })
    .filter(Boolean);
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

    // 2. Build parent paths
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

    // 4. Build prompt — limit to 200 categories to avoid gateway timeout
    const catsForAi = allCats.slice(0, 200);
    const catList = catsForAi.map(c =>
      `- ${c.name} | path: ${getPath(c.id)} | products: ${productCounts[c.name] ?? 0}`
    ).join("\n");

    const systemPrompt = `You are an e-commerce taxonomy expert. Identify categories that represent the same concept but exist in different parts of the catalogue tree. Focus on: same equipment type in different parent categories, same product type with slightly different names, subcategories that clearly belong together.

Respond ONLY with a valid JSON array, no markdown, no explanation outside JSON.`;

    const userPrompt = `Here is the full category list with product counts:
${catList}

Find groups of categories that are semantic duplicates or overlaps.
For each group return:
{
  "groupName": string,
  "categories": [{
    "id": string,
    "name": string,
    "path": string,
    "productCount": number,
    "suggestedAction": "keep" | "merge_into" | "move_products",
    "mergeTarget": string | null
  }],
  "confidence": "high" | "medium" | "low",
  "reason": string
}`;

    const ai = getAiConfig(aiProvider);
    if (!ai.key) {
      return new Response(JSON.stringify({ error: "AI API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      const t = await aiResponse.text();
      console.error("AI error:", aiResponse.status, t);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    let groups: any[];
    try {
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      groups = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse duplicate detection response:", rawContent.substring(0, 300));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", groups: [] }), {
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
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
