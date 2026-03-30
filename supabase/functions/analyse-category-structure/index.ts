import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId, parentCategoryId, aiProvider } = await req.json();

    if (!workspaceId || typeof workspaceId !== "string") {
      return new Response(JSON.stringify({ error: "workspaceId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!parentCategoryId || typeof parentCategoryId !== "string") {
      return new Response(JSON.stringify({ error: "parentCategoryId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Load parent category
    const { data: parentCat, error: parentErr } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id")
      .eq("id", parentCategoryId)
      .eq("workspace_id", workspaceId)
      .single();

    if (parentErr || !parentCat) {
      return new Response(JSON.stringify({ error: "Category not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Load ALL categories in workspace to build subtree
    const { data: allCats, error: catsErr } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id, sort_order")
      .eq("workspace_id", workspaceId);

    if (catsErr) throw catsErr;

    // Build subtree recursively
    interface CatNode {
      id: string;
      name: string;
      slug: string | null;
      parent_id: string | null;
      depth: number;
      children: CatNode[];
    }

    function buildSubtree(parentId: string, depth: number): CatNode[] {
      return (allCats || [])
        .filter((c: any) => c.parent_id === parentId)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          parent_id: c.parent_id,
          depth,
          children: buildSubtree(c.id, depth + 1),
        }));
    }

    const children = buildSubtree(parentCategoryId, 1);

    if (children.length === 0) {
      return new Response(JSON.stringify({ error: "no_children" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Flatten subtree for product counting
    function flattenTree(nodes: CatNode[]): CatNode[] {
      const result: CatNode[] = [];
      for (const n of nodes) {
        result.push(n);
        result.push(...flattenTree(n.children));
      }
      return result;
    }
    const flatChildren = flattenTree(children);

    // 4. Count products per category name
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("category")
      .eq("workspace_id", workspaceId)
      .not("category", "is", null);

    if (prodErr) throw prodErr;

    const productCounts: Record<string, number> = {};
    for (const p of products || []) {
      if (p.category) {
        const parts = (p.category as string).split(">").map((s: string) => s.trim());
        for (const part of parts) {
          productCounts[part] = (productCounts[part] || 0) + 1;
        }
      }
    }

    // 5. Build prompt content
    function formatNode(node: CatNode, indent: string): string {
      const count = productCounts[node.name] ?? 0;
      let line = `${indent}- ${node.name} (id: ${node.id}, depth: ${node.depth}, products: ${count})`;
      for (const child of node.children) {
        line += "\n" + formatNode(child, indent + "  ");
      }
      return line;
    }

    const treeText = children.map((c) => formatNode(c, "")).join("\n");

    const systemPrompt = `You are an e-commerce taxonomy expert specialising in B2B hospitality equipment catalogues. Analyse the following WooCommerce category structure and suggest how to simplify it using product attributes/filters instead of deep subcategories.

Rules for your analysis:
- Categories with fewer than 15 products are strong candidates to become attribute values (not standalone categories)
- Categories whose names are variations of the same concept (e.g. L500/L600/L700 or Mural/Central/Parede) should become a single attribute with multiple values
- Maximum recommended depth is 2 levels (parent + direct children only)
- Keep as category only if it has 20+ products AND represents a genuinely different type of product (not just a size/position/energy variant)

Respond ONLY with a valid JSON array, no markdown, no explanation outside JSON.`;

    const userPrompt = `Category: ${parentCat.name}
Children and their product counts:
${treeText}

Suggest what to do with each subcategory. For each one return:
{
  "categoryName": string,
  "categoryId": string, 
  "action": "keep" | "convert" | "merge",
  "attributeSlug": string | null,
  "attributeValues": string[] | null,
  "mergeIntoName": string | null,
  "confidence": "high" | "medium" | "low",
  "reason": string  // 1 sentence explanation in Portuguese
}`;

    // 6. Call Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // 7. Parse JSON from response (strip markdown fences if present)
    let suggestions: any[];
    try {
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      suggestions = JSON.parse(cleaned);
    } catch {
      // Retry once with stricter prompt
      console.error("Failed to parse AI response, retrying...", rawContent.substring(0, 200));
      const retryResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt + "\n\nCRITICAL: Output ONLY a raw JSON array. No markdown fences, no text before or after." },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!retryResponse.ok) {
        const t = await retryResponse.text();
        console.error("Retry also failed:", t);
        return new Response(JSON.stringify({ error: "AI returned invalid format" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const retryData = await retryResponse.json();
      const retryContent = retryData.choices?.[0]?.message?.content || "";
      try {
        const cleaned2 = retryContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        suggestions = JSON.parse(cleaned2);
      } catch {
        return new Response(JSON.stringify({ error: "AI returned invalid JSON after retry" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 8. Validate & enrich with actual category IDs
    const catMap = new Map(flatChildren.map((c) => [c.id, c]));
    const catNameMap = new Map(flatChildren.map((c) => [c.name.toLowerCase(), c]));

    const enriched = suggestions
      .filter((s: any) => s && s.categoryName)
      .map((s: any) => {
        // Try to match by ID first, then by name
        let matched = s.categoryId ? catMap.get(s.categoryId) : null;
        if (!matched) {
          matched = catNameMap.get(s.categoryName.toLowerCase()) || null;
        }
        return {
          categoryName: s.categoryName,
          categoryId: matched?.id || s.categoryId || null,
          action: ["keep", "convert", "merge"].includes(s.action) ? s.action : "keep",
          attributeSlug: s.attributeSlug || null,
          attributeValues: Array.isArray(s.attributeValues) ? s.attributeValues : null,
          mergeIntoName: s.mergeIntoName || null,
          confidence: ["high", "medium", "low"].includes(s.confidence) ? s.confidence : "medium",
          reason: s.reason || "",
          productCount: productCounts[s.categoryName] ?? 0,
        };
      });

    return new Response(JSON.stringify({ suggestions: enriched }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("analyse-category-structure error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
