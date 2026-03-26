import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product, channel } = await req.json();
    if (!workspace_id || !product || !channel) throw new Error("workspace_id, product and channel are required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: channelConfig } = await supabase
      .from("channels")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("channel_type", channel)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const systemPrompt = `You are a Channel Transformation Agent. Transform a canonical product into a channel-specific payload.

TARGET CHANNEL: ${channel}

CHANNEL CONSTRAINTS:
${channel === "woocommerce" ? `- title: max 200 chars\n- short_description: max 400 chars, HTML allowed\n- description: HTML allowed\n- categories: hierarchical, slash-separated\n- attributes: name/value pairs\n- images: array of URLs\n- price: numeric\n- sku: required, unique` : ""}
${channel === "shopify" ? `- title: max 255 chars\n- body_html: HTML description\n- vendor: brand name\n- product_type: single category\n- tags: comma-separated\n- variants: array with price, sku\n- images: array of { src }` : ""}
${channel === "marketplace" ? `- title: max 150 chars\n- description: plain text, max 2000 chars\n- bullet_points: max 5 items\n- brand: required\n- ean/gtin: required` : ""}
${channel === "xml_feed" ? `- title: max 150 chars\n- description: plain text\n- price: with currency\n- availability: in stock / out of stock\n- brand: required` : ""}
${channel === "csv_export" ? `- All fields flat key-value\n- No HTML\n- Pipe-separated multi-value` : ""}

${channelConfig ? `Channel config: ${JSON.stringify(channelConfig.channel_config || {})}` : ""}

Respond with valid JSON only:
{
  "channel": "${channel}",
  "payload_fields": { ... },
  "validation_status": "valid" | "warning" | "invalid",
  "validation_warnings": ["string"],
  "transformations_applied": ["string"]
}`;

    const userPrompt = `Transform this product for ${channel}:
${JSON.stringify({
  title: product.optimized_title || product.original_title,
  description: product.optimized_description || product.original_description,
  short_description: product.optimized_short_description || product.short_description,
  sku: product.sku,
  price: product.optimized_price || product.original_price,
  sale_price: product.optimized_sale_price || product.sale_price,
  category: product.category,
  brand: product.brand,
  attributes: product.attributes,
  tags: product.tags,
  image_urls: product.image_urls,
  meta_title: product.meta_title,
  meta_description: product.meta_description,
  seo_slug: product.seo_slug,
}, null, 2)}`;

    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
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
      result = { channel, payload_fields: {}, validation_status: "invalid", validation_warnings: ["Failed to parse AI response"], transformations_applied: [] };
    }

    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "channel_transformation",
      status: "completed",
      input_payload: { sku: product.sku, channel },
      output_payload: result,
      confidence_score: result.validation_status === "valid" ? 0.95 : result.validation_status === "warning" ? 0.7 : 0.3,
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
