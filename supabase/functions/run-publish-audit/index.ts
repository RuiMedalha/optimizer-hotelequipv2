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

    const { workspaceId, limit = 100 } = await req.json();
    if (!workspaceId) throw new Error("workspaceId is required");

    // Get all published products (with woocommerce_id)
    const { data: products, error } = await sb
      .from("products")
      .select("id, sku, original_title, optimized_title, optimized_description, optimized_short_description, meta_title, meta_description, seo_slug, focus_keyword, tags, faq, image_urls, attributes, woocommerce_id, updated_at")
      .eq("workspace_id", workspaceId)
      .not("woocommerce_id", "is", null)
      .is("parent_product_id", null)
      .order("updated_at", { ascending: true })
      .limit(limit);

    if (error) throw error;

    const recommendations: any[] = [];

    for (const p of products || []) {
      const issues: { code: string; label: string; severity: string }[] = [];

      // ─── Check optimized description quality ───
      const desc = p.optimized_description || "";
      
      // FAQ check: should NOT have <details>/<summary> tags (they break in WC)
      if (desc.includes("<details") || desc.includes("<summary")) {
        issues.push({ code: "faq_details_tag", label: "FAQ com tags <details> (não visíveis no WC)", severity: "high" });
      }

      // FAQ present check: should have FAQ section
      const hasFaqSection = desc.includes("Perguntas Frequentes") || desc.includes("product-faq");
      const hasFaqData = p.faq && (Array.isArray(p.faq) ? p.faq.length > 0 : Object.keys(p.faq).length > 0);
      if (!hasFaqSection && !hasFaqData) {
        issues.push({ code: "no_faq", label: "Sem secção de FAQ", severity: "medium" });
      }

      // Color check: should use brand colors (#00526d for headings)
      if (desc.length > 100 && !desc.includes("#00526d") && !desc.includes("00526d")) {
        issues.push({ code: "wrong_colors", label: "Não usa cores da marca (#00526d)", severity: "medium" });
      }

      // Description too short
      if (desc.length < 500 && desc.length > 0) {
        issues.push({ code: "short_description", label: "Descrição muito curta (<500 chars)", severity: "medium" });
      }

      // Missing optimized description entirely
      if (!desc || desc.length < 50) {
        issues.push({ code: "no_description", label: "Sem descrição otimizada", severity: "high" });
      }

      // ─── Short description check ───
      if (!p.optimized_short_description || p.optimized_short_description.length < 30) {
        issues.push({ code: "no_short_desc", label: "Sem descrição curta otimizada", severity: "medium" });
      }

      // ─── SEO checks ───
      if (!p.meta_title || p.meta_title.length < 20) {
        issues.push({ code: "no_meta_title", label: "Meta título ausente/curto", severity: "high" });
      }
      if (!p.meta_description || p.meta_description.length < 50) {
        issues.push({ code: "no_meta_desc", label: "Meta descrição ausente/curta", severity: "high" });
      }
      if (!p.seo_slug) {
        issues.push({ code: "no_slug", label: "Sem SEO slug", severity: "medium" });
      }
      if (!p.focus_keyword || p.focus_keyword.length === 0) {
        issues.push({ code: "no_keywords", label: "Sem focus keywords", severity: "low" });
      }

      // ─── Tags check ───
      if (!p.tags || p.tags.length === 0) {
        issues.push({ code: "no_tags", label: "Sem tags", severity: "low" });
      }

      // ─── Image checks ───
      const imgs = (p.image_urls || []) as string[];
      if (imgs.length === 0) {
        issues.push({ code: "no_images", label: "Sem imagens", severity: "high" });
      } else if (imgs.length < 3) {
        issues.push({ code: "few_images", label: `Apenas ${imgs.length} imagem(ns)`, severity: "low" });
      }

      // Only report products with issues
      if (issues.length > 0) {
        const highCount = issues.filter(i => i.severity === "high").length;
        const overallSeverity = highCount >= 2 ? "critical" : highCount >= 1 ? "high" : "medium";
        
        recommendations.push({
          product_id: p.id,
          sku: p.sku,
          woocommerce_id: p.woocommerce_id,
          title: p.optimized_title || p.original_title || p.sku,
          issues,
          issue_count: issues.length,
          severity: overallSeverity,
          needs_reoptimize: issues.some(i => ["no_description", "faq_details_tag", "wrong_colors", "short_description", "no_faq"].includes(i.code)),
          needs_seo: issues.some(i => ["no_meta_title", "no_meta_desc", "no_slug", "no_keywords"].includes(i.code)),
          needs_images: issues.some(i => ["no_images", "few_images"].includes(i.code)),
          last_updated: p.updated_at,
        });
      }
    }

    // Sort by severity then issue count
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || b.issue_count - a.issue_count);

    const summary = {
      total_published: (products || []).length,
      total_with_issues: recommendations.length,
      ok_count: (products || []).length - recommendations.length,
      critical_count: recommendations.filter(r => r.severity === "critical").length,
      high_count: recommendations.filter(r => r.severity === "high").length,
      medium_count: recommendations.filter(r => r.severity === "medium").length,
      needs_reoptimize: recommendations.filter(r => r.needs_reoptimize).length,
      needs_seo: recommendations.filter(r => r.needs_seo).length,
      needs_images: recommendations.filter(r => r.needs_images).length,
    };

    // Save as agent run
    await sb.from("agent_runs").insert({
      workspace_id: workspaceId,
      agent_name: "publish_audit_agent",
      status: "completed",
      input_payload: { total_published: summary.total_published, limit },
      output_payload: { summary, recommendations },
      confidence_score: 0.95,
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true, summary, recommendations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("Publish audit error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
