import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface GateRule {
  field: string;
  rule: string;
  value?: any;
  severity: "error" | "warning" | "info";
  message?: string;
}

interface RuleFailure {
  field: string;
  rule: string;
  severity: string;
  expected: any;
  actual: any;
  message: string;
}

function evaluateRule(product: any, rule: GateRule): RuleFailure | null {
  const fieldValue = product[rule.field];
  const fieldStr = typeof fieldValue === "string" ? fieldValue : "";
  const fieldNum = typeof fieldValue === "number" ? fieldValue : parseFloat(fieldStr) || 0;
  const fieldArr = Array.isArray(fieldValue) ? fieldValue : [];

  switch (rule.rule) {
    case "not_empty":
      if (!fieldValue || (typeof fieldValue === "string" && fieldValue.trim() === "") || (Array.isArray(fieldValue) && fieldValue.length === 0)) {
        return { field: rule.field, rule: rule.rule, severity: rule.severity, expected: "not empty", actual: fieldValue ?? null, message: rule.message || `${rule.field} está vazio` };
      }
      break;
    case "min_length":
      if (fieldStr.length < (rule.value || 0)) {
        return { field: rule.field, rule: rule.rule, severity: rule.severity, expected: `>= ${rule.value} chars`, actual: fieldStr.length, message: rule.message || `${rule.field} tem ${fieldStr.length} caracteres (mín: ${rule.value})` };
      }
      break;
    case "max_length":
      if (fieldStr.length > (rule.value || 0)) {
        return { field: rule.field, rule: rule.rule, severity: rule.severity, expected: `<= ${rule.value} chars`, actual: fieldStr.length, message: rule.message || `${rule.field} tem ${fieldStr.length} caracteres (máx: ${rule.value})` };
      }
      break;
    case "min_value":
      if (fieldNum < (rule.value || 0)) {
        return { field: rule.field, rule: rule.rule, severity: rule.severity, expected: `>= ${rule.value}`, actual: fieldNum, message: rule.message || `${rule.field} = ${fieldNum} (mín: ${rule.value})` };
      }
      break;
    case "max_value":
      if (fieldNum > (rule.value || 0)) {
        return { field: rule.field, rule: rule.rule, severity: rule.severity, expected: `<= ${rule.value}`, actual: fieldNum, message: rule.message || `${rule.field} = ${fieldNum} (máx: ${rule.value})` };
      }
      break;
    case "min_items":
      if (fieldArr.length < (rule.value || 0)) {
        return { field: rule.field, rule: rule.rule, severity: rule.severity, expected: `>= ${rule.value} items`, actual: fieldArr.length, message: rule.message || `${rule.field} tem ${fieldArr.length} items (mín: ${rule.value})` };
      }
      break;
    case "enum":
      if (Array.isArray(rule.value) && !rule.value.includes(fieldStr)) {
        return { field: rule.field, rule: rule.rule, severity: rule.severity, expected: rule.value, actual: fieldStr, message: rule.message || `${rule.field} valor inválido: "${fieldStr}"` };
      }
      break;
    case "no_html":
      // Check if string contains HTML tags
      const htmlPattern = /<[^>]+>/;
      if (htmlPattern.test(fieldStr)) {
        return { 
          field: rule.field, 
          rule: rule.rule, 
          severity: rule.severity, 
          expected: "plain text without HTML tags", 
          actual: fieldStr.substring(0, 100) + "...", 
          message: rule.message || `${rule.field} contém tags HTML (não permitido para SEO)` 
        };
      }
      break;
    case "strip_html_equals":
      // Check if stripped HTML version equals the original (i.e., no HTML was present)
      const stripped = fieldStr.replace(/<[^>]+>/g, '').trim();
      const original = fieldStr.trim();
      if (stripped !== original) {
        return { 
          field: rule.field, 
          rule: rule.rule, 
          severity: rule.severity, 
          expected: "text without HTML", 
          actual: `${original.length} chars, ${original.length - stripped.length} chars of HTML`, 
          message: rule.message || `${rule.field} contém HTML que será removido no SEO` 
        };
      }
      break;
  }
  return null;
}

