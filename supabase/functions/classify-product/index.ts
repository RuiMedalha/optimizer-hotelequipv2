import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product } = await req.json();
    if (!workspace_id || !product) throw new Error("workspace_id and product are required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch existing categories for this workspace and global categories
    const { data: categories } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id, description, workspace_id")
      .or(`workspace_id.eq.${workspace_id},workspace_id.is.null`);

    // Fetch some successfully categorized products to use as examples (Few-Shot Prompting)
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
      if (cat.parent_id) {
        const parentPath = getFullPath(cat.parent_id);
        return parentPath ? `${parentPath} > ${cat.name}` : cat.name;
      }
      return cat.name;
    };

    const categoryList = cats.map((c: any) => ({
      id: c.id,
      name: c.name,
      full_path: getFullPath(c.id),
      description: c.description,
    }));

    // Build the prompt
    const systemPrompt = `You are a Product Classification Agent for an e-commerce catalog management system focused on the HORECA sector.

Your task: classify a raw product into the most specific correct category from the existing taxonomy provided.

CRITICAL RULES:
1. You MUST ONLY use categories that ALREADY EXIST in the catalog taxonomy provided below.
2. DO NOT invent new category names, do not fix typos, and do not truncate the hierarchy.
3. ALWAYS provide the FULL path starting from the root (e.g., "FRIO COMERCIAL > Armarios > Expositores > Bebidas/Cerveja").
4. If you suggest "Armarios > Expositores > Bebidas/Cerveja" without "FRIO COMERCIAL", it is WRONG.
5. TEMPERATURE DETECTION: If description mentions cooling, refrigerated, "frio", "frigorífico", "chiller", "refrigeração" or positive temperatures (0°C to 15°C), prioritize "FRIO COMERCIAL".
6. If description mentions freezing, "congelação", "congelador", "freezer" or negative temperatures (-18°C, etc), prioritize "CONGELAÇÃO".
7. ACCESSORY DETECTION: If the product is an accessory (e.g., "Estante", "Prateleira", "Grelha", "Cesto", "Shelf", "Kit", "Suporte", "Acessório"), you MUST look for the "Acessorios" sub-category within the correct top-level category.
8. Choose the MOST SPECIFIC category possible (the leaf node).
9. Suggest up to 3 alternative categories from the list if relevant.

LEARNING EXAMPLES (How existing products are classified):
${examples?.map(e => `- Product: "${e.original_title}" -> Category: "${e.category}"`).join('\n') || "No examples available yet."}

EXISTING CATEGORIES (Use these EXACT strings for "category_name"):
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
