import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { playbook_id, supplier_id } = await req.json();
    if (!playbook_id) throw new Error("playbook_id required");

    // Check tests passed
    if (supplier_id) {
      const { data: tests } = await supabase.from("supplier_test_runs")
        .select("result_status").eq("supplier_id", supplier_id).eq("result_status", "success");
      if (!tests?.length) throw new Error("Nenhum teste passou com sucesso. Execute testes antes de ativar.");
    }

    // Activate playbook
    const { error: e1 } = await supabase.from("supplier_playbooks")
      .update({ is_active: true }).eq("id", playbook_id);
    if (e1) throw e1;

    // Activate connector
    if (supplier_id) {
      await supabase.from("supplier_connector_setups")
        .update({ setup_status: "active" }).eq("supplier_id", supplier_id);
    }

    return new Response(JSON.stringify({ success: true, activated: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
