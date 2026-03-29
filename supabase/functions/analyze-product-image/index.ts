import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, image_url, product_context } = await req.json();
    if (!workspace_id || !image_url) throw new Error("workspace_id and image_url are required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const systemPrompt = `You are an Image Understanding Agent for a HORECA product catalog.

Analyze the product image and extract:
- detected_product_type: what kind of product
- color: dominant color(s)
- material: visible material
- style: product style
- visible_parts: list of identifiable components
- usage_context: where/how used in HORECA
- alt_text: SEO-optimized alt text in Portuguese (max 125 chars)

Respond with valid JSON only:
{
  "detected_product_type": "string",
  "color": "string",
  "material": "string",
  "style": "string",
  "visible_parts": ["string"],
  "usage_context": "string",
  "alt_text": "string",
  "confidence_score": 0.0-1.0
}`;

    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        taskType: "image_analysis",
        workspaceId: workspace_id,
        systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image_url } },
            { type: "text", text: product_context ? `Product context: ${JSON.stringify(product_context)}` : "Analyze this product image." },
          ],
        }],
        options: { max_tokens: 1024 },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`AI Route error: ${aiResponse.status} - ${errText}`);
    }

    const routeData = await aiResponse.json();
    const aiMeta = routeData.meta || {};
    const promptSource = aiMeta.promptSource || "unknown";
    console.log(`📋 [analyze-product-image] Prompt source: ${promptSource} | Provider: ${aiMeta.usedProvider || "?"} | Model: ${aiMeta.usedModel || "?"}`);
    const content = (routeData.result?.choices?.[0]?.message?.content || "")
      .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = { detected_product_type: "unknown", color: "unknown", material: "unknown", style: "unknown", visible_parts: [], usage_context: "unknown", alt_text: "", confidence_score: 0, error: "Failed to parse AI response" };
    }

    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "image_understanding",
      status: "completed",
      input_payload: { image_url },
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
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
