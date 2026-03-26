import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, search_queries, marketplace_data, google_ads_data } = await req.json();
    if (!workspace_id) throw new Error("workspace_id is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch existing catalog products
    const { data: products } = await supabase
      .from("products")
      .select("id, sku, original_title, optimized_title, category, tags, original_price, optimized_price, status")
      .eq("workspace_id", workspace_id)
      .limit(500);

    // Fetch existing demand signals
    const { data: demandSignals } = await supabase
      .from("demand_signals")
      .select("*")
      .eq("workspace_id", workspace_id)
      .order("created_at", { ascending: false })
      .limit(100);

    // Fetch demand sources config
    const { data: demandSources } = await supabase
      .from("demand_sources")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("is_active", true);

    // Build catalog summary for AI
    const catalogSummary = {
      total_products: products?.length || 0,
      categories: [...new Set((products || []).map(p => p.category).filter(Boolean))],
      product_titles: (products || []).slice(0, 100).map(p => p.optimized_title || p.original_title || p.sku),
      price_range: {
        min: Math.min(...(products || []).map(p => Number(p.optimized_price || p.original_price || 0)).filter(v => v > 0), Infinity),
        max: Math.max(...(products || []).map(p => Number(p.optimized_price || p.original_price || 0)).filter(v => v > 0), 0),
      },
    };

    // Compile all demand input signals
    const demandInputs = {
      internal_searches: search_queries || [],
      marketplace_data: marketplace_data || [],
      google_ads_data: google_ads_data || [],
      existing_signals: (demandSignals || []).slice(0, 30).map(s => ({
        signal_type: s.signal_type,
        payload: s.signal_payload,
        strength: s.signal_strength,
      })),
      configured_sources: (demandSources || []).map(s => s.source_type),
    };

    const systemPrompt = `You are a HORECA catalog demand intelligence analyst. Your job is to identify:
1. HIGH DEMAND PRODUCTS: Products already in the catalog that show strong demand signals
2. MISSING CATALOG OPPORTUNITIES: Products or categories NOT in the catalog but showing high demand

Analyze the catalog and demand signals to find opportunities.

Rules:
- Focus on HORECA industry (hospitality, restaurants, catering, hotels)
- Identify gaps between what's being searched and what's available
- Consider seasonal trends for HORECA (summer terraces, winter equipment, etc.)
- Rate confidence based on signal strength and data quality
- Provide actionable Portuguese descriptions
- If no external data provided, analyze the catalog structure for gaps and suggest based on industry knowledge`;

    const userPrompt = `Catalog Summary:\n${JSON.stringify(catalogSummary, null, 1)}\n\nDemand Signals:\n${JSON.stringify(demandInputs, null, 1)}\n\nAnalyze and identify high-demand products and missing catalog opportunities.`;

    const demandTools = [{
      type: "function",
      function: {
        name: "report_demand_intelligence",
        description: "Report demand intelligence analysis results",
        parameters: {
          type: "object",
          properties: {
            high_demand_products: { type: "array", items: { type: "object", properties: { product_title: { type: "string" }, category: { type: "string" }, demand_signal: { type: "string", enum: ["search_volume", "marketplace_trend", "seasonal", "competitor_gap", "internal_search"] }, estimated_demand_level: { type: "string", enum: ["very_high", "high", "medium"] }, reasoning: { type: "string" }, suggested_action: { type: "string" } }, required: ["product_title", "category", "demand_signal", "estimated_demand_level", "reasoning"], additionalProperties: false } },
            missing_catalog_opportunities: { type: "array", items: { type: "object", properties: { opportunity_title: { type: "string" }, category: { type: "string" }, opportunity_type: { type: "string", enum: ["new_product", "new_category", "product_variant", "bundle", "seasonal_item"] }, estimated_demand_level: { type: "string", enum: ["very_high", "high", "medium"] }, reasoning: { type: "string" }, suggested_price_range: { type: "string" }, priority: { type: "string", enum: ["critical", "high", "medium", "low"] } }, required: ["opportunity_title", "category", "opportunity_type", "estimated_demand_level", "reasoning", "priority"], additionalProperties: false } },
            confidence_score: { type: "number" },
            analysis_summary: { type: "string" },
          },
          required: ["high_demand_products", "missing_catalog_opportunities", "confidence_score", "analysis_summary"],
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
        options: { tools: demandTools, tool_choice: { type: "function", function: { name: "report_demand_intelligence" } } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error ${status}: ${errText}`);
    }

    const routeData = await aiResponse.json();
    const toolCall = routeData.result?.choices?.[0]?.message?.tool_calls?.[0];
    let result = { high_demand_products: [] as any[], missing_catalog_opportunities: [] as any[], confidence_score: 0, analysis_summary: "" };

    if (toolCall?.function?.arguments) {
      result = JSON.parse(toolCall.function.arguments);
    }

    // Store demand signals for high-demand products
    for (const hdp of result.high_demand_products) {
      await supabase.from("demand_signals").insert({
        workspace_id,
        signal_type: hdp.demand_signal === "search_volume" ? "search_trend" : hdp.demand_signal === "marketplace_trend" ? "marketplace_trend" : "catalog_gap",
        signal_payload: { product_title: hdp.product_title, category: hdp.category, demand_level: hdp.estimated_demand_level, reasoning: hdp.reasoning },
        signal_strength: hdp.estimated_demand_level === "very_high" ? 95 : hdp.estimated_demand_level === "high" ? 75 : 55,
      });
    }

    // Store missing opportunities as catalog_gap signals
    for (const opp of result.missing_catalog_opportunities) {
      await supabase.from("demand_signals").insert({
        workspace_id,
        signal_type: "catalog_gap",
        signal_payload: { opportunity_title: opp.opportunity_title, category: opp.category, type: opp.opportunity_type, reasoning: opp.reasoning, price_range: opp.suggested_price_range, priority: opp.priority },
        signal_strength: opp.priority === "critical" ? 95 : opp.priority === "high" ? 80 : opp.priority === "medium" ? 60 : 40,
      });
    }

    // Log agent run
    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "demand_intelligence",
      status: "completed",
      input_payload: { product_count: products?.length || 0, signals_count: demandSignals?.length || 0, external_inputs: { search_queries: search_queries?.length || 0, marketplace: marketplace_data?.length || 0, google_ads: google_ads_data?.length || 0 } },
      output_payload: result,
      confidence_score: result.confidence_score,
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
