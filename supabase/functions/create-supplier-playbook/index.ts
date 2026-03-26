import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, supplier_id, playbook_name, playbook_type, description, is_template, playbook_config } = await req.json();
    if (!workspace_id || !playbook_name) throw new Error("workspace_id and playbook_name required");

    const { data, error } = await supabase.from("supplier_playbooks").insert({
      workspace_id,
      supplier_id: supplier_id || null,
      playbook_name,
      playbook_type: playbook_type || "excel_only",
      description: description || null,
      is_template: is_template || false,
      playbook_config: playbook_config || {},
    }).select().single();

    if (error) throw error;

    // Create default checklists if supplier_id provided
    if (supplier_id) {
      const checklists = ["technical_setup", "data_quality", "taxonomy_mapping", "go_live_readiness"];
      for (const ct of checklists) {
        await supabase.from("supplier_setup_checklists").insert({
          supplier_id,
          checklist_type: ct,
          checklist_items: [],
        });
      }
    }

    return new Response(JSON.stringify({ success: true, playbook: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
