import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { workspaceId } = await req.json();
    if (!workspaceId) throw new Error("workspaceId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    console.log(`🧠 [extract-category-patterns] Starting extraction for workspace: ${workspaceId}`);

    // Fetch all categorized products
    const { data: products, error: fetchError } = await supabase
      .from("products")
      .select("id, title, category_id, attributes, technical_specs, brand, model")
      .eq("workspace_id", workspaceId)
      .not("category_id", "is", null);

    if (fetchError) throw fetchError;

    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ patterns: 0, message: "No categorized products found." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Group by category
    const byCategory = new Map<string, any[]>();
    for (const p of products) {
      if (!byCategory.has(p.category_id)) byCategory.set(p.category_id, []);
      byCategory.get(p.category_id)!.push(p);
    }

    const patterns: any[] = [];

    // Extract patterns per category
    for (const [categoryId, prods] of byCategory.entries()) {
      if (prods.length < 2) continue; // Need at least 2 samples to identify a pattern

      // Pattern 1: Common title keywords (frequency analysis)
      const titleWords = new Map<string, number>();
      for (const p of prods) {
        const cleanTitle = (p.title || "").toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ");
        
        const words = cleanTitle.split(" ").filter(w => w.length > 4); // Only words with >4 chars
        const uniqueWords = new Set(words); // Count per product
        uniqueWords.forEach(w => titleWords.set(w, (titleWords.get(w) || 0) + 1));
      }
      
      for (const [word, count] of titleWords.entries()) {
        if (count >= Math.max(2, prods.length * 0.5)) { // At least 50% of products in this category have this word
          patterns.push({
            workspace_id: workspaceId,
            category_id: categoryId,
            pattern_type: "title_keyword",
            pattern_key: "title",
            pattern_value: word,
            pattern_operator: "contains",
            sample_count: count,
            confidence: Number((count / prods.length).toFixed(2)),
            source: "auto_detected"
          });
        }
      }

      // Pattern 2: Common attribute values
      const attributeValues = new Map<string, Map<string, number>>();
      for (const p of prods) {
        if (!p.attributes) continue;
        const attrs = typeof p.attributes === "string" ? JSON.parse(p.attributes) : p.attributes;
        
        if (typeof attrs === "object" && attrs !== null) {
          for (const [key, value] of Object.entries(attrs)) {
            if (value === null || value === undefined) continue;
            if (!attributeValues.has(key)) attributeValues.set(key, new Map());
            const valStr = String(value).trim();
            if (valStr.length === 0) continue;
            
            attributeValues.get(key)!.set(valStr, (attributeValues.get(key)!.get(valStr) || 0) + 1);
          }
        }
      }

      for (const [attrKey, valueCounts] of attributeValues.entries()) {
        for (const [attrValue, count] of valueCounts.entries()) {
          if (count >= Math.max(2, prods.length * 0.4)) { // 40%+ matching
            patterns.push({
              workspace_id: workspaceId,
              category_id: categoryId,
              pattern_type: "attribute_value",
              pattern_key: attrKey,
              pattern_value: attrValue,
              pattern_operator: "=",
              sample_count: count,
              confidence: Number((count / prods.length).toFixed(2)),
              source: "auto_detected"
            });
          }
        }
      }

      // Pattern 3: Brand+Model combinations
      const brandModelCounts = new Map<string, number>();
      for (const p of prods) {
        if (p.brand) {
          const brand = String(p.brand).trim();
          const model = p.model ? String(p.model).trim() : "";
          const key = model ? `${brand}:${model}` : brand;
          brandModelCounts.set(key, (brandModelCounts.get(key) || 0) + 1);
        }
      }

      for (const [brandModel, count] of brandModelCounts.entries()) {
        if (count >= 2) {
          patterns.push({
            workspace_id: workspace_id,
            category_id: categoryId,
            pattern_type: "brand_model",
            pattern_key: "brand_model",
            pattern_value: brandModel,
            pattern_operator: "=",
            sample_count: count,
            confidence: Number((count / prods.length).toFixed(2)),
            source: "auto_detected"
          });
        }
      }
    }

    // Upsert patterns
    if (patterns.length > 0) {
      console.log(`✅ [extract-category-patterns] Upserting ${patterns.length} patterns...`);
      const { error: upsertError } = await supabase
        .from("category_learning_patterns")
        .upsert(patterns, {
          onConflict: "workspace_id,category_id,pattern_type,pattern_key,pattern_value"
        });
      if (upsertError) throw upsertError;
    }

    return new Response(JSON.stringify({ 
      success: true, 
      patterns: patterns.length,
      message: `Memorizados ${patterns.length} padrões de categorização.` 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error(`❌ [extract-category-patterns] Error:`, err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
