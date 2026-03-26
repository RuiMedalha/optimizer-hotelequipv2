import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product, language } = await req.json();
    if (!workspace_id || !product) throw new Error("workspace_id and product are required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const lang = language || "pt";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const systemPrompt = `You are a Product Description Generator for a B2B HORECA e-commerce catalog.

Write in ${lang === "pt" ? "European Portuguese" : lang === "es" ? "Spanish" : lang === "fr" ? "French" : "English"}.

TONE & STYLE:
- Professional, clear, factual
- NO exaggerated marketing ("revolutionary", "incredible", "best ever")
- Highlight practical functionalities and operational benefits
- Avoid generic filler phrases
- Write for professional buyers (chefs, hotel managers, restaurant owners)

STRUCTURE for long_description (HTML allowed):
1. Brief introduction (what the product is and its primary purpose)
2. Key features (bullet list of practical characteristics)
3. Professional kitchen applications (how/where it's used in HORECA)
4. Relevant specifications inline

short_description: 1-2 sentences, max 160 chars, punchy and informative.

long_description: 150-400 words, well-structured with HTML tags (<p>, <ul>, <li>, <strong>).

seo_keywords: 5-10 relevant search terms a B2B buyer would use.

Respond with valid JSON only, no markdown fences:
{
  "short_description": "string",
  "long_description": "string (HTML)",
  "seo_keywords": ["string"],
  "confidence_score": 0.0-1.0
}`;

    const userPrompt = `Generate descriptions for this product:

Title: ${product.title || product.original_title || "N/A"}
Brand: ${product.brand || "N/A"}
Category: ${product.category || "N/A"}
Current Description: ${product.description || product.original_description || "N/A"}
Technical Specs: ${product.technical_specs || "N/A"}
Attributes: ${product.attributes ? JSON.stringify(product.attributes) : "N/A"}
Price: ${product.price || product.original_price || "N/A"}`;

    // Use centralized resolve-ai-route
    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        taskType: "description_generation",
        workspaceId: workspace_id,
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        options: { max_tokens: 2048 },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI Route error: ${aiResponse.status} - ${errText}`);
    }

    const routeData = await aiResponse.json();
    const content = (routeData.result?.choices?.[0]?.message?.content || "")
      .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = {
        short_description: "",
        long_description: "",
        seo_keywords: [],
        confidence_score: 0,
        error: "Failed to parse AI response",
      };
    }

    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "product_description_generator",
      status: "completed",
      input_payload: { title: product.title || product.original_title, language: lang },
      output_payload: result,
      confidence_score: result.confidence_score,
      cost_estimate: routeData.result?.usage ? (routeData.result.usage.prompt_tokens + routeData.result.usage.completion_tokens) * 0.000001 : null,
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
