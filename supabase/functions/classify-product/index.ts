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

    // Fetch existing categories for this workspace
    const { data: categories } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id, description")
      .eq("workspace_id", workspace_id);

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

Your task: classify a raw product into the most specific correct category from the existing taxonomy.

CRITICAL RULES:
1. You MUST ONLY use categories that ALREADY EXIST in the catalog taxonomy provided below.
2. DO NOT invent new category names. 
3. If no existing category is a good match, set category_id to null and requires_review to true.
4. Choose the MOST SPECIFIC category possible (usually a child category).
5. ACCESSORY DETECTION: If the product is an accessory, part, or extra (e.g., "Estante", "Prateleira", "Grelha", "Cesto", "Shelf", "Kit", "Suporte", "Acessório"), you MUST look for a sub-category named "Acessorios" within the relevant top-level category (e.g., "FRIO COMERCIAL > Acessorios").
6. Always provide reasoning for your choice.
7. Suggest up to 3 alternative categories from the list if relevant.

EXISTING CATEGORIES (Full Path):
${categoryList.map(c => `- [${c.id}] ${c.full_path}`).join('\n')}

You MUST respond with valid JSON only. Use this exact schema:
{
  "category_id": "uuid from the list above or null",
  "category_name": "the full_path string of the chosen category",
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
