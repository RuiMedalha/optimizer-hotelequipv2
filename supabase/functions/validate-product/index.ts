import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ValidationRule {
  id: string;
  field_key: string;
  rule_type: string;
  rule_config: any;
  severity: string;
  error_message_template: string | null;
  schema_id: string | null;
}

interface ValidationResult {
  ruleId: string | null;
  schemaId: string | null;
  field: string;
  passed: boolean;
  severity: string;
  actual: string | null;
  expected: string | null;
  message: string;
}

function getFieldValue(product: any, fieldKey: string): any {
  return product[fieldKey];
}

function evaluateRule(product: any, rule: ValidationRule): ValidationResult {
  const fieldValue = getFieldValue(product, rule.field_key);
  const fieldStr = typeof fieldValue === "string" ? fieldValue : "";
  const fieldNum = typeof fieldValue === "number" ? fieldValue : parseFloat(fieldStr) || 0;
  const fieldArr = Array.isArray(fieldValue) ? fieldValue : [];
  const config = rule.rule_config || {};
  const tmpl = rule.error_message_template;

  const fail = (expected: string, actual: string, defaultMsg: string): ValidationResult => ({
    ruleId: rule.id,
    schemaId: rule.schema_id,
    field: rule.field_key,
    passed: false,
    severity: rule.severity,
    actual,
    expected,
    message: tmpl || defaultMsg,
  });

  const pass = (): ValidationResult => ({
    ruleId: rule.id,
    schemaId: rule.schema_id,
    field: rule.field_key,
    passed: true,
    severity: rule.severity,
    actual: null,
    expected: null,
    message: "",
  });

  switch (rule.rule_type) {
    case "required":
    case "not_empty":
      if (!fieldValue || (typeof fieldValue === "string" && fieldValue.trim() === "") || (Array.isArray(fieldValue) && fieldValue.length === 0)) {
        return fail("not empty", String(fieldValue ?? "null"), `${rule.field_key} é obrigatório`);
      }
      return pass();

    case "min_length": {
      const min = config.value ?? config.min ?? 0;
      if (fieldStr.length < min) {
        return fail(`>= ${min} chars`, String(fieldStr.length), `${rule.field_key} tem ${fieldStr.length} caracteres (mín: ${min})`);
      }
      return pass();
    }

    case "max_length": {
      const max = config.value ?? config.max ?? 0;
      if (fieldStr.length > 0 && fieldStr.length > max) {
        return fail(`<= ${max} chars`, String(fieldStr.length), `${rule.field_key} tem ${fieldStr.length} caracteres (máx: ${max})`);
      }
      return pass();
    }

    case "min_value": {
      const min = config.value ?? config.min ?? 0;
      if (fieldNum < min) {
        return fail(`>= ${min}`, String(fieldNum), `${rule.field_key} = ${fieldNum} (mín: ${min})`);
      }
      return pass();
    }

    case "max_value": {
      const max = config.value ?? config.max ?? 0;
      if (fieldNum > max) {
        return fail(`<= ${max}`, String(fieldNum), `${rule.field_key} = ${fieldNum} (máx: ${max})`);
      }
      return pass();
    }

    case "min_items": {
      const min = config.value ?? config.min ?? 0;
      if (fieldArr.length < min) {
        return fail(`>= ${min} items`, String(fieldArr.length), `${rule.field_key} tem ${fieldArr.length} items (mín: ${min})`);
      }
      return pass();
    }

    case "max_items": {
      const max = config.value ?? config.max ?? 0;
      if (fieldArr.length > max) {
        return fail(`<= ${max} items`, String(fieldArr.length), `${rule.field_key} tem ${fieldArr.length} items (máx: ${max})`);
      }
      return pass();
    }

    case "enum": {
      const allowed = config.allowed ?? config.value ?? [];
      if (Array.isArray(allowed) && fieldStr && !allowed.includes(fieldStr)) {
        return fail(`one of [${allowed.join(",")}]`, fieldStr, `${rule.field_key} valor inválido: "${fieldStr}"`);
      }
      return pass();
    }

    case "regex": {
      const pattern = config.pattern ?? config.value ?? "";
      if (pattern && fieldStr) {
        try {
          const re = new RegExp(pattern);
          if (!re.test(fieldStr)) {
            return fail(`match /${pattern}/`, fieldStr, `${rule.field_key} não corresponde ao padrão esperado`);
          }
        } catch { /* invalid regex, skip */ }
      }
      return pass();
    }

    case "json_schema":
      // Placeholder - just pass
      return pass();

    case "custom":
      return pass();

    default:
      return pass();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { productId, workspaceId, channel, forceRevalidate } = body;

    if (!productId || !workspaceId) {
      return new Response(JSON.stringify({ error: "productId e workspaceId são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch product
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    if (prodErr || !product) {
      return new Response(JSON.stringify({ error: "Produto não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find active schema: specific category first, then global
    const { data: schemas } = await adminClient
      .from("category_schemas")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("category_id", { ascending: true, nullsFirst: false });

    let activeSchema: any = null;
    if (schemas && schemas.length > 0) {
      // Try category-specific first
      if (product.category_id) {
        activeSchema = schemas.find((s: any) => s.category_id === product.category_id);
      }
      // Fallback to global (category_id is null)
      if (!activeSchema) {
        activeSchema = schemas.find((s: any) => s.category_id === null);
      }
    }

    // Fetch validation rules
    let rulesQuery = adminClient
      .from("validation_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);

    const { data: allRules } = await rulesQuery;
    let rules = (allRules || []) as ValidationRule[];

    // Filter by schema if applicable
    if (activeSchema) {
      rules = rules.filter((r: any) =>
        r.schema_id === activeSchema.id || r.schema_id === null
      );
    }

    // Filter by channel
    if (channel) {
      rules = rules.filter((r: any) =>
        !r.applies_to_channels || r.applies_to_channels.length === 0 || r.applies_to_channels.includes(channel)
      );
    }

    // Filter by product type
    if (product.product_type) {
      rules = rules.filter((r: any) =>
        !r.applies_to_product_types || r.applies_to_product_types.length === 0 || r.applies_to_product_types.includes(product.product_type)
      );
    }

    // If no rules exist, create defaults
    if (rules.length === 0) {
      const defaultRules = [
        { field_key: "optimized_title", rule_type: "not_empty", rule_config: {}, severity: "error" },
        { field_key: "optimized_title", rule_type: "max_length", rule_config: { value: 70 }, severity: "warning" },
        { field_key: "meta_title", rule_type: "max_length", rule_config: { value: 60 }, severity: "warning" },
        { field_key: "meta_description", rule_type: "max_length", rule_config: { value: 160 }, severity: "warning" },
        { field_key: "image_urls", rule_type: "min_items", rule_config: { value: 1 }, severity: "warning" },
        { field_key: "optimized_price", rule_type: "min_value", rule_config: { value: 0.01 }, severity: "error" },
        { field_key: "seo_slug", rule_type: "regex", rule_config: { pattern: "^[a-z0-9-]+$" }, severity: "warning" },
      ];

      const { data: created } = await adminClient
        .from("validation_rules")
        .insert(defaultRules.map(r => ({
          ...r,
          workspace_id: workspaceId,
          schema_id: activeSchema?.id || null,
        })))
        .select("*");

      rules = (created || []) as ValidationRule[];
    }

    // Evaluate all rules
    const results: ValidationResult[] = [];
    for (const rule of rules) {
      results.push(evaluateRule(product, rule));
    }

    const errors = results.filter(r => !r.passed && r.severity === "error");
    const warnings = results.filter(r => !r.passed && r.severity === "warning");
    const infos = results.filter(r => !r.passed && r.severity === "info");

    // Determine status
    let validationStatus = "valid";
    if (errors.length > 0) validationStatus = "invalid";
    else if (warnings.length > 0) validationStatus = "partial";

    // Delete old validation results and insert new
    await adminClient.from("validation_results").delete().eq("product_id", productId);
    if (results.length > 0) {
      await adminClient.from("validation_results").insert(
        results.map(r => ({
          product_id: productId,
          rule_id: r.ruleId,
          schema_id: r.schemaId,
          channel_id: channel ? channel : null,
          passed: r.passed,
          actual_value: r.actual,
          expected: r.expected,
          severity: r.severity,
          details: { message: r.message, field: r.field },
        }))
      );
    }

    // Compute completeness score
    const fields = ["optimized_title", "optimized_description", "optimized_short_description", "meta_title", "meta_description", "seo_slug", "image_urls", "category", "optimized_price", "tags"];
    let filledCount = 0;
    for (const f of fields) {
      const v = product[f];
      if (v && (typeof v !== "string" || v.trim() !== "") && (!Array.isArray(v) || v.length > 0)) {
        filledCount++;
      }
    }
    const completenessScore = Math.round((filledCount / fields.length) * 100);

    // Calculate quality score
    const errorPenalty = errors.length * 15;
    const warningPenalty = warnings.length * 5;
    const qualityScore = Math.max(0, Math.min(100, completenessScore - errorPenalty - warningPenalty));

    // Update product
    const validationErrors = errors.map(e => ({
      field: e.field,
      rule: (e as Error).message,
      severity: e.severity,
    }));

    const locked = validationStatus === "invalid" || qualityScore < 20;

    await adminClient.from("products").update({
      quality_score: qualityScore,
      validation_status: validationStatus,
      validation_errors: validationErrors,
      locked_for_publish: locked,
      updated_at: new Date().toISOString(),
    }).eq("id", productId);

    // Manage publish locks
    if (locked) {
      const { data: existingLock } = await adminClient
        .from("publish_locks")
        .select("id")
        .eq("product_id", productId)
        .eq("lock_type", "validation")
        .eq("is_active", true)
        .maybeSingle();

      if (!existingLock) {
        await adminClient.from("publish_locks").insert({
          product_id: productId,
          workspace_id: workspaceId,
          reason: `Validação falhou: ${errors.length} erro(s), ${warnings.length} aviso(s)`,
          lock_type: "validation",
          locked_by: user.id,
          is_active: true,
        });
      }
    } else {
      await adminClient.from("publish_locks")
        .update({ is_active: false, unlocked_by: user.id, unlocked_at: new Date().toISOString() })
        .eq("product_id", productId)
        .eq("lock_type", "validation")
        .eq("is_active", true);
    }

    // Auto-enqueue for review when validation fails or low quality
    let reviewQueued = false;
    if (validationStatus === "invalid") {
      await adminClient.rpc("enqueue_product_for_review", {
        _workspace_id: workspaceId,
        _product_id: productId,
        _reason: "validation_fail",
        _priority: 80,
      });
      reviewQueued = true;
    } else if (qualityScore < 40) {
      await adminClient.rpc("enqueue_product_for_review", {
        _workspace_id: workspaceId,
        _product_id: productId,
        _reason: "low_confidence",
        _priority: 60,
      });
      reviewQueued = true;
    }

    // Audit trail
    await adminClient.from("audit_trail").insert({
      user_id: user.id,
      workspace_id: workspaceId,
      entity_type: "product",
      entity_id: productId,
      action: "update",
      field_changes: { validation_status: validationStatus, quality_score: qualityScore },
      metadata: { source: "validate-product", errors: errors.length, warnings: warnings.length },
    });

    return new Response(JSON.stringify({
      productId,
      schema: activeSchema ? { id: activeSchema.id, name: activeSchema.name } : null,
      validationStatus,
      qualityScore,
      errors: errors.map(e => ({ field: e.field, message: (e as Error).message, expected: e.expected, actual: e.actual })),
      warnings: warnings.map(w => ({ field: w.field, message: w.message, expected: w.expected, actual: w.actual })),
      infos: infos.map(i => ({ field: i.field, message: i.message })),
      reviewQueued,
      publishLocked: locked,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("validate-product error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
