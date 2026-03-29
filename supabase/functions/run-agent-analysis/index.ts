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

    const { workspaceId, agentTypes, limit = 50 } = await req.json();
    if (!workspaceId) throw new Error("workspaceId is required");

    const typesToRun: string[] = agentTypes || ["seo_optimizer", "attribute_completeness_agent", "image_optimizer"];
    const results: Record<string, any> = {};

    // ──────────────────────────────────────────────
    // SEO OPTIMIZER: Find products with missing/poor SEO
    // ──────────────────────────────────────────────
    if (typesToRun.includes("seo_optimizer")) {
      const seoResults = { analyzed: 0, issues_found: 0, recommendations: [] as any[] };

      const { data: products } = await sb
        .from("products")
        .select("id, sku, original_title, optimized_title, meta_title, meta_description, seo_slug, focus_keyword, tags, category")
        .eq("workspace_id", workspaceId)
        .is("parent_product_id", null)
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (products?.length) {
        for (const product of products) {
          seoResults.analyzed++;
          const issues: string[] = [];

          const title = product.meta_title || "";
          const desc = product.meta_description || "";
          const slug = product.seo_slug || "";
          const keywords = product.focus_keyword || [];
          const tags = product.tags || [];

          if (!title || title.length < 20) issues.push("Meta título ausente ou curto (<20 chars)");
          if (title.length > 60) issues.push("Meta título muito longo (>60 chars)");
          if (!desc || desc.length < 50) issues.push("Meta descrição ausente ou curta (<50 chars)");
          if (desc.length > 160) issues.push("Meta descrição muito longa (>160 chars)");
          if (!slug) issues.push("SEO slug ausente");
          if (!keywords.length) issues.push("Sem focus keywords definidas");
          if (!tags.length) issues.push("Sem tags/etiquetas");

          if (issues.length > 0) {
            seoResults.issues_found++;
            const severity = issues.length >= 4 ? "high" : issues.length >= 2 ? "medium" : "low";
            seoResults.recommendations.push({
              product_id: product.id,
              sku: product.sku,
              title: product.optimized_title || product.original_title || product.sku,
              issues,
              severity,
              score: Math.round(((7 - issues.length) / 7) * 100),
            });
          }
        }
        // Sort by severity
        seoResults.recommendations.sort((a: any, b: any) => {
          const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
          return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
        });
      }

      results.seo_optimizer = seoResults;
    }

    // ──────────────────────────────────────────────
    // ATTRIBUTE COMPLETENESS: Check missing attributes
    // ──────────────────────────────────────────────
    if (typesToRun.includes("attribute_completeness_agent")) {
      const attrResults = { analyzed: 0, incomplete: 0, recommendations: [] as any[] };

      const requiredFields = [
        { key: "original_title", label: "Título" },
        { key: "brand", label: "Marca" },
        { key: "category", label: "Categoria" },
        { key: "sku", label: "SKU" },
        { key: "meta_title", label: "Meta Título" },
        { key: "meta_description", label: "Meta Descrição" },
      ];
      const importantAttributes = [
        "Material", "Dimensões", "Peso", "Potência", "Voltagem",
        "Capacidade", "Cor", "Garantia",
      ];

      const { data: products } = await sb
        .from("products")
        .select("id, sku, original_title, optimized_title, brand, category, meta_title, meta_description, attributes, image_urls, technical_specs")
        .eq("workspace_id", workspaceId)
        .is("parent_product_id", null)
        .order("updated_at", { ascending: true })
        .limit(limit);

      if (products?.length) {
        for (const product of products) {
          attrResults.analyzed++;
          const missing: string[] = [];
          let present = 0;
          const total = requiredFields.length + importantAttributes.length + 1; // +1 for images

          for (const field of requiredFields) {
            const val = (product as any)[field.key];
            if (val && String(val).trim().length > 0) {
              present++;
            } else {
              missing.push(field.label);
            }
          }

          const attrs = product.attributes || {};
          for (const attr of importantAttributes) {
            const val = (attrs as any)[attr] || (attrs as any)[attr.toLowerCase()];
            if (val && String(val).trim().length > 0) {
              present++;
            } else {
              missing.push(attr);
            }
          }

          const hasImages = product.image_urls && (product.image_urls as string[]).length > 0;
          if (hasImages) present++;
          else missing.push("Imagens");

          const score = Math.round((present / total) * 100);

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
              required_attributes: total,
            }).eq("id", existing[0].id);
          } else {
            await sb.from("attribute_completeness_scores").insert({
              workspace_id: workspaceId,
              product_id: product.id,
              completeness_score: score,
              present_attributes: present,
              required_attributes: total,
            });
          }

          if (missing.length > 0) {
            attrResults.incomplete++;
            const severity = score < 40 ? "high" : score < 70 ? "medium" : "low";
            attrResults.recommendations.push({
              product_id: product.id,
              sku: product.sku,
              title: product.optimized_title || product.original_title || product.sku,
              score,
              missing,
              severity,
            });
          }
        }
        attrResults.recommendations.sort((a: any, b: any) => a.score - b.score);
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
          const hasLifestyle = urls.some((u: string) => u.includes("lifestyle"));

          if (imageCount === 0) {
            imgResults.no_images++;
            imgResults.recommendations.push({
              product_id: product.id, sku: product.sku,
              title: product.optimized_title || product.original_title || product.sku,
              issue: "no_images", severity: "high", image_count: 0,
              suggestion: "Produto sem imagens — adicionar imagens do produto",
            });
          } else if (imageCount < 3) {
            imgResults.few_images++;
            imgResults.recommendations.push({
              product_id: product.id, sku: product.sku,
              title: product.optimized_title || product.original_title || product.sku,
              issue: "few_images", severity: "medium", image_count: imageCount,
              suggestion: `Apenas ${imageCount} imagem(ns) — recomendado 3+`,
            });
          }

          if (imageCount > 0 && !hasLifestyle) {
            imgResults.needs_lifestyle++;
            imgResults.recommendations.push({
              product_id: product.id, sku: product.sku,
              title: product.optimized_title || product.original_title || product.sku,
              issue: "no_lifestyle", severity: "medium", image_count: imageCount,
              suggestion: "Sem imagem lifestyle — gerar imagem contextual HORECA",
            });
          }
        }
      }

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
