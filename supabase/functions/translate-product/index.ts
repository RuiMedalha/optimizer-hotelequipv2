import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { product_id, workspace_id, source_locale, target_locale, user_id, job_id, job_item_id } = await req.json();

    // 1. Fetch product
    const { data: product, error: pErr } = await supabase.from("products").select("*").eq("id", product_id).single();
    if (pErr || !product) throw new Error("Product not found");

    // 2. Fetch terminology dictionary (mandatory replacements)
    const { data: terms } = await supabase
      .from("terminology_dictionaries")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("source_locale", source_locale)
      .eq("target_locale", target_locale);

    // 3. Fetch translation memories
    const { data: memories } = await supabase
      .from("translation_memories")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("source_locale", source_locale)
      .eq("target_locale", target_locale)
      .order("confidence_score", { ascending: false })
      .limit(200);

    // 4. Fetch style guide
    const { data: styleGuides } = await supabase
      .from("locale_style_guides")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("locale", target_locale)
      .limit(1);
    const styleGuide = styleGuides?.[0] || null;

    // 5. Fetch category info
    let categoryName = product.category || "";
    if (product.category_id) {
      const { data: cat } = await supabase.from("categories").select("name").eq("id", product.category_id).single();
      if (cat) categoryName = cat.name;
    }

    // 6. Build terminology map
    const termMap: Record<string, string> = {};
    const mandatoryTerms: Record<string, string> = {};
    (terms || []).forEach((t: any) => {
      termMap[t.source_term.toLowerCase()] = t.target_term;
      if (t.is_mandatory) mandatoryTerms[t.source_term.toLowerCase()] = t.target_term;
    });

    // 7. Check translation memory for exact matches per field
    const memoryMap: Record<string, string> = {};
    const fieldsToTranslate = [
      { key: "title", source: product.optimized_title || product.original_title || "" },
      { key: "short_description", source: product.optimized_short_description || product.short_description || "" },
      { key: "description", source: product.optimized_description || product.original_description || "" },
      { key: "meta_title", source: product.meta_title || "" },
      { key: "meta_description", source: product.meta_description || "" },
      { key: "slug", source: product.seo_slug || "" },
    ];

    const fieldsNeedingAI: typeof fieldsToTranslate = [];

    for (const field of fieldsToTranslate) {
      if (!field.source) continue;
      const match = (memories || []).find((m: any) =>
        m.source_text === field.source && m.field_type === field.key && m.confidence_score >= 85
      );
      if (match) {
        memoryMap[field.key] = match.translated_text;
      } else {
        fieldsNeedingAI.push(field);
      }
    }

    // 8. Build AI prompt for remaining fields
    let aiResults: Record<string, string> = {};
    const fieldsTranslated: string[] = Object.keys(memoryMap);

    if (fieldsNeedingAI.length > 0) {
      const styleInstructions = styleGuide
        ? `\nStyle Guide:\n- Tone: ${styleGuide.tone || "professional"}\n- Forbidden terms: ${(styleGuide.forbidden_terms || []).join(", ")}\n- Preferred patterns: ${(styleGuide.preferred_patterns || []).join(", ")}\n- CTA patterns: ${(styleGuide.cta_patterns || []).join(", ")}`
        : "";

      const terminologyBlock = Object.entries(mandatoryTerms).length > 0
        ? `\nMandatory terminology (MUST use these exact translations):\n${Object.entries(mandatoryTerms).map(([s, t]) => `"${s}" → "${t}"`).join("\n")}`
        : "";

      const categoryTone = getCategoryTone(categoryName);

      const systemPrompt = `You are an expert product content localizer for e-commerce.
You translate product content from ${source_locale} to ${target_locale}.
This is NOT literal translation — it's intelligent localization.

Category: ${categoryName}
Category tone: ${categoryTone}
${terminologyBlock}
${styleInstructions}

Rules:
- Preserve technical accuracy (dimensions, specs, model numbers)
- Adapt tone to category and target market
- SEO-optimize for target locale
- Keep HTML structure if present
- Slugs must be URL-safe, lowercase, hyphenated
- Tags should be localized individually
- Return ONLY a JSON object with the field keys and translated values`;

      const userPrompt = `Translate these product fields:\n${JSON.stringify(
        Object.fromEntries(fieldsNeedingAI.map(f => [f.key, f.source]))
      )}

Also translate these if present:
- tags: ${JSON.stringify(product.tags || [])}
- faq: ${JSON.stringify(product.faq || [])}`;

      const aiResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          taskType: "content_translation",
          workspaceId: workspace_id,
          systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!aiResp.ok) {
        const status = aiResp.status;
        const errText = await aiResp.text();
        throw new Error(`AI error ${status}: ${errText}`);
      }

      const routeData = await aiResp.json();
      const content = routeData.result?.choices?.[0]?.message?.content || "";
      
      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          aiResults = JSON.parse(jsonMatch[0]);
        } catch {
          aiResults = {};
        }
      }

      // Apply mandatory terminology post-processing
      for (const [key, value] of Object.entries(aiResults)) {
        if (typeof value === "string") {
          let processed = value;
          for (const [src, tgt] of Object.entries(mandatoryTerms)) {
            processed = processed.replace(new RegExp(src, "gi"), tgt);
          }
          aiResults[key] = processed;
          fieldsTranslated.push(key);
        }
      }
    }

    // 9. Merge results
    const merged = { ...memoryMap, ...aiResults };

    // 10. Calculate quality score
    const totalFields = fieldsToTranslate.filter(f => f.source).length + (product.tags?.length ? 1 : 0);
    const translatedCount = fieldsTranslated.length + (merged.tags ? 1 : 0);
    const memoryBoost = Object.keys(memoryMap).length * 5;
    const qualityScore = Math.min(100, Math.round((translatedCount / Math.max(totalFields, 1)) * 80 + memoryBoost));
    const needsReview = qualityScore < 75;

    // 11. Upsert localization
    const locData: any = {
      product_id,
      workspace_id,
      locale: target_locale,
      status: needsReview ? "needs_review" : "translated",
      translated_title: merged.title || null,
      translated_short_description: merged.short_description || null,
      translated_description: merged.description || null,
      translated_meta_title: merged.meta_title || null,
      translated_meta_description: merged.meta_description || null,
      translated_slug: merged.slug || null,
      translated_tags: Array.isArray(merged.tags) ? merged.tags : null,
      translated_faq: merged.faq || null,
      translated_image_alt_texts: merged.image_alt_texts || null,
      quality_score: qualityScore,
      needs_review: needsReview,
      source_language: source_locale,
    };

    await supabase.from("product_localizations").upsert(locData, { onConflict: "product_id,locale" });

    // 12. Save new translations to memory
    for (const field of fieldsNeedingAI) {
      if (merged[field.key] && field.source) {
        await supabase.from("translation_memories").insert({
          workspace_id,
          source_locale,
          target_locale,
          source_text: field.source,
          translated_text: merged[field.key],
          field_type: field.key,
          category_id: product.category_id || null,
          confidence_score: 60, // AI-generated starts at 60
        });
      }
    }

    // 13. Update job item if provided
    if (job_item_id) {
      await supabase.from("translation_job_items").update({
        status: "completed",
        fields_translated: fieldsTranslated,
        confidence_score: qualityScore,
        completed_at: new Date().toISOString(),
      }).eq("id", job_item_id);
    }

    // 14. Update job progress if provided
    if (job_id) {
      await supabase.rpc("increment_translation_job_progress", { _job_id: job_id });
    }

    return new Response(JSON.stringify({ success: true, quality_score: qualityScore, fields_translated: fieldsTranslated, needs_review: needsReview }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("translate-product error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? (e as Error).message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function getCategoryTone(category: string): string {
  const lower = (category || "").toLowerCase();
  if (/coc[çc]|cook|fry|frit|grill|forno|oven/.test(lower)) return "Technical-operational: precise specs, performance-focused";
  if (/buffet|apresent|display|servi/.test(lower)) return "Visual-commercial: elegant, appealing, presentation-focused";
  if (/frio|refrig|cold|freez/.test(lower)) return "Technical-operational: temperature specs, energy efficiency";
  if (/lav|wash|clean|higien/.test(lower)) return "Technical-operational: capacity, hygiene standards";
  if (/consumív|dispos|descart/.test(lower)) return "Direct: compatibility, benefits, value";
  if (/mobili|furnit|mesa|table|cadeira|chair/.test(lower)) return "Descriptive: materials, dimensions, comfort";
  return "Professional: balanced technical precision with commercial appeal";
}
