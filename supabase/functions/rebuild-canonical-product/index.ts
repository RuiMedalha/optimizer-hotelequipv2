import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { canonical_product_id } = await req.json();

    if (!canonical_product_id) {
      return new Response(JSON.stringify({ error: "canonical_product_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Reset status
    await supabase.from("canonical_products").update({ assembly_status: "queued", updated_at: new Date().toISOString() }).eq("id", canonical_product_id);

    // Log rebuild
    await supabase.from("canonical_assembly_logs").insert({
      canonical_product_id,
      assembly_step: "rebuild_triggered",
      status: "started",
    });

    // Call assemble
    const assembleUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/assemble-canonical-product`;
    const res = await fetch(assembleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ canonical_product_id }),
    });
    const result = await res.json();

    return new Response(JSON.stringify({ rebuild: true, ...result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
