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
      .in("status", ["pending", "flagged"]);

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
          await supabase.from("products").update({
            stock: 0,
            status: 'draft',
            updated_at: new Date().toISOString()
          }).eq("id", existing_product_id);
          
          await supabase.from("sync_staging").update({ status: 'processed' }).eq("id", staging.id);
          processedCount++;
        } 
        else if (action === 'create_drafts' && !existing_product_id) {
          const finalData = proposed_changes || supplier_data;
          await supabase.from("products").insert({
            ...finalData,
            workspace_id,
            status: 'draft'
          });
          
          await supabase.from("sync_staging").update({ status: 'approved' }).eq("id", staging.id);
          processedCount++;
        }
        else if (action === 'approve_prices' && existing_product_id) {
          const newPrice = proposed_changes.price || proposed_changes.original_price || proposed_changes.Preço || proposed_changes.Publico;
          if (newPrice !== undefined) {
             await supabase.from("products").update({
              price: newPrice,
              original_price: newPrice,
              updated_at: new Date().toISOString()
            }).eq("id", existing_product_id);
          }
          
          await supabase.from("sync_staging").update({ status: 'approved' }).eq("id", staging.id);
          processedCount++;
        }
        else if (action === 'review_visual') {
          // Just mark as flagged for visual attention
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