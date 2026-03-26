import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, test_type, playbook_id, test_payload } = await req.json();
    if (!supplier_id || !test_type) throw new Error("supplier_id and test_type required");

    // Simulate test execution
    let result_status = "success";
    const result_payload: any = { tested_at: new Date().toISOString(), test_type };

    if (test_type === "lookup_test") {
      const { data: strategies } = await supabase.from("supplier_lookup_strategies")
        .select("*").eq("supplier_id", supplier_id).limit(1);
      result_payload.strategy_found = (strategies?.length || 0) > 0;
      if (!result_payload.strategy_found) result_status = "failed";
    } else if (test_type === "full_pipeline_test") {
      const { data: setup } = await supabase.from("supplier_connector_setups")
        .select("*").eq("supplier_id", supplier_id).limit(1).single();
      result_payload.setup_exists = !!setup;
      result_payload.setup_status = setup?.setup_status || "missing";
      if (!setup) result_status = "failed";
    }

    const { data, error } = await supabase.from("supplier_test_runs").insert({
      supplier_id, playbook_id: playbook_id || null, test_type, test_payload: test_payload || {},
      result_status, result_payload,
    }).select().single();
    if (error) throw error;

    // Update connector setup tested status
    if (result_status === "success") {
      await supabase.from("supplier_connector_setups")
        .update({ tested_successfully: true, last_tested_at: new Date().toISOString() })
        .eq("supplier_id", supplier_id);
    }

    return new Response(JSON.stringify({ success: true, test_run: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
