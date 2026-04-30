import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const cleanSupplierValue = (val: any) => {
  if (val === null || val === undefined) return undefined;
  const sVal = String(val).trim();
  if (sVal === "" || sVal === "-" || sVal === "—") return undefined;
  return val;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { changeType, action, workspaceId } = await req.json();
    if (!changeType || !action || !workspaceId) throw new Error("Missing parameters");

    const { data: stagingRecords, error: fetchErr } = await supabase
      .from("sync_staging")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("change_type", changeType)
      .in("status", ["pending", "flagged"])
      .limit(500); // Batch smaller for safety

    if (fetchErr) throw fetchErr;
    if (!stagingRecords || stagingRecords.length === 0) {
      return new Response(JSON.stringify({ success: true, count: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let processedCount = 0;
    const { data: ws } = await supabase.from("workspaces").select("user_id").eq("id", workspaceId).single();

    for (const staging of stagingRecords) {
      try {
        const rawData = staging.proposed_changes || staging.supplier_data || {};
        
        // REGRA 3: Validar SKU
        const sku = cleanSupplierValue(rawData.sku || staging.sku_supplier);
        if (!sku) {
          await supabase.from("sync_staging").update({ status: 'error', review_notes: 'SKU em falta (Regra 3)' }).eq("id", staging.id);
          continue;
        }

        // Resolução do ID do produto se estiver em falta
        let effectiveProductId = staging.existing_product_id;
        if (!effectiveProductId) {
          const { data: p } = await supabase.from("products").select("id").eq("workspace_id", workspaceId).eq("sku", sku).maybeSingle();
          if (p) effectiveProductId = p.id;
        }

        if (action === 'draft_discontinued') {
          // REGRA 1: Minimalista para descontinuados
          if (effectiveProductId) {
            await supabase.from("products").update({
              is_discontinued: true,
              stock: 0,
              workflow_state: 'draft',
              updated_at: new Date().toISOString()
            }).eq("id", effectiveProductId);
          } else {
            // Se for descontinuado e não existir, criar como descontinuado
            await supabase.from("products").insert({
              sku: sku,
              workspace_id: workspaceId,
              user_id: ws.user_id,
              workflow_state: 'draft',
              is_discontinued: true,
              stock: 0,
              original_title: cleanSupplierValue(rawData.original_title) || sku,
              origin: 'supplier'
            });
          }
          
          await supabase.from("sync_staging").update({ status: 'approved', existing_product_id: effectiveProductId }).eq("id", staging.id);
          processedCount++;
        } 
        else if (action === 'create_drafts' && !effectiveProductId && ws?.user_id) {
          // BUSCAR MARCA PADRÃO
          const { data: job } = await supabase
            .from("ingestion_jobs")
            .select("default_brand")
            .eq("id", staging.job_id)
            .single();

          const sTitle = cleanSupplierValue(rawData.supplier_title ?? rawData.title ?? rawData.Nome ?? rawData.Nombre);
          const price = cleanSupplierValue(rawData.original_price ?? rawData.price ?? rawData.Preço ?? rawData.Publico);

          const productToInsert = {
            sku: sku,
            workspace_id: workspaceId,
            user_id: ws.user_id,
            workflow_state: 'draft',
            status: 'pending',
            origin: 'supplier',
            brand: job?.default_brand,
            model: staging.sku_supplier || sku,
            supplier_title: sTitle,
            original_price: price,
            original_title: null,
            is_discontinued: false
          };

          const { error: insErr } = await supabase.from("products").insert(productToInsert);
          if (!insErr) {
            await supabase.from("sync_staging").update({ status: 'approved' }).eq("id", staging.id);
            processedCount++;
          }
        }
        else if ((action === 'approve_prices' || action === 'approve_prices_only') && effectiveProductId) {
          const newPrice = cleanSupplierValue(rawData.price || rawData.original_price || rawData.Preço || rawData.Publico);
          if (newPrice !== undefined) {
             await supabase.from("products").update({
              original_price: newPrice,
              updated_at: new Date().toISOString()
            }).eq("id", effectiveProductId);
          }
          await supabase.from("sync_staging").update({ status: 'approved', existing_product_id: effectiveProductId }).eq("id", staging.id);
          processedCount++;
        }
      } catch (err) {
        console.error(`Error processing staging ${staging.id}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, count: processedCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});