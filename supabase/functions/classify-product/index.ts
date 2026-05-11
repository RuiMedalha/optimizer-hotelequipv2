import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};


async function findSimilarInMeilisearch(
  title: string,
  specs?: string
): Promise<Array<{ title: string; category: string }>> {
  const MEILI_URL = "https://search.palamenta.com.pt";
  const MEILI_KEY = "ed7cabcddd7aeeed55e18972f4ec98dccd3c27bf78cb82962d04e1661778011e";
  const INDEX = "products_stage";

  const query = `${title} ${specs || ""}`.trim().substring(0, 200);

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
        if (Array.isArray(h.categories)) {
          // If it's a single string that looks like a path, use it
          if (h.categories.length === 1 && h.categories[0].includes("&gt;")) {
            categoryPath = h.categories[0].replace(/&gt;/g, " > ");
          } else if (h.categories.length === 1 && h.categories[0].includes(" > ")) {
            categoryPath = h.categories[0];
          } else {
            // It's an array of category names. We'll return it as a joined string for now,
            // but the consensus logic will be improved to handle this.
            categoryPath = h.categories.join(" > ");
          }
        }
        return {
          title: h.title || "",
          category: categoryPath,
          raw_categories: Array.isArray(h.categories) ? h.categories : [h.categories]
        };
      });
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product } = await req.json();
    if (!workspace_id || !product) throw new Error("workspace_id and product are required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Extract SKU prefix
    const sku = product.sku || "";
    const skuPrefix = sku.match(/^[A-Z]+/)?.[0] || sku.substring(0, 3);

    // 1. Fetch patterns from category_learning
    const { data: learningPatterns } = await supabase
      .from("category_learning")
      .select("*")
      .eq("sku_prefix", skuPrefix)
      .order("times_confirmed", { ascending: false });

    // 2. Fetch existing categories for this workspace and global categories
    const { data: categories } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id, description, workspace_id")
      .or(`workspace_id.eq.${workspace_id},workspace_id.is.null`);

    // 3. Fetch some successfully categorized products to use as examples (Few-Shot Prompting)
    const { data: examples } = await supabase
      .from("products")
      .select("original_title, category")
      .not("category", "is", null)
      .eq("workspace_id", workspace_id)
      .limit(15);

    const cats = categories || [];
    
    // Create a map for quick lookup and building full paths
    const catMap = new Map(cats.map(c => [c.id, c]));
    
    const getFullPath = (catId: string): string => {
      const cat = catMap.get(catId);
      if (!cat) return "";
      
      // If the name already contains hierarchy separators, treat it as a path
      const currentName = cat.name.replace(/&gt;/g, " > ");
      
      if (cat.parent_id) {
        const parentPath = getFullPath(cat.parent_id);
        if (parentPath) {
          // Check if parentPath is already contained in currentName to avoid duplication
          if (currentName.startsWith(parentPath)) return currentName;
          return `${parentPath} > ${currentName}`;
        }
      }
      return currentName;
    };

    // Build the category list and deduplicate by full_path
    const uniqueCategoryMap = new Map<string, any>();
    
    cats.forEach((c: any) => {
      const fullPath = getFullPath(c.id);
      if (!uniqueCategoryMap.has(fullPath) || !c.workspace_id) {
        uniqueCategoryMap.set(fullPath, {
          id: c.id,
          name: c.name,
          full_path: fullPath,
          description: c.description,
        });
      }
    });

    const categoryList = Array.from(uniqueCategoryMap.values());
    const learningExamplesStr = (learningPatterns || []).map(p => `- SKU Prefix: "${p.sku_prefix}" -> Category: "${p.category_path}" (Confidence: ${p.confidence}%)`).join('\n');

    // Query Meilisearch for similar published products
    const similarProducts = await findSimilarInMeilisearch(
      product.title || product.original_title || "",
      product.technical_specs || ""
    );
    
    // MEILISEARCH CONSENSUS CHECK — if 3+ similar products agree on same category, use it directly
    if (similarProducts.length >= 3) {
      // Count specific category path votes
      const categoryVotes = new Map<string, number>();
      for (const sp of similarProducts) {
        if (sp.category) {
          categoryVotes.set(sp.category, (categoryVotes.get(sp.category) || 0) + 1);
        }
      }
      
      // Find if any category has consensus (>= 3 votes)
      let bestPath = "";
      let maxVotes = 0;

      for (const [path, votes] of categoryVotes.entries()) {
        if (votes >= 3 && votes > maxVotes) {
          bestPath = path;
          maxVotes = votes;
        }
      }

      if (bestPath) {
        const pathParts = bestPath.split(" > ").map(p => p.trim());
        
        let matchingCat = categoryList.find(c => c.full_path === bestPath);
        
        if (!matchingCat) {
          // If no exact match, find the category from pathParts that is the most specific (deepest) in our DB
          let deepestCat = null;
          let maxDepth = -1;
          
          for (const part of pathParts) {
            const matches = categoryList.filter(c => c.name === part);
            for (const m of matches) {
              const depth = m.full_path.split(" > ").length;
              if (depth > maxDepth) {
                maxDepth = depth;
                deepestCat = m;
              }
            }
          }
          matchingCat = deepestCat;
        }
        
        if (matchingCat) {
          console.log(`[classify] Meilisearch consensus: ${maxVotes} products in "${bestPath}". Matched to deepest DB cat: "${matchingCat.full_path}"`);
          
          return new Response(JSON.stringify({
            category_id: matchingCat.id,
            category_name: matchingCat.full_path,
            confidence_score: 0.95,
            requires_review: false,
            alternative_categories: [],
            reasoning: `Meilisearch consensus: ${maxVotes} similar products. Reconstructed hierarchy using catalog database.`,
            source: "meilisearch_consensus"
          }), { 
            headers: { 
              ...corsHeaders,
              "Content-Type": "application/json" 
            } 
          });
        }
      }
    }

    const similarContext = similarProducts.length > 0
      ? `\nProdutos similares já publicados com categorias correctas:\n${
          similarProducts.map(p => `- "${p.title}" → ${p.category}`).join("\n")
        }\n\nUsa estes como referência principal para escolher a categoria.\n`
      : "";

    // Build the prompt
    const systemPrompt = `You are a Product Classification Agent for an e-commerce catalog management system focused on the HORECA sector.

Your task: classify a raw product into the MOST SPECIFIC correct category from the existing taxonomy provided.

CRITICAL RULES:
1. SPECIFICITY IS MANDATORY: Never provide just a top-level category (like "CONFEÇÃO" or "FRIO COMERCIAL") if there are subcategories available. You MUST navigate the hierarchy to the leaf node (e.g., "CONFEÇÃO > Fogões > Fogões de Bancada").
2. taxonomy accuracy: You MUST ONLY use categories that ALREADY EXIST in the catalog taxonomy provided below.
3. DO NOT truncate the hierarchy. ALWAYS provide the FULL path starting from the root.
4. TEMPERATURE DETECTION: 
   - If description or title mentions cooling, refrigerated, "frio", "frigorífico", "chiller", "refrigeração", "refrigerado", "positivo", or positive temperatures (e.g., "0°C", "+2°C"), the category MUST start with "FRIO COMERCIAL".
   - If description or title mentions freezing, "congelação", "congelador", "congelado", "freezer", "negativo", or negative temperatures (e.g., "-18°C", "-20°C"), prioritize "CONGELAÇÃO" or the relevant sub-path within "FRIO COMERCIAL" if it contains freezing units.
5. ACCESSORY DETECTION: If the product is an accessory (e.g., "Estante", "Prateleira", "Grelha", "Cesto", "Shelf", "Kit", "Suporte", "Acessório"), you MUST look for the "Acessorios" sub-category within the correct top-level category.
6. MISMATCH PROTECTION: If the products from Meilisearch have completely different titles from the target product, IGNORE their categories and rely on the Taxonomy and your internal logic.
7. SUGGESTIONS: Provide up to 3 alternative categories if relevant.

LEARNING PATTERNS (Strong indicators based on SKU prefix):
${learningExamplesStr || "No specific patterns yet."}

LEARNING EXAMPLES (How existing products are classified):
${examples?.map(e => `- Product: "${e.original_title}" -> Category: "${e.category}"`).join('\n') || "No examples available yet."}

${similarContext}
EXISTING CATEGORIES (Use EXACT "full_path" strings):
${categoryList.map(c => `- [${c.id}] ${c.full_path}`).join('\n')}

You MUST respond with valid JSON only. Use this exact schema:
{
  "category_id": "uuid from the list above",
  "category_name": "the EXACT full_path string of the chosen category",
  "confidence_score": 0.0-1.0,
  "requires_review": boolean,
  "alternative_categories": [
    { "category_id": "uuid from list", "category_name": "full_path string", "confidence_score": 0.0-1.0 }
  ],
  "reasoning": "string explaining why this category was chosen"
}`;

    const userPrompt = `Classify this product:

Title: ${product.title || product.original_title || "N/A"}
Description: ${product.description || product.original_description || "N/A"}
Brand: ${product.brand || "N/A"}
Supplier: ${product.supplier || "N/A"}
Technical Specs: ${product.technical_specs || product.specifications || "N/A"}
Attributes: ${product.attributes ? JSON.stringify(product.attributes) : "N/A"}`;

    const routeResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        taskType: "categorization",
        workspaceId: workspace_id,
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        options: { max_tokens: 1024 },
      }),
    });

    if (!routeResp.ok) {
      const errText = await routeResp.text();
      throw new Error(`AI Route error: ${routeResp.status} - ${errText}`);
    }

    const routeData = await routeResp.json();
    const content = routeData.result?.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let classification;
    try {
      classification = JSON.parse(jsonStr);
      
      // Validation: Ensure the category_id exists in our list if not null
      if (classification.category_id && !catMap.has(classification.category_id)) {
        console.warn(`AI suggested non-existent category ID: ${classification.category_id}. Reverting to null.`);
        classification.category_id = null;
        classification.requires_review = true;
      }
    } catch {
      classification = {
        category_id: null,
        category_name: "Uncategorized",
        confidence_score: 0,
        requires_review: true,
        alternative_categories: [],
        reasoning: "Failed to parse AI response: " + content.substring(0, 200),
      };
    }

    // Record agent run
    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "product_classification",
      status: "completed",
      input_payload: { product_title: product.title || product.original_title, workspace_id },
      output_payload: classification,
      confidence_score: classification.confidence_score,
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      ...classification,
      _meta: routeData.meta,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});