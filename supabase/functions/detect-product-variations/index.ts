import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, products } = await req.json();
    if (!workspace_id || !products?.length) throw new Error("workspace_id and products[] are required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const productSummaries = products.slice(0, 30).map((p: any, i: number) => ({
      index: i,
      id: p.id || null,
      title: p.title || p.original_title || "",
      sku: p.sku || "",
      brand: p.brand || "",
      attributes: p.attributes || {},
      technical_specs: p.technical_specs || "",
      category: p.category || "",
    }));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        taskType: "variation_detection",
        workspaceId: workspace_id,
        systemPrompt: `You are a Variation Detection Agent for a HORECA product catalog.

Your task: analyze a list of products and determine if they belong to the same family and should be grouped as variations of a single parent product.

Products ARE variations if they share the same base model and differ ONLY in:
- Size / dimensions
- Power (watts, HP)
- Color
- Capacity (liters, kg)
- Voltage (110V, 220V, 380V)
- Length / width / height

Products are NOT variations if they:
- Are fundamentally different products
- Have different base models or brands
- Differ in function or purpose

If they are a variation family:
- Suggest a parent product title (the generic family name without specific variant attributes)
- List the attributes that vary between them
- Map each product to its variation values

Respond with valid JSON only, no markdown:
{
  "is_variation_family": boolean,
  "parent_product_title": "string or null",
  "variation_attributes": ["attribute_name", ...],
  "children_products": [
    {
      "index": number,
      "product_id": "string or null",
      "sku": "string",
      "title": "string",
      "variation_values": { "attribute": "value" }
    }
  ],
  "confidence_score": 0.0-1.0,
  "reasoning": "string"
}

If NOT a variation family, return is_variation_family=false with empty children and null parent title.`,
        messages: [{
          role: "user",
          content: `Analyze these ${productSummaries.length} products:\n${JSON.stringify(productSummaries, null, 2)}`,
        }],
        options: {
          temperature: 0.15,
          max_tokens: 2048,
        },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI route error: ${aiResponse.status} - ${errText}`);
    }

    const aiWrapper = await aiResponse.json();
    const aiData = aiWrapper.result || aiWrapper;
    const content = (aiData.choices?.[0]?.message?.content || "")
      .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = {
        is_variation_family: false,
        parent_product_title: null,
        variation_attributes: [],
        children_products: [],
        confidence_score: 0,
        reasoning: "Failed to parse AI response: " + content.substring(0, 200),
      };
    }

    // Record agent run
    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "variation_detection",
      status: "completed",
      input_payload: { product_count: products.length, first_title: productSummaries[0]?.title },
      output_payload: result,
      confidence_score: result.confidence_score,
      cost_estimate: aiData.usage ? (aiData.usage.prompt_tokens + aiData.usage.completion_tokens) * 0.000001 : null,
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
