import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Targeted re-optimization: only fixes what the audit flagged as broken.
 * Does NOT re-generate the entire product — preserves what's already good.
 * 
 * Body: { workspaceId, products: [{ productId, issues: string[] }], includeImages?: boolean }
 * issues are the code strings from the audit (e.g. "faq_details_tag", "wrong_colors", etc.)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { workspaceId, products, includeImages } = await req.json();
    if (!workspaceId || !products?.length) {
      return new Response(JSON.stringify({ error: "workspaceId and products[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const item of products) {
      const { productId, issues } = item;
      if (!productId || !issues?.length) continue;

      // Fetch current product
      const { data: product, error: fetchErr } = await sb
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();

      if (fetchErr || !product) {
        results.push({ productId, status: "error", error: "Product not found" });
        continue;
      }

      const updates: Record<string, any> = {};
      const fixedIssues: string[] = [];

      for (const issue of issues) {
        switch (issue) {
          case "faq_details_tag": {
            // Remove <details>/<summary> tags from description, keep content visible
            let desc = product.optimized_description || "";
            desc = desc.replace(/<details[^>]*>/gi, "");
            desc = desc.replace(/<\/details>/gi, "");
            desc = desc.replace(/<summary[^>]*>(.*?)<\/summary>/gi, '<h3 style="color:#00526d;font-size:1.1em;margin-top:1.2em;">$1</h3>');
            updates.optimized_description = desc;
            fixedIssues.push("faq_details_tag");
            break;
          }

          case "wrong_colors": {
            // Inject brand colors into headings that don't have them
            let desc = product.optimized_description || "";
            // Replace h3 without color with branded h3
            desc = desc.replace(/<h3(?!\s[^>]*color)(.*?)>/gi, '<h3 style="color:#00526d;font-size:1.1em;margin-top:1.2em;"$1>');
            // Also fix h2 headings
            desc = desc.replace(/<h2(?!\s[^>]*color)(.*?)>/gi, '<h2 style="color:#00526d;font-size:1.25em;margin-top:1.4em;"$1>');
            updates.optimized_description = desc;
            fixedIssues.push("wrong_colors");
            break;
          }

          case "short_description": {
            // Flag only — full re-generation needed, mark for optimize-batch
            fixedIssues.push("short_description_flagged");
            break;
          }

          case "no_description": {
            // Flag only — needs full optimization
            fixedIssues.push("no_description_flagged");
            break;
          }

          case "no_faq": {
            // Flag only — needs AI generation
            fixedIssues.push("no_faq_flagged");
            break;
          }

          case "no_meta_title": {
            // Auto-generate from optimized title
            if (product.optimized_title) {
              const title = product.optimized_title;
              updates.meta_title = title.length > 60 ? title.substring(0, 57) + "..." : title;
              fixedIssues.push("no_meta_title");
            }
            break;
          }

          case "no_meta_desc": {
            // Auto-generate from short description or description
            const source = product.optimized_short_description || product.optimized_description || "";
            if (source) {
              const plainText = source.replace(/<[^>]+>/g, "").trim();
              updates.meta_description = plainText.length > 160 ? plainText.substring(0, 157) + "..." : plainText;
              fixedIssues.push("no_meta_desc");
            }
            break;
          }

          case "no_slug": {
            // Auto-generate slug from title
            const title = product.optimized_title || product.original_title || product.sku || "";
            if (title) {
              updates.seo_slug = title
                .toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .substring(0, 80);
              fixedIssues.push("no_slug");
            }
            break;
          }

          case "no_short_desc": {
            // Flag only — needs AI
            fixedIssues.push("no_short_desc_flagged");
            break;
          }

          default:
            // Other issues (no_images, few_images, no_tags, no_keywords) — informational
            break;
        }
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        const { error: updateErr } = await sb
          .from("products")
          .update(updates)
          .eq("id", productId);

        if (updateErr) {
          results.push({ productId, status: "error", error: updateErr.message });
          continue;
        }
      }

      const autoFixed = fixedIssues.filter(f => !f.endsWith("_flagged"));
      const needsAI = fixedIssues.filter(f => f.endsWith("_flagged"));

      results.push({
        productId,
        sku: product.sku,
        title: product.optimized_title || product.original_title,
        status: "fixed",
        auto_fixed: autoFixed,
        needs_full_optimization: needsAI,
        updates_applied: Object.keys(updates),
      });
    }

    const autoFixedCount = results.filter(r => r.status === "fixed" && r.auto_fixed?.length > 0).length;
    const needsFullCount = results.filter(r => r.needs_full_optimization?.length > 0).length;

    // Save as agent run for tracking
    await sb.from("agent_runs").insert({
      workspace_id: workspaceId,
      agent_name: "audit_reoptimize",
      status: "completed",
      input_payload: { product_count: products.length, include_images: includeImages || false },
      output_payload: {
        results,
        summary: {
          total: products.length,
          auto_fixed: autoFixedCount,
          needs_full_optimization: needsFullCount,
          ready_to_republish: autoFixedCount,
        },
      },
      confidence_score: 0.9,
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total: products.length,
        auto_fixed: autoFixedCount,
        needs_full_optimization: needsFullCount,
        ready_to_republish: autoFixedCount,
      },
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("Audit reoptimize error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