function calculateSubScores(product: any): Record<string, number> {
  const score = (val: any, weight: number) => val ? weight : 0;
  const strScore = (val: string | null, maxLen: number) => {
    if (!val || val.trim() === "") return 0;
    const len = val.trim().length;
    if (len > maxLen * 1.5) return 60;
    if (len > maxLen) return 80;
    return 100;
  };

  const titleScore = product.optimized_title ? (product.optimized_title.length > 10 ? 100 : 60) : 0;
  const descScore = product.optimized_description ? Math.min(100, Math.round((product.optimized_description.length / 200) * 100)) : 0;
  const seoScore = product.seo_score || 0;
  const imageScore = (product.image_urls?.length || 0) >= 1 ? 100 : 0;
  const priceScore = (product.optimized_price || product.original_price) > 0 ? 100 : 0;

  // Completeness: check key fields
  const fields = ["optimized_title", "optimized_description", "meta_title", "meta_description", "seo_slug", "optimized_price"];
  const filled = fields.filter(f => product[f] && String(product[f]).trim() !== "").length;
  const completenessScore = Math.round((filled / fields.length) * 100);

  const overall = Math.round((
    titleScore * 0.15 + 
    descScore * 0.15 + 
    seoScore * 0.1 + 
    imageScore * 0.1 + 
    priceScore * 0.1 + 
    completenessScore * 0.2 +
    (product.seo_short_description ? 0.2 : 0) * 100
  ));

  return {
    title_score: titleScore,
    description_score: descScore,
    seo_score: seoScore,
    image_score: imageScore,
    price_score: priceScore,
    completeness_score: completenessScore,
    seo_short: strScore(product.seo_short_description, 160),
    no_html_short: product.seo_short_description && !/<[^>]+>/.test(product.seo_short_description) ? 100 : 0,
    schema_match_score: 0,
    overall_score: Math.min(100, overall),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { workspaceId, productIds } = body;

    if (!workspaceId || !Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "workspaceId e productIds são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch active quality gates for this workspace
    const { data: gates, error: gatesErr } = await supabase
      .from("quality_gates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);

    if (gatesErr) throw gatesErr;

    // If no gates exist, create default gate
    let activeGates = gates || [];
    if (activeGates.length === 0) {
      const defaultRules: GateRule[] = [
        { field: "optimized_title", rule: "not_empty", severity: "error" },
        { field: "optimized_description", rule: "not_empty", severity: "error" },
        { field: "meta_title", rule: "max_length", value: 60, severity: "warning" },
        { field: "meta_description", rule: "max_length", value: 160, severity: "warning" },
        { field: "image_urls", rule: "min_items", value: 1, severity: "warning" },
        { field: "optimized_price", rule: "min_value", value: 0.01, severity: "error" },
      ];

      const { data: newGate, error: createErr } = await supabase
        .from("quality_gates")
        .insert({
          workspace_id: workspaceId,
          name: "Quality Gate Padrão",
          is_active: true,
          block_publish: true,
          rules: defaultRules,
        })
        .select("*")
        .single();

      if (createErr) throw createErr;
      activeGates = [newGate];
    }

    // Fetch products
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (prodErr) throw prodErr;

    const results: any[] = [];

    for (const product of (products || [])) {
      const productResults: any[] = [];
      let hasBlockingFailure = false;

      for (const gate of activeGates) {
        const rules = (gate.rules || []) as GateRule[];
        const failures: RuleFailure[] = [];

        for (const rule of rules) {
          const failure = evaluateRule(product, rule);
          if (failure) {
            failures.push(failure);
            if (failure.severity === "error" && gate.block_publish) {
              hasBlockingFailure = true;
            }
          }
        }

        const passed = failures.filter(f => f.severity === "error").length === 0;
        const totalRules = rules.length;
        const passedRules = totalRules - failures.length;
        const score = totalRules > 0 ? Math.round((passedRules / totalRules) * 100) : 100;

        // Delete old result, insert new
        await adminClient.from("quality_gate_results").delete().eq("product_id", product.id).eq("gate_id", gate.id);
        await adminClient.from("quality_gate_results").insert({
          product_id: product.id,
          gate_id: gate.id,
          passed,
          score,
          failures,
          evaluated_at: new Date().toISOString(),
        });

        productResults.push({ gateId: gate.id, gateName: gate.name, passed, score, failures });
      }

      // Calculate quality sub-scores
      const subScores = calculateSubScores(product);

      // Upsert quality scores
      await adminClient.from("product_quality_scores").upsert({
        product_id: product.id,
        ...subScores,
        calculated_at: new Date().toISOString(),
      }, { onConflict: "product_id" });

      // Update product quality_score and locked_for_publish
      const updateData: any = {
        quality_score: subScores.overall_score,
        updated_at: new Date().toISOString(),
      };

      if (hasBlockingFailure) {
        updateData.locked_for_publish = true;
        updateData.validation_status = "invalid";
        // Create or update publish lock
        const { data: existingLock } = await adminClient
          .from("publish_locks")
          .select("id")
          .eq("product_id", product.id)
          .eq("lock_type", "quality_gate")
          .eq("is_active", true)
          .maybeSingle();

        if (!existingLock) {
          await adminClient.from("publish_locks").insert({
            product_id: product.id,
            workspace_id: workspaceId,
            reason: "Produto não passou no quality gate (regras com severity error falharam)",
            lock_type: "quality_gate",
            locked_by: user.id,
            is_active: true,
          });
        }
      } else {
        updateData.locked_for_publish = false;
        updateData.validation_status = "valid";
        // Remove quality_gate locks
        await adminClient.from("publish_locks")
          .update({ is_active: false, unlocked_by: user.id, unlocked_at: new Date().toISOString() })
          .eq("product_id", product.id)
          .eq("lock_type", "quality_gate")
          .eq("is_active", true);
      }

      await adminClient.from("products").update(updateData).eq("id", product.id);

      results.push({
        productId: product.id,
        productName: product.optimized_title || product.original_title || product.sku,
        qualityScore: subScores.overall_score,
        locked: hasBlockingFailure,
        gates: productResults,
      });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("evaluate-quality-gate error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
