import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product, supplier_price, target_margin } = await req.json();
    if (!workspace_id || !product) throw new Error("workspace_id and product are required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const cost = supplier_price || product.supplier_price || product.original_price || 0;
    const currentPrice = product.optimized_price || product.original_price || 0;
    const salePrice = product.optimized_sale_price || product.sale_price;
    const margin = target_margin || 35; // default 35%

    // Fetch price history for this SKU
    let priceHistory: any[] = [];
    if (product.id) {
      const { data } = await supabase
        .from("product_versions")
        .select("field_name, old_value, new_value, created_at")
        .eq("product_id", product.id)
        .in("field_name", ["original_price", "optimized_price", "sale_price"])
        .order("created_at", { ascending: false })
        .limit(20);
      priceHistory = data || [];
    }

    // Fetch similar products in same category for benchmarking
    let categoryPrices: number[] = [];
    if (product.category_id || product.category) {
      const query = supabase
        .from("products")
        .select("original_price, optimized_price")
        .eq("workspace_id", workspace_id)
        .not("original_price", "is", null)
        .limit(50);

      if (product.category_id) query.eq("category_id", product.category_id);
      else if (product.category) query.eq("category", product.category);

      const { data } = await query;
      categoryPrices = (data || [])
        .map((p: any) => Number(p.optimized_price || p.original_price))
        .filter((p: number) => p > 0);
    }

    // Calculate metrics
    const recommendedPrice = cost > 0 ? Math.round(cost / (1 - margin / 100) * 100) / 100 : currentPrice;
    const actualMargin = cost > 0 && currentPrice > 0 ? Math.round((1 - cost / currentPrice) * 10000) / 100 : 0;
    const categoryAvg = categoryPrices.length > 0 ? Math.round(categoryPrices.reduce((a, b) => a + b, 0) / categoryPrices.length * 100) / 100 : null;
    const categoryMin = categoryPrices.length > 0 ? Math.min(...categoryPrices) : null;
    const categoryMax = categoryPrices.length > 0 ? Math.max(...categoryPrices) : null;

    // Discount strategy
    let discountStrategy = "none";
    let suggestedSalePrice = null;
    if (currentPrice > 0 && categoryAvg && currentPrice > categoryAvg * 1.2) {
      discountStrategy = "competitive_discount";
      suggestedSalePrice = Math.round(categoryAvg * 1.05 * 100) / 100;
    } else if (actualMargin > 50) {
      discountStrategy = "margin_based_discount";
      suggestedSalePrice = Math.round(cost / (1 - 0.35) * 100) / 100;
    } else if (salePrice && salePrice < cost) {
      discountStrategy = "loss_alert";
    }

    // Confidence based on data availability
    let confidence = 0.5;
    if (cost > 0) confidence += 0.2;
    if (categoryPrices.length > 5) confidence += 0.15;
    if (priceHistory.length > 0) confidence += 0.1;
    confidence = Math.min(confidence, 1);

    const result = {
      supplier_price: cost,
      current_price: currentPrice,
      recommended_price: recommendedPrice,
      suggested_sale_price: suggestedSalePrice,
      margin_percent: actualMargin,
      target_margin: margin,
      discount_strategy: discountStrategy,
      category_benchmark: { avg: categoryAvg, min: categoryMin, max: categoryMax, sample_size: categoryPrices.length },
      price_history_entries: priceHistory.length,
      confidence_score: Math.round(confidence * 100) / 100,
    };

    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "price_intelligence",
      status: "completed",
      input_payload: { sku: product.sku, supplier_price: cost, category: product.category },
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
