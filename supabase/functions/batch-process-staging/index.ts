import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    console.log(`Batch process: ${changeType} -> ${action} in workspace ${workspaceId}`);

    // Fetch all pending/flagged records for this type
    const { data: stagingRecords, error: fetchErr } = await supabase
      .from("sync_staging")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("change_type", changeType)
      .in("status", ["pending", "flagged"])
      .limit(10000);

    if (fetchErr) throw fetchErr;
    if (!stagingRecords || stagingRecords.length === 0) {
      return new Response(JSON.stringify({ success: true, count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let processedCount = 0;

    for (const staging of stagingRecords) {
      const { proposed_changes, existing_product_id, supplier_data } = staging;
      
      try {
        if (action === 'draft_discontinued' && existing_product_id) {
          // Rule: Set stock to 0 and workflow_state to 'draft'
          await supabase.from("products").update({
            stock: 0,
            workflow_state: 'draft',
            updated_at: new Date().toISOString()
          }).eq("id", existing_product_id);
          
          await supabase.from("sync_staging").update({ status: 'processed' }).eq("id", staging.id);
          processedCount++;
        } 
        else if (action === 'create_drafts' && !existing_product_id) {
          // Rule: Create new products from supplier data
          const finalData = proposed_changes || supplier_data;

          // products.user_id is NOT NULL — fetch workspace owner
          const { data: ws } = await supabase
            .from("workspaces")
            .select("user_id")
            .eq("id", workspaceId)
            .single();
          if (!ws?.user_id) throw new Error("Workspace owner not found");

          // Strip control flags / unknown keys
          const { is_discontinued, model, family, ...rest } = finalData as Record<string, any>;

          const productToInsert = {
            ...rest,
            workspace_id: workspaceId,
            user_id: ws.user_id,
            workflow_state: 'draft',
            status: 'pending',
            origin: 'supplier',
            supplier_title: supplier_data?.title || supplier_data?.Nome || finalData?.title,
            original_price: supplier_data?.price || supplier_data?.Preço || finalData?.original_price,
            ...(model && { canonical_supplier_model: model }),
            ...(family && { canonical_supplier_family: family })
          };

          await supabase.from("products").insert(productToInsert);
          
          await supabase.from("sync_staging").update({ status: 'approved' }).eq("id", staging.id);
          processedCount++;
        }
        else if ((action === 'approve_prices' || action === 'approve_prices_only') && existing_product_id) {
          // Rule: Update only the price
          const newPrice = proposed_changes.price || proposed_changes.original_price || proposed_changes.Preço || proposed_changes.Publico;
          if (newPrice !== undefined) {
             await supabase.from("products").update({
              original_price: newPrice,
              updated_at: new Date().toISOString()
            }).eq("id", existing_product_id);
          }
          
          await supabase.from("sync_staging").update({ status: 'approved' }).eq("id", staging.id);
          processedCount++;
        }
        else if (action === 'review_visual') {
          await supabase.from("sync_staging").update({ 
            status: 'flagged',
            review_notes: "Enviado para revisão visual em lote"
          }).eq("id", staging.id);
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
    console.error(e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});