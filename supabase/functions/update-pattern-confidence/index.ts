import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { workspaceId, patternIds, outcome } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");
    if (!outcome || !["success", "failure"].includes(outcome)) throw new Error("outcome must be 'success' or 'failure'");

    let updated = 0;

    // If specific pattern IDs provided, update those
    if (patternIds && Array.isArray(patternIds) && patternIds.length > 0) {
      for (const pid of patternIds) {
        const { data: pattern } = await supabase
          .from("extraction_memory_patterns")
          .select("*")
          .eq("id", pid)
          .single();

        if (!pattern) continue;

        const delta = outcome === "success" ? 3 : -5;
        const newConf = Math.min(100, Math.max(0, pattern.confidence + delta));
        const updateData: any = {
          confidence: newConf,
          usage_count: (pattern.usage_count || 0) + 1,
          last_used_at: new Date().toISOString(),
        };

        if (outcome === "success") {
          updateData.success_count = (pattern.success_count || 0) + 1;
          updateData.last_confirmed_at = new Date().toISOString();
        } else {
          updateData.failure_count = (pattern.failure_count || 0) + 1;
        }

        await supabase.from("extraction_memory_patterns").update(updateData).eq("id", pid);
        updated++;
      }
    }

    // Also update supplier profiles confidence if outcome is provided with supplier context
    const body = await req.json().catch(() => ({}));
    if (body.supplierName) {
      const { data: profiles } = await supabase
        .from("supplier_layout_profiles")
        .select("id, confidence_rules")
        .eq("workspace_id", workspaceId)
        .eq("supplier_name", body.supplierName);

      for (const prof of (profiles || [])) {
        const rules = prof.confidence_rules || {};
        rules.total_uses = (rules.total_uses || 0) + 1;
        if (outcome === "success") rules.successes = (rules.successes || 0) + 1;
        else rules.failures = (rules.failures || 0) + 1;

        await supabase.from("supplier_layout_profiles").update({
          confidence_rules: rules,
        }).eq("id", prof.id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      patternsUpdated: updated,
      outcome,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("update-pattern-confidence error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
