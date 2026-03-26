import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product_ids } = await req.json();
    if (!workspace_id) throw new Error("workspace_id is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch products to analyze
    let query = supabase
      .from("products")
      .select("id, sku, original_title, optimized_title, category, category_id, tags, attributes, original_price, optimized_price, product_type, parent_product_id")
      .eq("workspace_id", workspace_id);

    if (product_ids?.length) {
      query = query.in("id", product_ids);
    } else {
      query = query.limit(300);
    }

    const { data: products, error: pErr } = await query;
    if (pErr) throw pErr;
    if (!products?.length) {
      return new Response(JSON.stringify({ bundles: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build product summaries for AI analysis
    const productSummaries = products.map((p) => ({
      id: p.id,
      sku: p.sku,
      title: p.optimized_title || p.original_title || "",
      category: p.category || "",
      tags: p.tags || [],
      attributes: p.attributes || {},
      price: Number(p.optimized_price || p.original_price || 0),
      product_type: p.product_type,
    }));

    // AI calls go through resolve-ai-route (no LOVABLE_API_KEY dependency)

    const systemPrompt = `You are a HORECA product bundling expert. Analyze the provided products and detect potential bundles.

Bundle types to detect:
1. Equipment + Accessories (e.g., coffee machine + filters + cleaning kit)
2. Replacement Kits (e.g., set of replacement blades, filter packs)
3. Utensil Sets (e.g., knife set, cooking utensil collection)
4. Complementary Products (e.g., plates + cutlery + napkins)
5. Starter Kits (e.g., cleaning supplies bundle for kitchen)

Rules:
- Each bundle must have 2-5 products
- Products in a bundle should be logically related (same category, complementary use, or common workflow)
- Generate a descriptive Portuguese bundle title
- Assign confidence based on how strong the relationship is
- Do NOT bundle products that are variations of the same item

Return a JSON array of detected bundles.`;

    const userPrompt = `Analyze these ${productSummaries.length} products and detect bundles:\n${JSON.stringify(productSummaries, null, 1)}`;

    const tools = [{
      type: "function",
      function: {
        name: "report_bundles",
        description: "Report detected product bundles",
        parameters: {
          type: "object",
          properties: {
            bundles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  bundle_detected: { type: "boolean" },
                  bundle_products: { type: "array", items: { type: "object", properties: { product_id: { type: "string" }, sku: { type: "string" }, role: { type: "string", enum: ["primary", "accessory", "complementary", "replacement"] } }, required: ["product_id", "role"] } },
                  bundle_title: { type: "string" },
                  bundle_type: { type: "string", enum: ["equipment_accessories", "replacement_kit", "utensil_set", "complementary", "starter_kit"] },
                  confidence_score: { type: "number" },
                  reason: { type: "string" },
                },
                required: ["bundle_detected", "bundle_products", "bundle_title", "confidence_score"],
              },
            },
          },
          required: ["bundles"],
          additionalProperties: false,
        },
      },
    }];

    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        taskType: "bundle_detection",
        workspaceId: workspace_id,
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        options: { tools, tool_choice: { type: "function", function: { name: "report_bundles" } } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error ${status}: ${errText}`);
    }

    const routeData = await aiResponse.json();
    const toolCall = routeData.result?.choices?.[0]?.message?.tool_calls?.[0];
    let bundles: any[] = [];

    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      bundles = (parsed.bundles || []).filter((b: any) => b.bundle_detected && b.bundle_products?.length >= 2);
    }

    // Store detected bundles in bundle_suggestions table
    for (const bundle of bundles) {
      const primaryProduct = bundle.bundle_products.find((p: any) => p.role === "primary") || bundle.bundle_products[0];
      const suggestedIds = bundle.bundle_products.map((p: any) => p.product_id);

      await supabase.from("bundle_suggestions").insert({
        workspace_id,
        primary_product_id: primaryProduct.product_id,
        suggested_products: suggestedIds,
        bundle_type: bundle.bundle_type || "complementary",
        bundle_reason: bundle.bundle_title + (bundle.reason ? ` — ${bundle.reason}` : ""),
        confidence: Math.round((bundle.confidence_score || 0.5) * 100),
      });
    }

    // Log agent run
    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "bundle_detection",
      status: "completed",
      input_payload: { product_count: products.length, product_ids: product_ids || null },
      output_payload: { bundles_detected: bundles.length, bundles },
      confidence_score: bundles.length > 0 ? bundles.reduce((s: number, b: any) => s + (b.confidence_score || 0), 0) / bundles.length : 0,
      completed_at: new Date().toISOString(),
    });

    const result = bundles.map((b) => ({
      bundle_detected: true,
      bundle_products: b.bundle_products,
      bundle_title: b.bundle_title,
      bundle_type: b.bundle_type,
      confidence_score: b.confidence_score,
    }));

    return new Response(JSON.stringify({ bundles: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
