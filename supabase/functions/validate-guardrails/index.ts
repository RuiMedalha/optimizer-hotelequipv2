import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, action_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: action } = await supabase.from("autonomous_actions").select("*").eq("id", action_id).single();
    if (!action) throw new Error("Action not found");

    const { data: guardrails } = await supabase
      .from("autonomous_guardrails")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("is_active", true);

    const violations: string[] = [];

    for (const g of (guardrails || [])) {
      const rule = g.rule_payload as any;
      const payload = action.action_payload as any;

      switch (g.guardrail_type) {
        case "max_discount":
          if (action.action_type === "create_promotion" && (payload?.discount || 0) > (rule?.max_value || 30)) {
            violations.push(`Discount ${payload?.discount}% exceeds max ${rule?.max_value}%`);
          }
          break;
        case "min_margin":
          if ((action.expected_conversion || 0) < (rule?.min_value || 5)) {
            violations.push(`Expected margin below minimum ${rule?.min_value}%`);
          }
          break;
        case "max_price_change":
          if (action.action_type === "update_price") {
            const changePct = Math.abs(payload?.price_change_pct || 0);
            if (changePct > (rule?.max_value || 20)) {
              violations.push(`Price change ${changePct}% exceeds max ${rule?.max_value}%`);
            }
          }
          break;
        case "price_floor":
          if (action.action_type === "update_price" && (payload?.new_price || 0) < (rule?.min_value || 0)) {
            violations.push(`Price below floor ${rule?.min_value}`);
          }
          break;
      }
    }

    const passed = violations.length === 0;

    return new Response(JSON.stringify({ passed, violations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
