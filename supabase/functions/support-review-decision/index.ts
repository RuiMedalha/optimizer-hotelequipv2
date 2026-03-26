import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, review_item } = await req.json();
    if (!workspace_id || !review_item) throw new Error("workspace_id and review_item are required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Gather context: product, conflict, previous agent runs
    let productData = null;
    if (review_item.product_id) {
      const { data } = await supabase
        .from("products")
        .select("id, sku, original_title, optimized_title, original_description, optimized_description, category, attributes, image_urls, original_price, optimized_price, supplier_ref, source_file")
        .eq("id", review_item.product_id)
        .single();
      productData = data;
    }

    let conflictData = null;
    if (review_item.conflict_id) {
      const { data } = await supabase
        .from("conflict_cases")
        .select("*")
        .eq("id", review_item.conflict_id)
        .single();
      conflictData = data;
    }

    // Recent agent runs for this product
    let recentRuns: any[] = [];
    if (review_item.product_id) {
      const { data } = await supabase
        .from("agent_runs")
        .select("agent_name, output_payload, confidence_score, created_at")
        .eq("workspace_id", workspace_id)
        .contains("input_payload", { product_id: review_item.product_id })
        .order("created_at", { ascending: false })
        .limit(5);
      recentRuns = data || [];
    }

    const systemPrompt = `You are a Review Support Agent for a HORECA catalog management system.

Help human reviewers make quick, informed decisions about product data conflicts and quality issues.

Analyze the review item context and provide:
- recommended_action: one of "approve", "reject", "edit_and_approve", "escalate", "merge"
- confidence_score: 0.0-1.0
- explanation: concise reasoning in Portuguese (2-3 sentences)
- risk_level: "low", "medium", "high"
- suggested_edits: specific field changes if action is "edit_and_approve" (object or null)
- key_differences: list of important differences found (if conflict)

Respond with valid JSON only:
{
  "recommended_action": "string",
  "confidence_score": 0.0-1.0,
  "explanation": "string",
  "risk_level": "low|medium|high",
  "suggested_edits": {} | null,
  "key_differences": ["string"]
}`;

    const userPrompt = `Review this item:

Reason: ${review_item.reason || "unknown"}
Priority: ${review_item.priority || "normal"}

Product data:
${productData ? JSON.stringify(productData, null, 2) : "No product data available"}

Conflict data:
${conflictData ? JSON.stringify(conflictData, null, 2) : "No conflict"}

Supplier data:
${review_item.supplier_data ? JSON.stringify(review_item.supplier_data, null, 2) : "N/A"}

Recent AI recommendations:
${recentRuns.length ? JSON.stringify(recentRuns, null, 2) : "None"}

Additional context:
${review_item.notes || "None"}`;

    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        taskType: "product_validation",
        workspaceId: workspace_id,
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        options: { max_tokens: 1024 },
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
      result = { recommended_action: "escalate", confidence_score: 0, explanation: "Não foi possível analisar automaticamente.", risk_level: "high", suggested_edits: null, key_differences: [] };
    }

    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "review_support",
      status: "completed",
      input_payload: { product_id: review_item.product_id, reason: review_item.reason },
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
