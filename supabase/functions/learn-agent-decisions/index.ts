import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { actionId, approved } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get the action
    const { data: action, error } = await supabase
      .from("agent_actions")
      .select("*, catalog_agents(*)")
      .eq("id", actionId)
      .single();
    if (error || !action) throw new Error("Action not found");

    // Update approval status
    await supabase.from("agent_actions").update({ approved_by_user: approved }).eq("id", actionId);

    // Store in decision memory
    await supabase.from("agent_decision_memory").insert({
      workspace_id: action.workspace_id,
      agent_type: action.catalog_agents?.agent_type,
      decision_context: { action_type: action.action_type, product_id: action.product_id, payload: action.action_payload },
      decision_action: action.action_result || action.action_payload,
      confidence: approved ? 90 : 10,
      approved,
    });

    // If approved and action was pending, execute it
    if (approved && action.product_id) {
      switch (action.action_type) {
        case "update_seo_fields": {
          const seoData = action.action_payload;
          if (seoData?.recommended_title || seoData?.recommended_meta_description) {
            const updates: any = {};
            if (seoData.recommended_title) updates.meta_title = seoData.recommended_title;
            if (seoData.recommended_meta_description) updates.meta_description = seoData.recommended_meta_description;
            await supabase.from("products").update(updates).eq("id", action.product_id);
          }
          break;
        }
        case "update_title": {
          if (action.action_payload?.new_title) {
            await supabase.from("products").update({ optimized_title: action.action_payload.new_title }).eq("id", action.product_id);
          }
          break;
        }
        case "update_description": {
          if (action.action_payload?.new_description) {
            await supabase.from("products").update({ optimized_description: action.action_payload.new_description }).eq("id", action.product_id);
          }
          break;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, approved }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
