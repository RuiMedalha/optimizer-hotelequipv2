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
    const sb = createClient(supabaseUrl, serviceKey);

    const { workspaceId, agentTypes, limit = 20 } = await req.json();
    if (!workspaceId) throw new Error("workspaceId is required");

    const typesToRun: string[] = agentTypes || ["seo_optimizer", "attribute_completeness_agent", "image_optimizer"];
    const results: Record<string, any> = {};

    // ──────────────────────────────────────────────
    // SEO OPTIMIZER: Find products with missing/poor SEO
    // ──────────────────────────────────────────────
    if (typesToRun.includes("seo_optimizer")) {
      const seoResults = { analyzed: 0, issues_found: 0, recommendations_created: 0 };

      // Get products that don't have recent SEO recommendations
      const { data: products } = await sb
        .from("products")
        .select("id, original_title, optimized_title, meta_title, meta_description, brand, category, optimized_description, original_description, attributes")
        .eq("workspace_id", workspaceId)
        .is("parent_product_id", null) // Only parent products
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (products?.length) {
        for (const product of products) {
          seoResults.analyzed++;

          // Check if SEO is missing or poor
          const hasTitle = !!(product.meta_title && product.meta_title.length >= 20);
          const hasDescription = !!(product.meta_description && product.meta_description.length >= 50);

          if (hasTitle && hasDescription) continue; // Already has good SEO

          // Check if we already have a recent recommendation (last 7 days)
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const { data: existing } = await sb
            .from("seo_recommendations")
            .select("id")
            .eq("product_id", product.id)
            .eq("workspace_id", workspaceId)
            .gte("created_at", sevenDaysAgo)
            .limit(1);

          if (existing?.length) continue; // Already has recent recommendation

          seoResults.issues_found++;

          // Call SEO optimizer
          try {
            const seoResp = await fetch(`${supabaseUrl}/functions/v1/optimize-product-seo`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
              body: JSON.stringify({ workspace_id: workspaceId, product, language: "pt" }),
            });

            if (seoResp.ok) {
              const seoData = await seoResp.json();
              if (seoData.meta_title) {
                await sb.from("seo_recommendations").insert({
                  workspace_id: workspaceId,
                  product_id: product.id,
                  recommended_title: seoData.meta_title,
                  recommended_meta_description: seoData.meta_description,
                  recommended_keywords: seoData.seo_keywords || [],
                  confidence: seoData.confidence_score || 0.7,
                  locale: "pt",
                });
                seoResults.recommendations_created++;
              }
            }
          } catch (e) {
            console.error(`SEO analysis failed for product ${product.id}:`, e);
          }
        }
      }

      results.seo_optimizer = seoResults;
    }

    // ──────────────────────────────────────────────
    // ATTRIBUTE COMPLETENESS: Check missing attributes
    // ──────────────────────────────────────────────
    if (typesToRun.includes("attribute_completeness_agent")) {
      const attrResults = { analyzed: 0, incomplete: 0, scores_updated: 0 };

      // Required fields for HORECA products
      const requiredFields = [
        "original_title", "brand", "category", "sku",
        "meta_title", "meta_description",
      ];
      const importantAttributes = [
        "Material", "Dimensões", "Peso", "Potência", "Voltagem",
        "Capacidade", "Cor", "Garantia",
      ];
      const totalRequired = requiredFields.length + importantAttributes.length;

      const { data: products } = await sb
        .from("products")
        .select("id, original_title, optimized_title, brand, category, sku, meta_title, meta_description, attributes, image_urls")
        .eq("workspace_id", workspaceId)
        .is("parent_product_id", null)
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (products?.length) {
        for (const product of products) {
          attrResults.analyzed++;

          let present = 0;

          // Check base fields
          for (const field of requiredFields) {
            const val = (product as any)[field];
            if (val && String(val).trim().length > 0) present++;
          }

          // Check important attributes
          const attrs = product.attributes || {};
          for (const attr of importantAttributes) {
            const val = (attrs as any)[attr] || (attrs as any)[attr.toLowerCase()];
            if (val && String(val).trim().length > 0) present++;
          }

          // Check images
          const hasImages = product.image_urls && (product.image_urls as string[]).length > 0;
          if (hasImages) present++;

          const score = Math.round((present / (totalRequired + 1)) * 100); // +1 for images

          if (score < 100) attrResults.incomplete++;

          // Upsert score
          const { data: existing } = await sb
            .from("attribute_completeness_scores")
            .select("id")
            .eq("product_id", product.id)
            .eq("workspace_id", workspaceId)
            .limit(1);

          if (existing?.length) {
            await sb.from("attribute_completeness_scores").update({
              completeness_score: score,
              present_attributes: present,
              required_attributes: totalRequired + 1,
            }).eq("id", existing[0].id);
          } else {
            await sb.from("attribute_completeness_scores").insert({
              workspace_id: workspaceId,
              product_id: product.id,
              completeness_score: score,
              present_attributes: present,
              required_attributes: totalRequired + 1,
            });
          }
          attrResults.scores_updated++;
        }
      }

      results.attribute_completeness_agent = attrResults;
    }

    // ──────────────────────────────────────────────
    // IMAGE OPTIMIZER: Analyze image quality & needs
    // ──────────────────────────────────────────────
    if (typesToRun.includes("image_optimizer")) {
      const imgResults = { analyzed: 0, no_images: 0, few_images: 0, needs_lifestyle: 0, recommendations: [] as any[] };

      const { data: products } = await sb
        .from("products")
        .select("id, original_title, optimized_title, sku, image_urls, product_type, category, parent_product_id")
        .eq("workspace_id", workspaceId)
        .is("parent_product_id", null)
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (products?.length) {
        for (const product of products) {
          imgResults.analyzed++;

          const urls = (product.image_urls || []) as string[];
          const imageCount = urls.length;

          // Check for lifestyle images (contains 'lifestyle' in path)
          const hasLifestyle = urls.some((u: string) => u.includes("lifestyle"));

          if (imageCount === 0) {
            imgResults.no_images++;
            imgResults.recommendations.push({
              product_id: product.id,
              title: product.original_title || product.sku,
              issue: "no_images",
              severity: "high",
              suggestion: "Produto sem imagens — adicionar imagens do produto",
            });
          } else if (imageCount < 3) {
            imgResults.few_images++;
            imgResults.recommendations.push({
              product_id: product.id,
              title: product.original_title || product.sku,
              issue: "few_images",
              severity: "medium",
              suggestion: `Apenas ${imageCount} imagem(ns) — recomendado 3+ para melhor conversão`,
            });
          }

          if (imageCount > 0 && !hasLifestyle) {
            imgResults.needs_lifestyle++;
            imgResults.recommendations.push({
              product_id: product.id,
              title: product.original_title || product.sku,
              issue: "no_lifestyle",
              severity: "medium",
              suggestion: "Sem imagem lifestyle — gerar imagem contextual HORECA",
            });
          }
        }
      }

      // Save analysis as an agent run
      await sb.from("agent_runs").insert({
        workspace_id: workspaceId,
        agent_name: "image_optimizer",
        status: "completed",
        input_payload: { products_analyzed: imgResults.analyzed },
        output_payload: imgResults,
        confidence_score: 0.85,
        completed_at: new Date().toISOString(),
      });

      results.image_optimizer = imgResults;
    }

    // Record the overall analysis run
    await sb.from("agent_runs").insert({
      workspace_id: workspaceId,
      agent_name: "agent_analysis_cycle",
      status: "completed",
      input_payload: { agent_types: typesToRun, limit },
      output_payload: results,
      confidence_score: 0.9,
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("Agent analysis error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
