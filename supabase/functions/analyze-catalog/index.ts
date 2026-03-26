import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // AI calls go through resolve-ai-route (no LOVABLE_API_KEY dependency)
    const { workspace_id, limit = 500 } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    // Load products
    const { data: products } = await supabase.from("products").select("id, sku, original_title, optimized_title, optimized_description, optimized_short_description, meta_title, meta_description, seo_slug, category, category_id, attributes, tags, image_urls, optimized_price, original_price, sale_price, product_type, parent_product_id, seo_score, upsell_skus, crosssell_skus").eq("workspace_id", workspace_id).limit(limit);

    if (!products?.length) {
      return new Response(JSON.stringify({ issues_found: [], recommendations: [], priority_score: 0, summary: { total_products: 0 } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load schemas & rejections in parallel
    const [schemasRes, rejectionsRes] = await Promise.all([
      supabase.from("category_schemas").select("*").eq("workspace_id", workspace_id).eq("is_active", true),
      supabase.from("channel_rejections").select("product_id, rejection_type, field_impacted").eq("workspace_id", workspace_id).eq("resolved", false),
    ]);
    const schemas = schemasRes.data || [];
    const rejections = rejectionsRes.data || [];

    const rejectionMap: Record<string, any[]> = {};
    for (const r of rejections) {
      if (!rejectionMap[r.product_id]) rejectionMap[r.product_id] = [];
      rejectionMap[r.product_id].push(r);
    }

    const issues_found: any[] = [];
    const recommendations: any[] = [];
    const completenessScores: any[] = [];
    const insightsToStore: any[] = [];

    // ── 1. DUPLICATES (SKU + title) ──
    const skuMap = new Map<string, any[]>();
    const titleMap = new Map<string, any[]>();
    for (const p of products) {
      if (p.sku) {
        const key = p.sku.trim().toLowerCase();
        if (!skuMap.has(key)) skuMap.set(key, []);
        skuMap.get(key)!.push(p);
      }
      const title = (p.optimized_title || p.original_title || "").trim().toLowerCase();
      if (title.length > 5) {
        if (!titleMap.has(title)) titleMap.set(title, []);
        titleMap.get(title)!.push(p);
      }
    }
    for (const [sku, dupes] of skuMap) {
      if (dupes.length > 1) {
        issues_found.push({ type: "duplicate_sku", severity: "high", product_ids: dupes.map((d: any) => d.id), detail: `SKU "${sku}" duplicado em ${dupes.length} produtos` });
      }
    }
    for (const [title, dupes] of titleMap) {
      if (dupes.length > 1) {
        const skus = new Set(dupes.map((d: any) => d.sku?.trim().toLowerCase()));
        if (skus.size > 1) {
          issues_found.push({ type: "duplicate_title", severity: "medium", product_ids: dupes.map((d: any) => d.id), detail: `Título "${title.substring(0, 60)}…" repetido com SKUs diferentes` });
        }
      }
    }

    // ── 2. INCOMPLETE DATA ──
    const requiredFields = ["optimized_title", "optimized_description", "meta_title", "meta_description", "seo_slug", "image_urls", "category"];
    for (const p of products) {
      const title = p.optimized_title || p.original_title || "";
      const desc = p.optimized_description || "";
      const missing: string[] = [];
      for (const f of requiredFields) {
        const val = (p as any)[f];
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) missing.push(f);
      }
      if (missing.length >= 2) {
        issues_found.push({ type: "incomplete_data", severity: missing.length >= 5 ? "high" : "medium", product_ids: [p.id], detail: `"${(title || p.sku || "?").substring(0, 50)}" — campos em falta: ${missing.join(", ")}`, missing_fields: missing });
      }

      // SEO sub-issues → stored as insights
      if (!p.meta_title || p.meta_title.length < 10) insightsToStore.push({ workspace_id, product_id: p.id, insight_type: "seo_improvement", confidence: 90, priority: 80, insight_payload: { field: "meta_title", reason: "Meta título ausente ou muito curto" } });
      if (!p.meta_description || p.meta_description.length < 50) insightsToStore.push({ workspace_id, product_id: p.id, insight_type: "seo_improvement", confidence: 85, priority: 70, insight_payload: { field: "meta_description", reason: "Meta description ausente ou curta" } });
      if (!p.seo_slug) insightsToStore.push({ workspace_id, product_id: p.id, insight_type: "seo_improvement", confidence: 95, priority: 90, insight_payload: { field: "seo_slug", reason: "Slug SEO ausente" } });
      if (!p.image_urls || p.image_urls.length === 0) insightsToStore.push({ workspace_id, product_id: p.id, insight_type: "image_quality_issue", confidence: 95, priority: 90, insight_payload: { reason: "Produto sem imagens" } });

      // Schema-based attribute completeness
      const attrs = typeof p.attributes === "object" && p.attributes ? p.attributes : {};
      const schema = schemas.find((s: any) => s.category_id === p.category_id) || schemas.find((s: any) => !s.category_id);
      if (schema) {
        const required = schema.required_fields || [];
        const present = required.filter((f: string) => {
          if (f === "title") return !!title;
          if (f === "description") return !!desc;
          if (f === "price") return !!(p.optimized_price || p.original_price);
          if (f === "images") return p.image_urls?.length > 0;
          return !!(attrs as any)[f];
        });
        const schemaMissing = required.filter((f: string) => !present.includes(f));
        for (const m of schemaMissing) {
          insightsToStore.push({ workspace_id, product_id: p.id, insight_type: "missing_attribute", confidence: 95, priority: 85, insight_payload: { attribute: m, schema: schema.name } });
        }
        completenessScores.push({ workspace_id, product_id: p.id, category_id: p.category_id, required_attributes: required.length, present_attributes: present.length, completeness_score: required.length > 0 ? Math.round((present.length / required.length) * 100) : 100 });
      }

      // Channel rejection risk
      if (rejectionMap[p.id]?.length) {
        issues_found.push({ type: "channel_rejection_risk", severity: "high", product_ids: [p.id], detail: `"${(title || p.sku || "").substring(0, 40)}" tem ${rejectionMap[p.id].length} rejeições de canal não resolvidas` });
      }
    }

    // ── 3. CATEGORY ISSUES ──
    const catCounts = new Map<string, number>();
    let uncategorized = 0;
    for (const p of products) {
      const cat = p.category || "";
      if (!cat) { uncategorized++; continue; }
      catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
    }
    if (uncategorized > 0) {
      issues_found.push({ type: "missing_category", severity: uncategorized > 10 ? "high" : "medium", detail: `${uncategorized} produtos sem categoria atribuída` });
    }
    for (const [cat, count] of catCounts) {
      if (count === 1 && catCounts.size > 3) {
        issues_found.push({ type: "orphan_category", severity: "low", detail: `Categoria "${cat}" tem apenas 1 produto — possível erro de categorização` });
      }
    }

    // ── 4. ATTRIBUTE INCONSISTENCY ──
    const catAttributes = new Map<string, Map<string, number>>();
    for (const p of products) {
      const cat = p.category || "uncategorized";
      if (!catAttributes.has(cat)) catAttributes.set(cat, new Map());
      const attrMap = catAttributes.get(cat)!;
      if (p.attributes && typeof p.attributes === "object") {
        for (const key of Object.keys(p.attributes as Record<string, unknown>)) {
          attrMap.set(key, (attrMap.get(key) || 0) + 1);
        }
      }
    }
    for (const [cat, attrMap] of catAttributes) {
      const total = catCounts.get(cat) || 1;
      if (total < 3) continue;
      for (const [attr, count] of attrMap) {
        const ratio = count / total;
        if (ratio > 0.3 && ratio < 0.8) {
          issues_found.push({ type: "inconsistent_attribute", severity: "low", detail: `Atributo "${attr}" presente em apenas ${Math.round(ratio * 100)}% dos produtos na categoria "${cat}"` });
        }
      }
    }

    // ── 5. BUNDLE OPPORTUNITIES ──
    const categoryProducts = new Map<string, any[]>();
    for (const p of products) {
      if (!p.category || p.product_type === "variation") continue;
      if (!categoryProducts.has(p.category)) categoryProducts.set(p.category, []);
      categoryProducts.get(p.category)!.push(p);
    }
    const bundleSuggestions: any[] = [];
    for (const [cat, prods] of categoryProducts) {
      if (prods.length >= 3) {
        const prices = prods.map((p: any) => Number(p.optimized_price || p.original_price || 0)).filter((v: number) => v > 0);
        const hasAccessories = prods.some((p: any) => {
          const t = ((p.optimized_title || p.original_title) || "").toLowerCase();
          return t.includes("acessório") || t.includes("kit") || t.includes("conjunto") || t.includes("reposição") || t.includes("replacement") || t.includes("pack");
        });
        if (hasAccessories || prods.length >= 4) {
          const avg = prices.length > 0 ? Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length * 100) / 100 : 0;
          recommendations.push({ type: "bundle_opportunity", category: cat, product_count: prods.length, avg_price: avg, detail: `Categoria "${cat}" tem ${prods.length} produtos com potencial de bundle` });
          bundleSuggestions.push({ workspace_id, bundle_type: "starter_kit", primary_product_id: prods[0].id, suggested_products: prods.slice(1, 5).map((p: any) => p.id), bundle_reason: `${prods.length} produtos na categoria "${cat}" podem formar kit`, confidence: hasAccessories ? 75 : 60 });
        }
      }
    }

    // ── 6. PRICE ANOMALIES ──
    for (const [cat, prods] of categoryProducts) {
      const prices = prods.map((p: any) => ({ id: p.id, title: (p.optimized_title || p.original_title || "").substring(0, 40), price: Number(p.optimized_price || p.original_price || 0) })).filter((p: any) => p.price > 0);
      if (prices.length < 3) continue;
      const avg = prices.reduce((s: number, p: any) => s + p.price, 0) / prices.length;
      for (const p of prices) {
        if (p.price > avg * 3 || p.price < avg * 0.2) {
          issues_found.push({ type: "price_anomaly", severity: "medium", product_ids: [p.id], detail: `"${p.title}" preço €${p.price} anómalo vs média da categoria "${cat}" (€${Math.round(avg)})` });
        }
      }
    }

    // ── PRIORITY SCORE ──
    const highCount = issues_found.filter((i) => i.severity === "high").length;
    const medCount = issues_found.filter((i) => i.severity === "medium").length;
    const lowCount = issues_found.filter((i) => i.severity === "low").length;
    const priority_score = Math.min(100, highCount * 20 + medCount * 5 + lowCount * 1 + recommendations.length * 3);

    // General recommendations
    if (highCount > 0) recommendations.push({ type: "action", detail: `Resolver ${highCount} problemas de severidade alta em primeiro lugar` });
    const incompleteCount = issues_found.filter((i) => i.type === "incomplete_data").length;
    if (incompleteCount > 5) recommendations.push({ type: "enrichment", detail: `${incompleteCount} produtos precisam de enriquecimento — considere executar o agente de enriquecimento em batch` });
    const dupCount = issues_found.filter((i) => i.type === "duplicate_sku").length;
    if (dupCount > 0) recommendations.push({ type: "deduplication", detail: `${dupCount} SKUs duplicados detetados — revisar e consolidar` });

    // ── PERSIST ──
    // Insights
    if (insightsToStore.length > 0) {
      await supabase.from("product_insights").delete().eq("workspace_id", workspace_id).eq("status", "open");
      for (let i = 0; i < insightsToStore.length; i += 50) {
        await supabase.from("product_insights").insert(insightsToStore.slice(i, i + 50));
      }
    }
    // Completeness scores
    if (completenessScores.length > 0) {
      await supabase.from("attribute_completeness_scores").delete().eq("workspace_id", workspace_id);
      for (let i = 0; i < completenessScores.length; i += 50) {
        await supabase.from("attribute_completeness_scores").insert(completenessScores.slice(i, i + 50));
      }
    }
    // Bundle suggestions
    if (bundleSuggestions.length > 0) {
      await supabase.from("bundle_suggestions").delete().eq("workspace_id", workspace_id).eq("accepted", false);
      await supabase.from("bundle_suggestions").insert(bundleSuggestions);
    }

    // AI SEO for low-score products
    const topProducts = products.filter(p => (p.seo_score || 0) < 60 && p.optimized_title).slice(0, 5);
    if (topProducts.length > 0) {
      const productSummaries = topProducts.map(p => `SKU: ${p.sku}, Title: ${p.optimized_title || p.original_title}, Category: ${p.category || "N/A"}, Meta: ${p.meta_title || "N/A"}`).join("\n");
      try {
        const seoResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/resolve-ai-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            taskType: "seo_optimization",
            workspaceId: workspace_id,
            systemPrompt: "You are an SEO expert for HORECA e-commerce catalogs. Return structured recommendations.",
            messages: [{ role: "user", content: `Analyze these products and suggest SEO improvements:\n${productSummaries}` }],
            options: {
              tools: [{ type: "function", function: { name: "seo_recommendations", description: "Return SEO recommendations", parameters: { type: "object", properties: { recommendations: { type: "array", items: { type: "object", properties: { sku: { type: "string" }, recommended_title: { type: "string" }, recommended_meta_description: { type: "string" }, recommended_keywords: { type: "array", items: { type: "string" } }, confidence: { type: "number" } }, required: ["sku", "recommended_title", "recommended_meta_description", "recommended_keywords", "confidence"], additionalProperties: false } } }, required: ["recommendations"], additionalProperties: false } } }],
              tool_choice: { type: "function", function: { name: "seo_recommendations" } },
            },
          }),
        });
        if (seoResp.ok) {
          const routeData = await seoResp.json();
          const toolCall = routeData.result?.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const parsed = JSON.parse(toolCall.function.arguments);
            for (const rec of parsed.recommendations || []) {
              const product = topProducts.find(p => p.sku === rec.sku);
              if (product) {
                await supabase.from("seo_recommendations").insert({ workspace_id, product_id: product.id, locale: "pt-PT", recommended_title: rec.recommended_title, recommended_meta_description: rec.recommended_meta_description, recommended_keywords: rec.recommended_keywords, confidence: rec.confidence || 70 });
                recommendations.push({ type: "seo_ai", product_id: product.id, detail: `SEO otimizado sugerido para "${(product.optimized_title || product.sku || "").substring(0, 40)}"` });
              }
            }
          }
        }
      } catch (aiErr) {
        console.error("AI SEO error:", aiErr);
      }
    }

    // Log agent run
    const result = {
      issues_found,
      recommendations,
      priority_score,
      summary: { total_products: products.length, issues_total: issues_found.length, high: highCount, medium: medCount, low: lowCount, recommendations_count: recommendations.length, insights_stored: insightsToStore.length, completeness_scored: completenessScores.length, bundles_suggested: bundleSuggestions.length },
    };

    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "catalog_intelligence",
      status: "completed",
      input_payload: { product_count: products.length },
      output_payload: result,
      confidence_score: Math.min(0.95, 0.5 + (products.length > 50 ? 0.3 : products.length * 0.006)),
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
