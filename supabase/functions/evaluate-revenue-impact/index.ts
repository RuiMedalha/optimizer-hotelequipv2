import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Gather all revenue-related data in parallel
    const [productsRes, bundlesRes, pricingRes, promosRes, demandRes, insightsRes] = await Promise.all([
      supabase.from("products").select("id, sku, original_title, optimized_title, category, category_id, tags, original_price, optimized_price, sale_price, optimized_sale_price, product_type, upsell_skus, crosssell_skus, status").eq("workspace_id", workspace_id).limit(300),
      supabase.from("bundle_recommendations").select("*").eq("workspace_id", workspace_id).order("expected_revenue", { ascending: false }).limit(20),
      supabase.from("pricing_recommendations").select("*").eq("workspace_id", workspace_id).limit(20),
      supabase.from("promotion_candidates").select("*").eq("workspace_id", workspace_id).limit(20),
      supabase.from("demand_signals").select("signal_type, signal_payload, signal_strength").eq("workspace_id", workspace_id).order("created_at", { ascending: false }).limit(30),
      supabase.from("product_insights").select("product_id, insight_type, insight_payload, priority").eq("workspace_id", workspace_id).eq("status", "open").in("insight_type", ["upsell_opportunity", "cross_sell_opportunity", "bundle_opportunity"]).limit(30),
    ]);

    const products = productsRes.data || [];
    if (!products.length) {
      return new Response(JSON.stringify({ revenue_opportunities: [], estimated_impact: 0, priority_score: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build context for AI
    const context = {
      catalog: {
        total: products.length,
        categories: [...new Set(products.map(p => p.category).filter(Boolean))],
        avg_price: Math.round(products.filter(p => Number(p.optimized_price || p.original_price || 0) > 0).reduce((s, p) => s + Number(p.optimized_price || p.original_price), 0) / Math.max(products.filter(p => Number(p.optimized_price || p.original_price || 0) > 0).length, 1) * 100) / 100,
        products_without_crosssell: products.filter(p => !p.crosssell_skus || (Array.isArray(p.crosssell_skus) && p.crosssell_skus.length === 0)).length,
        products_without_upsell: products.filter(p => !p.upsell_skus || (Array.isArray(p.upsell_skus) && p.upsell_skus.length === 0)).length,
        products_on_sale: products.filter(p => p.sale_price || p.optimized_sale_price).length,
        top_products: products.slice(0, 50).map(p => ({ id: p.id, sku: p.sku, title: (p.optimized_title || p.original_title || "").substring(0, 60), category: p.category, price: Number(p.optimized_price || p.original_price || 0), has_crosssell: !!(p.crosssell_skus && (Array.isArray(p.crosssell_skus) ? p.crosssell_skus.length > 0 : true)), has_upsell: !!(p.upsell_skus && (Array.isArray(p.upsell_skus) ? p.upsell_skus.length > 0 : true)) })),
      },
      existing_bundles: (bundlesRes.data || []).length,
      pricing_recs: (pricingRes.data || []).slice(0, 5).map((p: any) => ({ product_id: p.product_id, current: p.current_price, recommended: p.recommended_price })),
      promotions: (promosRes.data || []).length,
      demand_signals: (demandRes.data || []).slice(0, 15).map((s: any) => ({ type: s.signal_type, strength: s.signal_strength, payload: s.signal_payload })),
      open_opportunities: (insightsRes.data || []).length,
    };

    const revenueTools = [{
      type: "function",
      function: {
        name: "report_revenue_opportunities",
        description: "Report revenue optimization opportunities",
        parameters: {
          type: "object",
          properties: {
            revenue_opportunities: { type: "array", items: { type: "object", properties: { opportunity_type: { type: "string", enum: ["bundle", "cross_sell", "upsell", "price_optimization", "campaign", "strategic_category", "seasonal_promotion"] }, title: { type: "string" }, description: { type: "string" }, estimated_revenue_impact: { type: "number" }, confidence: { type: "number" }, priority: { type: "string", enum: ["critical", "high", "medium", "low"] }, affected_products: { type: "array", items: { type: "string" } }, suggested_action: { type: "string" } }, required: ["opportunity_type", "title", "description", "estimated_revenue_impact", "confidence", "priority", "suggested_action"], additionalProperties: false } },
            estimated_impact: { type: "number" },
            priority_score: { type: "number" },
            analysis_summary: { type: "string" },
          },
          required: ["revenue_opportunities", "estimated_impact", "priority_score", "analysis_summary"],
          additionalProperties: false,
        },
      },
    }];

    const systemPrompt = `You are a revenue optimization expert for HORECA e-commerce catalogs. Analyze the catalog data and identify concrete revenue opportunities across 5 dimensions: bundles, cross-sell/upsell, pricing, campaigns, and strategic categories.

Rules:
- Each opportunity must have a clear estimated revenue impact in EUR
- Prioritize by impact × confidence
- Provide Portuguese descriptions
- Be specific with product references when possible
- Consider HORECA seasonality and industry patterns`;

    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        taskType: "price_optimization",
        workspaceId: workspace_id,
        systemPrompt,
        messages: [{ role: "user", content: `Analyze this catalog for revenue opportunities:\n${JSON.stringify(context, null, 1)}` }],
        options: { tools: revenueTools, tool_choice: { type: "function", function: { name: "report_revenue_opportunities" } } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error ${status}: ${errText}`);
    }

    const routeData = await aiResponse.json();
    const toolCall = routeData.result?.choices?.[0]?.message?.tool_calls?.[0];
    let result = { revenue_opportunities: [] as any[], estimated_impact: 0, priority_score: 0, analysis_summary: "" };

    if (toolCall?.function?.arguments) {
      result = JSON.parse(toolCall.function.arguments);
    }

    // Store revenue actions from opportunities
    const actions: any[] = [];
    for (const opp of result.revenue_opportunities) {
      const actionType = opp.opportunity_type === "bundle" ? "create_bundle"
        : opp.opportunity_type === "cross_sell" || opp.opportunity_type === "upsell" ? "add_cross_sell"
        : opp.opportunity_type === "price_optimization" ? "adjust_price"
        : opp.opportunity_type === "campaign" || opp.opportunity_type === "seasonal_promotion" ? "launch_promotion"
        : "optimize_listing";

      actions.push({
        workspace_id,
        action_type: actionType,
        action_payload: { title: opp.title, description: opp.description, affected_products: opp.affected_products, suggested_action: opp.suggested_action },
        expected_revenue: opp.estimated_revenue_impact,
        status: "pending",
      });
    }

    if (actions.length > 0) {
      await supabase.from("revenue_actions").insert(actions.slice(0, 50));
    }

    // Feed brain observations
    if (result.revenue_opportunities.length > 0) {
      const brainObs = result.revenue_opportunities.slice(0, 10).map((opp: any) => ({
        workspace_id,
        observation_type: "revenue_signal" as const,
        signal_source: "revenue_optimization_agent",
        signal_strength: Math.round(opp.confidence * 100),
        signal_payload: { type: opp.opportunity_type, title: opp.title, impact: opp.estimated_revenue_impact },
        processed: false,
      }));
      await supabase.from("catalog_brain_observations").insert(brainObs).catch(() => {});
    }

    // Log agent run
    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "revenue_optimization",
      status: "completed",
      input_payload: { product_count: products.length, bundles: (bundlesRes.data || []).length, pricing_recs: (pricingRes.data || []).length, demand_signals: (demandRes.data || []).length },
      output_payload: result,
      confidence_score: result.revenue_opportunities.length > 0 ? result.revenue_opportunities.reduce((s: number, o: any) => s + (o.confidence || 0), 0) / result.revenue_opportunities.length : 0,
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
