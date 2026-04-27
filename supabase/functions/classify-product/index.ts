import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const categoryList = (categories || []).map((c: any) => ({
      id: c.id, name: c.name, slug: c.slug, parent_id: c.parent_id, description: c.description,
    }));

    // Build the prompt
    const systemPrompt = `You are a Product Classification Agent for an e-commerce catalog management system focused on the HORECA sector (Hotels, Restaurants, Catering).

Your task: classify a raw product into the most specific correct category from the existing taxonomy.

RULES:
1. Choose the MOST SPECIFIC category possible. Never pick a generic parent if a child matches.
2. Prioritize categories that ALREADY EXIST in the catalog taxonomy provided below.
3. ACCESSORY DETECTION: If the product is an accessory, part, or extra (e.g., "Estante", "Prateleira", "Grelha", "Cesto", "Shelf", "Kit"), you MUST look for a sub-category named "Acessorios" or similar within the relevant top-level category.
4. Consider typical HORECA sector patterns (commercial kitchen equipment, tableware, food service, cleaning, etc.).
5. If confidence is below 0.7, set requires_review = true.
6. Always provide reasoning for your choice.
6. Suggest up to 3 alternative categories if relevant.

EXISTING CATEGORIES:
${JSON.stringify(categoryList, null, 2)}

You MUST respond with valid JSON only, no markdown, no extra text. Use this exact schema:
{
  "category_id": "uuid or null if no existing category matches",
  "category_name": "string - the category name",
  "confidence_score": 0.0-1.0,
  "requires_review": boolean,
  "alternative_categories": [
    { "category_id": "uuid or null", "category_name": "string", "confidence_score": 0.0-1.0 }
  ],
  "reasoning": "string explaining why this category was chosen"
}`;

    const userPrompt = `Classify this product:

Title: ${product.title || product.original_title || "N/A"}
Description: ${product.description || product.original_description || "N/A"}
Brand: ${product.brand || "N/A"}
Supplier: ${product.supplier || "N/A"}
Technical Specs: ${product.technical_specs || product.specifications || "N/A"}
Attributes: ${product.attributes ? JSON.stringify(product.attributes) : "N/A"}
${product.candidate_categories ? `Candidate categories: ${JSON.stringify(product.candidate_categories)}` : ""}`;

    // Call resolve-ai-route instead of hardcoded gateway
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

    // Record agent run for observability
    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "product_classification",
      status: "completed",
      input_payload: { product_title: product.title || product.original_title, workspace_id },
      output_payload: classification,
      confidence_score: classification.confidence_score,
      cost_estimate: routeData.result?.usage ? (routeData.result.usage.prompt_tokens + routeData.result.usage.completion_tokens) * 0.000001 : null,
      completed_at: new Date().toISOString(),
    }).throwOnError();

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
