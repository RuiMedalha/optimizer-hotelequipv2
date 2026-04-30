import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to clean data according to Rule 2
const cleanSupplierValue = (val: any) => {
  if (val === null || val === undefined) return undefined;
  const sVal = String(val).trim();
  if (sVal === "" || sVal === "-" || sVal === "—" || sVal === "—") return undefined;
  return val;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { id, action, data: approvedData } = await req.json();
    if (!id || !action) throw new Error("ID and action required");

    const { data: staging, error: stagingErr } = await supabase
      .from("sync_staging")
      .select("*")
      .eq("id", id)
      .single();

    if (stagingErr || !staging) throw new Error("Staging record not found");

    if (action === 'reject') {
      await supabase.from("sync_staging").update({ status: 'rejected', updated_at: new Date().toISOString() }).eq("id", id);
      return new Response(JSON.stringify({ success: true, action: 'rejected' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'approve') {
      const rawData = approvedData || staging.proposed_changes || staging.supplier_data || {};
      
      // REGRA 3: Validar SKU
      const sku = cleanSupplierValue(rawData.sku || staging.sku_supplier);
      if (!sku) {
        await supabase.from("sync_staging").update({ 
          status: 'error', 
          review_notes: 'SKU em falta ou inválido (Regra 3)',
          updated_at: new Date().toISOString() 
        }).eq("id", id);
        throw new Error("SKU em falta");
      }

      // Tentar encontrar o ID do produto se estiver em falta no staging
      let effectiveProductId = staging.existing_product_id;
      if (!effectiveProductId) {
        const { data: existingProd } = await supabase
          .from("products")
          .select("id")
          .eq("workspace_id", staging.workspace_id)
          .eq("sku", sku)
          .maybeSingle();
        
        if (existingProd) {
          effectiveProductId = existingProd.id;
          // Opcionalmente atualizar o staging com o ID encontrado para futuras referências
          await supabase.from("sync_staging").update({ existing_product_id: effectiveProductId }).eq("id", id);
        }
      }

      const is_discontinued = rawData.is_discontinued === true || staging.change_type === 'discontinued';

      // REGRA 1: Se descontinuado
      if (is_discontinued) {
        if (effectiveProductId) {
          const { error: updateErr } = await supabase
            .from("products")
            .update({ 
              is_discontinued: true,
              stock: 0,
              workflow_state: 'draft',
              updated_at: new Date().toISOString() 
            })
            .eq("id", effectiveProductId);
          
          if (updateErr) throw updateErr;
        } else {
          // Se é novo e já vem como descontinuado, criamos como rascunho descontinuado
          const { data: ws } = await supabase.from("workspaces").select("user_id").eq("id", staging.workspace_id).single();
          if (!ws?.user_id) throw new Error("Workspace owner not found");

          const insertData = {
            sku: sku,
            workspace_id: staging.workspace_id,
            user_id: ws.user_id,
            status: 'pending',
            workflow_state: 'draft',
            is_discontinued: true,
            stock: 0,
            original_title: cleanSupplierValue(rawData.original_title ?? rawData.title ?? rawData.Nome ?? rawData.Nombre) || sku,
            origin: 'supplier'
          };

          const { error: insertErr } = await supabase.from("products").insert(insertData);
          if (insertErr) throw insertErr;
        }
      } else {
        // ... (continua com a lógica normal de update/create)
        // Note: I will need to use effectiveProductId here too

        // REGRA 2: Filtrar campos vazios
        const productColumns = [
          'sku', 'original_title', 'optimized_title', 'original_description', 'optimized_description',
          'original_price', 'optimized_price', 'category', 'tags', 'meta_title', 'meta_description',
          'seo_slug', 'status', 'woocommerce_id', 'supplier_ref', 'source_file', 'short_description',
          'optimized_short_description', 'technical_specs', 'image_urls', 'faq', 'upsell_skus',
          'crosssell_skus', 'workspace_id', 'product_type', 'parent_product_id', 'attributes',
          'image_alt_texts', 'focus_keyword', 'seo_score', 'category_id', 'sale_price',
          'optimized_sale_price', 'suggested_category', 'workflow_state', 'quality_score',
          'locked_for_publish', 'validation_status', 'validation_errors', 'supplier_id',
          'canonical_supplier_family', 'canonical_supplier_model', 'stock', 'brand', 'origin',
          'supplier_title', 'supplier_description', 'supplier_short_description'
        ];

        const cleanData: Record<string, any> = {};
        
        // Mapear preços (Regra 2 aplicada)
        const price = cleanSupplierValue(rawData.original_price ?? rawData.price ?? rawData.Preço ?? rawData.Publico);
        if (price !== undefined) cleanData.original_price = price;

        // Mapear títulos e descrições (Regra 4)
        const sTitle = cleanSupplierValue(rawData.supplier_title ?? rawData.title ?? rawData.Nome ?? rawData.Nombre);
        if (sTitle !== undefined) cleanData.supplier_title = sTitle;

        // Limpeza geral de colunas
        Object.keys(rawData).forEach(key => {
          if (productColumns.includes(key)) {
            const val = cleanSupplierValue(rawData[key]);
            if (val !== undefined) cleanData[key] = val;
          }
        });

        if (effectiveProductId) {
          // RULE: Se o produto já existia no site com marca preenchida, manter a marca existente — só preencher se estiver vazio.
          const { data: existingProd } = await supabase
            .from("products")
            .select("brand")
            .eq("id", effectiveProductId)
            .single();
          
          if (existingProd?.brand && cleanData.brand) {
            console.log(`Preserving existing brand "${existingProd.brand}" instead of overwriting with "${cleanData.brand}"`);
            delete cleanData.brand;
          }

          // Update: cleanData já não tem campos vazios (Regra 2)
          const { error: updateErr } = await supabase
            .from("products")
            .update({ ...cleanData, updated_at: new Date().toISOString() })
            .eq("id", effectiveProductId);
          if (updateErr) throw updateErr;
        } else {
          // Create (Regra 4)
          const { data: ws } = await supabase.from("workspaces").select("user_id").eq("id", staging.workspace_id).single();
          if (!ws?.user_id) throw new Error("Workspace owner not found");

          // Preparar dados de criação (Regra 4)
          const insertData = {
            ...cleanData,
            sku: sku,
            workspace_id: staging.workspace_id,
            user_id: ws.user_id,
            status: 'pending',
            workflow_state: 'draft',
            origin: 'supplier',
            // Regra 4: original_title recebe o valor do fornecedor como base se não existir um otimizado
            original_title: cleanData.original_title || sTitle,
            is_discontinued: false
          };

          const { error: insertErr } = await supabase.from("products").insert(insertData);
          if (insertErr) throw insertErr;
        }
      }

      await supabase.from("sync_staging").update({ status: 'approved', updated_at: new Date().toISOString() }).eq("id", id);
      return new Response(JSON.stringify({ success: true, action: 'approved' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error("Invalid action");
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});