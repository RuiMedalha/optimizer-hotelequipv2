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
    const start = Date.now();

    const { data: action, error: aErr } = await supabase
      .from("autonomous_actions")
      .select("*")
      .eq("id", action_id)
      .eq("workspace_id", workspace_id)
      .single();
    if (aErr || !action) throw new Error("Action not found");

    // Validate guardrails first
    const { data: guardrails } = await supabase
      .from("autonomous_guardrails")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("is_active", true);

    for (const g of (guardrails || [])) {
      const rule = g.rule_payload as any;
      if (g.guardrail_type === "max_discount" && action.action_type === "create_promotion") {
        const discount = (action.action_payload as any)?.discount || 0;
        if (discount > (rule?.max_value || 30)) {
          await supabase.from("autonomous_actions").update({ status: "failed" }).eq("id", action_id);
          throw new Error(`Guardrail violated: max_discount ${rule?.max_value}%`);
        }
      }
      if (g.guardrail_type === "max_price_change" && action.action_type === "update_price") {
        const change = Math.abs((action.action_payload as any)?.price_change_pct || 0);
        if (change > (rule?.max_value || 20)) {
          await supabase.from("autonomous_actions").update({ status: "failed" }).eq("id", action_id);
          throw new Error(`Guardrail violated: max_price_change ${rule?.max_value}%`);
        }
      }
    }

    // Mark as executing
    await supabase.from("autonomous_actions").update({ status: "executing" }).eq("id", action_id);

    let result: any = { success: true };

    // Execute based on action type
    switch (action.action_type) {
      case "update_price": {
        const payload = action.action_payload as any;
        if (action.target_product_id && payload?.new_price) {
          await supabase.from("products").update({ optimized_price: payload.new_price }).eq("id", action.target_product_id);
          result = { updated_price: payload.new_price, product_id: action.target_product_id };
        }
        break;
      }
      case "create_bundle":
      case "add_cross_sell":
      case "add_upsell":
      case "create_product_pack": {
        const payload = action.action_payload as any;
        if (payload?.product_ids) {
          await supabase.from("bundle_suggestions").insert({
            workspace_id,
            bundle_type: action.action_type === "add_cross_sell" ? "cross_sell"
              : action.action_type === "add_upsell" ? "upsell" : "complementary",
            primary_product_id: action.target_product_id,
            suggested_products: payload.product_ids,
            confidence: action.confidence || 70,
            accepted: true,
          });
          result = { bundle_created: true };
        }
        break;
      }
      case "create_promotion": {
        const payload = action.action_payload as any;
        if (action.target_product_id) {
          await supabase.from("promotion_candidates").insert({
            workspace_id,
            product_id: action.target_product_id,
            promotion_type: payload?.promotion_type || "discount",
            estimated_revenue_gain: action.expected_revenue || 0,
            confidence: action.confidence || 70,
          });
          result = { promotion_created: true };
        }
        break;
      }
      default:
        result = { action_type: action.action_type, note: "executed_generic" };
    }

    const duration = Date.now() - start;

    // Log execution
    await supabase.from("autonomous_execution_logs").insert({
      workspace_id,
      action_id,
      execution_result: result,
      duration_ms: duration,
    });

    // Mark completed
    await supabase.from("autonomous_actions").update({ status: "completed", executed_at: new Date().toISOString() }).eq("id", action_id);

    // Feed brain
    await supabase.from("catalog_brain_observations").insert({
      workspace_id,
      observation_type: "autonomous_execution",
      signal_payload: { action_type: action.action_type, result, duration_ms: duration },
      signal_strength: 85,
      source: "autonomous_commerce",
    });

    return new Response(JSON.stringify({ result, duration_ms: duration }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
