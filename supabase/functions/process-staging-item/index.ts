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

    const { id, action, data: approvedData } = await req.json();
    if (!id || !action) throw new Error("ID and action required");

    // Get staging record
    const { data: staging, error: stagingErr } = await supabase
      .from("sync_staging")
      .select("*")
      .eq("id", id)
      .single();

    if (stagingErr || !staging) throw new Error("Staging record not found");

    if (action === 'reject') {
      await supabase
        .from("sync_staging")
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq("id", id);
      
      return new Response(JSON.stringify({ success: true, action: 'rejected' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === 'approve') {
      const finalData = approvedData || staging.proposed_changes;
      
      if (staging.existing_product_id) {
        // Update existing product
        const { error: updateErr } = await supabase
          .from("products")
          .update({ ...finalData, updated_at: new Date().toISOString() })
          .eq("id", staging.existing_product_id);
        
        if (updateErr) throw updateErr;
      } else {
        // Create new product
        const { error: insertErr } = await supabase
          .from("products")
          .insert({
            ...finalData,
            workspace_id: staging.workspace_id,
            status: 'pending' // As per user requirement
          });
        
        if (insertErr) throw insertErr;
      }

      // Update staging status
      await supabase
        .from("sync_staging")
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq("id", id);

      // Handle SKU aliases if applicable
      if (staging.sku_supplier && staging.sku_site_target && staging.supplier_id) {
        const { data: existingAlias } = await supabase
          .from("sku_aliases")
          .select("*")
          .eq("sku_site", staging.sku_site_target)
          .eq("sku_supplier", staging.sku_supplier)
          .eq("supplier_id", staging.supplier_id)
          .maybeSingle();

        if (!existingAlias) {
          await supabase.from("sku_aliases").insert({
            workspace_id: staging.workspace_id,
            sku_site: staging.sku_site_target,
            sku_supplier: staging.sku_supplier,
            supplier_id: staging.supplier_id,
            times_used: 1
          });
        } else {
          await supabase.from("sku_aliases")
            .update({ times_used: (existingAlias.times_used || 0) + 1 })
            .eq("id", existingAlias.id);
        }
      }

      return new Response(JSON.stringify({ success: true, action: 'approved' }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    throw new Error("Invalid action");
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
