import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, product } = await req.json();
    if (!workspace_id || !product) throw new Error("workspace_id and product are required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const candidates: Array<{ product_id: string; sku: string; title: string; confidence: number; strategy: string }> = [];

    // 1. Strong match: EAN
    if (product.ean) {
      const { data: eanMatches } = await supabase
        .from("products")
        .select("id, sku, original_title, attributes")
        .eq("workspace_id", workspace_id)
        .containedBy("attributes", { ean: product.ean })
        .limit(5);

      // Also search in sku field as some stores store EAN there
      const { data: eanSkuMatches } = await supabase
        .from("products")
        .select("id, sku, original_title")
        .eq("workspace_id", workspace_id)
        .eq("sku", product.ean)
        .limit(5);

      for (const m of (eanMatches || [])) {
        candidates.push({ product_id: m.id, sku: m.sku, title: m.original_title || "", confidence: 0.95, strategy: "ean_exact" });
      }
      for (const m of (eanSkuMatches || [])) {
        if (!candidates.find(c => c.product_id === m.id)) {
          candidates.push({ product_id: m.id, sku: m.sku, title: m.original_title || "", confidence: 0.93, strategy: "ean_in_sku" });
        }
      }
    }

    // 2. Strong match: Supplier SKU
    if (product.sku || product.supplier_ref) {
      const ref = product.supplier_ref || product.sku;
      const { data: skuMatches } = await supabase
        .from("products")
        .select("id, sku, original_title, supplier_ref")
        .eq("workspace_id", workspace_id)
        .or(`sku.eq.${ref},supplier_ref.eq.${ref}`)
        .limit(10);

      for (const m of (skuMatches || [])) {
        if (!candidates.find(c => c.product_id === m.id)) {
          candidates.push({ product_id: m.id, sku: m.sku, title: m.original_title || "", confidence: 0.90, strategy: "sku_exact" });
        }
      }
    }

    // 3. Medium/Weak match: Title similarity (use ilike for basic fuzzy)
    if (product.title || product.original_title) {
      const title = (product.title || product.original_title || "").trim();
      if (title.length > 3) {
        // Search with first significant words
        const words = title.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 3);
        if (words.length > 0) {
          const pattern = `%${words.join("%")}%`;
          const { data: titleMatches } = await supabase
            .from("products")
            .select("id, sku, original_title, supplier_ref")
            .eq("workspace_id", workspace_id)
            .ilike("original_title", pattern)
            .limit(10);

          for (const m of (titleMatches || [])) {
            if (!candidates.find(c => c.product_id === m.id)) {
              candidates.push({ product_id: m.id, sku: m.sku, title: m.original_title || "", confidence: 0.55, strategy: "title_similarity" });
            }
          }
        }
      }
    }

    // If we have candidates but need AI to refine confidence, use AI for top candidates
    let finalResult;
    if (candidates.length > 0) {
      // If strong match exists, return directly
      const strongMatch = candidates.find(c => c.confidence >= 0.85);
      if (strongMatch) {
        finalResult = {
          match_found: true,
          matched_product_id: strongMatch.product_id,
          confidence_score: strongMatch.confidence,
          matching_strategy: strongMatch.strategy,
          alternative_matches: candidates
            .filter(c => c.product_id !== strongMatch.product_id)
            .slice(0, 5)
            .map(c => ({ product_id: c.product_id, sku: c.sku, title: c.title, confidence_score: c.confidence, strategy: c.strategy })),
        };
      } else {
        // Use AI to refine weak matches
        const aiResponse = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            taskType: "supplier_matching",
            workspaceId: workspace_id,
            systemPrompt: `You are a product matching agent. Given a new product and candidate matches from the catalog, determine if any candidate is truly the same product. Consider title, brand, dimensions, specs. Respond with valid JSON only:
{
  "best_match_index": number or null,
  "confidence_score": 0.0-1.0,
  "reasoning": "string"
}`,
            messages: [{
              role: "user",
              content: `New product:\n${JSON.stringify(product, null, 2)}\n\nCandidates:\n${JSON.stringify(candidates.slice(0, 5), null, 2)}`,
            }],
            options: { max_tokens: 512 },
          }),
        });

        let aiPick = null;
        if (aiResponse.ok) {
          const routeData = await aiResponse.json();
          const raw = (routeData.result?.choices?.[0]?.message?.content || "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          try { aiPick = JSON.parse(raw); } catch { /* ignore */ }
        } else {
          await aiResponse.text();
        }

        if (aiPick && aiPick.best_match_index !== null && aiPick.best_match_index !== undefined && aiPick.confidence_score >= 0.6) {
          const best = candidates[aiPick.best_match_index] || candidates[0];
          finalResult = {
            match_found: true,
            matched_product_id: best.product_id,
            confidence_score: aiPick.confidence_score,
            matching_strategy: best.strategy + "+ai_refined",
            alternative_matches: candidates
              .filter(c => c.product_id !== best.product_id)
              .slice(0, 5)
              .map(c => ({ product_id: c.product_id, sku: c.sku, title: c.title, confidence_score: c.confidence, strategy: c.strategy })),
          };
        } else {
          finalResult = {
            match_found: false,
            matched_product_id: null,
            confidence_score: candidates[0]?.confidence || 0,
            matching_strategy: "no_confident_match",
            alternative_matches: candidates.slice(0, 5).map(c => ({
              product_id: c.product_id, sku: c.sku, title: c.title, confidence_score: c.confidence, strategy: c.strategy,
            })),
          };
        }
      }
    } else {
      finalResult = {
        match_found: false,
        matched_product_id: null,
        confidence_score: 0,
        matching_strategy: "no_candidates",
        alternative_matches: [],
      };
    }

    // Record agent run
    await supabase.from("agent_runs").insert({
      workspace_id,
      agent_name: "supplier_matching",
      status: "completed",
      input_payload: { title: product.title || product.original_title, sku: product.sku, ean: product.ean },
      output_payload: finalResult,
      confidence_score: finalResult.confidence_score,
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify(finalResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
