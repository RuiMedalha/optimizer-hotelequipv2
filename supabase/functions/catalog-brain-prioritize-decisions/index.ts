import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get pending decisions
    const { data: decisions } = await supabase
      .from("catalog_decisions").select("*")
      .eq("workspace_id", workspaceId).eq("status", "pending")
      .order("priority_score", { ascending: false }).limit(100);

    // Check policies for auto-approval
    const { data: policies } = await supabase
      .from("brain_decision_policies").select("*").eq("workspace_id", workspaceId);

    let autoApproved = 0;
    for (const decision of (decisions || [])) {
      const matchingPolicy = (policies || []).find((p: any) => {
        const conditions = p.conditions || {};
        if (conditions.decision_type && conditions.decision_type !== decision.decision_type) return false;
        if (conditions.min_confidence && decision.confidence < conditions.min_confidence) return false;
        return true;
      });

      if (matchingPolicy && !matchingPolicy.requires_human_review) {
        await supabase.from("catalog_decisions")
          .update({ status: "approved", updated_at: new Date().toISOString() })
          .eq("id", decision.id);
        autoApproved++;
      }
    }

    return new Response(JSON.stringify({
      total: (decisions || []).length,
      auto_approved: autoApproved,
      pending_review: (decisions || []).length - autoApproved,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
