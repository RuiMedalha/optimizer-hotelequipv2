import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const { workspace_id, product_id } = await req.json();
    if (!workspace_id || !product_id) throw new Error("workspace_id and product_id required");

    const { data: product, error } = await supabase.from("products").select("*").eq("id", product_id).single();
    if (error) throw error;

    const insights: any[] = [];
    const title = product.optimized_title || product.original_title || "";
    const desc = product.optimized_description || product.original_description || "";

    // Basic structural analysis
    if (!product.meta_title) insights.push({ workspace_id, product_id, insight_type: "seo_improvement", confidence: 95, priority: 85, insight_payload: { field: "meta_title", reason: "Sem meta título" } });
    if (!product.meta_description) insights.push({ workspace_id, product_id, insight_type: "seo_improvement", confidence: 90, priority: 80, insight_payload: { field: "meta_description", reason: "Sem meta description" } });
    if (!product.tags?.length) insights.push({ workspace_id, product_id, insight_type: "keyword_opportunity", confidence: 80, priority: 60, insight_payload: { reason: "Sem tags/keywords" } });
    if (!product.image_urls?.length) insights.push({ workspace_id, product_id, insight_type: "image_quality_issue", confidence: 95, priority: 95, insight_payload: { reason: "Sem imagens" } });

    // AI-powered deep analysis
    if (title) {
      try {
        const insightTools = [{
          type: "function",
          function: {
            name: "product_insights",
            description: "Return product improvement insights",
            parameters: {
              type: "object",
              properties: {
                insights: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["title_optimization", "description_improvement", "missing_attribute", "category_mismatch", "price_anomaly", "keyword_opportunity"] }, reason: { type: "string" }, suggestion: { type: "string" }, confidence: { type: "number" }, priority: { type: "number" } }, required: ["type", "reason", "suggestion", "confidence", "priority"], additionalProperties: false } }
              },
              required: ["insights"],
              additionalProperties: false
            }
          }
        }];

        const aiResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            taskType: "product_validation",
            workspaceId: workspace_id,
            systemPrompt: "You are a product catalog optimization expert for HORECA/hospitality. Analyze the product and return improvement suggestions.",
            messages: [{ role: "user", content: `Product: ${title}\nSKU: ${product.sku}\nCategory: ${product.category || "N/A"}\nDescription: ${desc.substring(0, 500)}\nPrice: ${product.optimized_price || product.original_price || "N/A"}\nAttributes: ${JSON.stringify(product.attributes || {}).substring(0, 300)}\n\nAnalyze and suggest improvements.` }],
            options: { tools: insightTools, tool_choice: { type: "function", function: { name: "product_insights" } } },
          }),
        });

        if (aiResp.ok) {
          const routeData = await aiResp.json();
          const toolCall = routeData.result?.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const parsed = JSON.parse(toolCall.function.arguments);
            for (const i of parsed.insights || []) {
              insights.push({
                workspace_id, product_id,
                insight_type: i.type,
                confidence: i.confidence,
                priority: i.priority,
                insight_payload: { reason: i.reason, suggestion: i.suggestion },
              });
            }
          }
        } else {
          const status = aiResp.status;
          const text = await aiResp.text();
          if (status === 429) console.error("Rate limited");
          else if (status === 402) console.error("Payment required");
          else console.error("AI error:", status, text);
        }
      } catch (aiErr) {
        console.error("AI analysis error:", aiErr);
      }
    }

    // Clear old open insights for this product and insert new
    if (insights.length > 0) {
      await supabase.from("product_insights").delete().eq("product_id", product_id).eq("status", "open");
      await supabase.from("product_insights").insert(insights);
    }

    return new Response(JSON.stringify({ insights_generated: insights.length, insights }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const status = (err as Error).message?.includes("Rate limit") ? 429 : (err as Error).message?.includes("Payment") ? 402 : 400;
    return new Response(JSON.stringify({ error: (err as Error).message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
