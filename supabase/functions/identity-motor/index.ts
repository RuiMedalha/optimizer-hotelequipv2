import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Normaliza SKUs para padrões HORECA:
 * - Remove zeros à esquerda em sequências puramente numéricas ou no início
 * - Trata / e \ como equivalentes a -
 * - Lowercase e Trim
 */
const normalizeSKU = (sku: string): string => {
  if (!sku) return "";
  let normalized = sku.trim().toLowerCase();
  
  // Tratar separadores / e \ como -
  normalized = normalized.replace(/[/\\]/g, "-");
  
  // Remover zeros à esquerda (ex: 001 -> 1, 00AB -> ab)
  // Se for apenas números, remove todos os zeros à esquerda
  if (/^\d+$/.test(normalized)) {
    normalized = normalized.replace(/^0+/, "") || "0";
  } else {
    // Se for alfanumérico, remove zeros iniciais se seguido de mais caracteres
    normalized = normalized.replace(/^0+/, "");
  }
  
  return normalized;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { workspace_id, supplier_id, raw_data, ingestion_job_id } = body;

    if (!workspace_id || !raw_data || !Array.isArray(raw_data)) {
      throw new Error("workspace_id and raw_data (array) are required");
    }

    // 1. Carregar aliases e produtos existentes para cache em memória
    const { data: aliases } = await supabase
      .from("sku_aliases")
      .select("sku_supplier, sku_site")
      .eq("workspace_id", workspace_id)
      .eq("supplier_id", supplier_id);

    const { data: existingProducts } = await supabase
      .from("products")
      .select("id, sku, original_title, image_urls, original_price")
      .eq("workspace_id", workspace_id);

    const aliasMap = new Map(aliases?.map(a => [normalizeSKU(a.sku_supplier), a.sku_site]));
    const productMap = new Map(existingProducts?.map(p => [p.sku, p]));
    const normalizedProductMap = new Map(existingProducts?.map(p => [normalizeSKU(p.sku), p]));

    // 2. Carregar Regras de Campo
    const { data: rules } = await supabase
      .from("field_rules")
      .select("field_name, rule")
      .eq("workspace_id", workspace_id)
      .or(`supplier_id.is.null,supplier_id.eq.${supplier_id}`);

    const fieldRules = new Map(rules?.map(r => [r.field_name, r.rule]));

    const stagingRecords = [];

    for (const item of raw_data) {
      const supplierSku = item.sku || item.reference || item.ref;
      if (!supplierSku) continue;

      const normSupplierSku = normalizeSKU(String(supplierSku));
      let targetSku = aliasMap.get(normSupplierSku) || String(supplierSku);
      let matchMethod = "exact";
      let confidence = 0;
      let matchedProduct = productMap.get(targetSku);

      // Algoritmo de Identidade
      if (matchedProduct) {
        confidence = 100;
        matchMethod = "exact";
      } else {
        // Tentar via alias ou normalização
        const normTarget = normalizeSKU(targetSku);
        matchedProduct = normalizedProductMap.get(normTarget);
        
        if (matchedProduct) {
          confidence = 95;
          matchMethod = "normalized";
        } else if (item.ean) {
          // Placeholder para futura busca por EAN se disponível
          matchMethod = "ean";
        } else {
          confidence = 0;
          matchMethod = "manual";
        }
      }

      // Preparar Diff e Proposta
      const proposedChanges: Record<string, any> = {};
      if (matchedProduct) {
        // Lógica de Sincronização de Imagens (Review Visual)
        const imageChanged = JSON.stringify(item.image_urls) !== JSON.stringify(matchedProduct.image_urls);
        if (imageChanged) {
          proposedChanges.image_urls = {
            new: item.image_urls,
            old: matchedProduct.image_urls,
            action: "visual_review"
          };
        }

        // Aplicar Regras de Campo
        for (const [key, value] of Object.entries(item)) {
          if (["sku", "id"].includes(key)) continue;
          
          const rule = fieldRules.get(key) || "manual_review";
          const currentValue = (matchedProduct as any)[key];
          
          if (value !== currentValue) {
            if (rule === "supplier_wins") {
              proposedChanges[key] = value;
            } else if (rule === "lowest_value" && typeof value === "number" && typeof currentValue === "number") {
              proposedChanges[key] = Math.min(value, currentValue);
            } else {
              proposedChanges[key] = {
                proposed: value,
                current: currentValue,
                rule: rule
              };
            }
          }
        }
      }

      stagingRecords.push({
        workspace_id,
        supplier_id,
        ingestion_job_id,
        sku_supplier: String(supplierSku),
        sku_site_target: matchedProduct?.sku || targetSku,
        existing_product_id: matchedProduct?.id || null,
        confidence_score: confidence,
        match_method: matchMethod,
        supplier_data: item,
        site_data: matchedProduct || null,
        proposed_changes: Object.keys(proposedChanges).length > 0 ? proposedChanges : null,
        status: confidence < 80 ? "flagged" : "pending"
      });
    }

    // 3. Persistência em Lote (Staging)
    // Usamos upsert baseado em workspace+supplier+sku_supplier para permitir retomar
    const { error: stagingError } = await supabase
      .from("sync_staging")
      .insert(stagingRecords);

    if (stagingError) throw stagingError;

    return new Response(JSON.stringify({
      success: true,
      processed: stagingRecords.length,
      flagged: stagingRecords.filter(r => r.status === "flagged").length
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});