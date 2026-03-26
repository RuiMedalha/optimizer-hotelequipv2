import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplierId } = await req.json();
    if (!supplierId) throw new Error("supplierId required");

    const { data: records } = await supabase.from("usage_cost_records")
      .select("total_cost, job_type, cost_category")
      .eq("supplier_id", supplierId);

    const total = (records || []).reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0);
    const count = records?.length || 1;
    const avgPerProduct = total / count;
    const importRecords = (records || []).filter((r: any) => r.job_type === "import");
    const avgPerImport = importRecords.length > 0 ? importRecords.reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0) / importRecords.length : 0;

    const { error } = await supabase.from("supplier_cost_profiles").upsert({
      supplier_id: supplierId,
      average_cost_per_product: avgPerProduct,
      average_cost_per_import: avgPerImport,
      cost_efficiency_score: Math.min(10, Math.max(1, 10 - avgPerProduct * 100)),
      updated_at: new Date().toISOString(),
    }, { onConflict: "supplier_id" });
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, avgPerProduct, avgPerImport }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
