import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { playbook_id } = await req.json();
    if (!playbook_id) throw new Error("playbook_id required");

    const { data: playbook, error } = await supabase.from("supplier_playbooks")
      .select("*").eq("id", playbook_id).single();
    if (error) throw error;

    const issues: string[] = [];
    const config = playbook.playbook_config as any || {};

    if (!config.sources || !config.sources.length) issues.push("Nenhuma fonte definida");
    if (!config.lookup_strategy) issues.push("Estratégia de lookup não definida");
    if (!config.taxonomy_mapping) issues.push("Mapeamento de taxonomia não definido");
    if (!config.publish_rules) issues.push("Regras de publicação não definidas");

    const valid = issues.length === 0;

    return new Response(JSON.stringify({ success: true, valid, issues }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
