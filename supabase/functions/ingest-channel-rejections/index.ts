import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { workspace_id, channel_id, rejections } = await req.json();
    if (!workspace_id || !channel_id || !rejections?.length) throw new Error("workspace_id, channel_id, rejections[] required");

    const inserted: string[] = [];

    for (const r of rejections) {
      // Insert rejection
      const { data: rej, error } = await supabase.from("channel_rejections").insert({
        workspace_id,
        channel_id,
        product_id: r.product_id,
        external_code: r.external_code || null,
        external_message: r.external_message || null,
        rejection_type: r.rejection_type || "unknown",
        field_impacted: r.field_impacted || null,
      }).select("id").single();

      if (error) { console.error("Insert rejection error:", error); continue; }
      inserted.push(rej.id);

      // Detect pattern and update learning
      const patternKey = `${r.rejection_type || "unknown"}::${r.field_impacted || "general"}`;

      const { data: existing } = await supabase
        .from("channel_rule_learning")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("channel_id", channel_id)
        .eq("pattern_detected", patternKey)
        .single();

      if (existing) {
        await supabase
          .from("channel_rule_learning")
          .update({ frequency: existing.frequency + 1 })
          .eq("id", existing.id);
      } else {
        // Create new learning entry with suggested rule
        const suggestedRule = {
          rule_type: r.field_impacted ? "require_attribute" : "validation_rule",
          conditions: r.rejection_type ? { rejection_type: r.rejection_type } : {},
          actions: r.field_impacted ? { attribute: r.field_impacted } : {},
          description: `Auto-detected from rejection: ${r.external_message || patternKey}`,
        };

        await supabase.from("channel_rule_learning").insert({
          workspace_id,
          channel_id,
          pattern_detected: patternKey,
          source_type: "rejection_pattern",
          frequency: 1,
          suggested_rule: suggestedRule,
        });
      }
    }

    return new Response(JSON.stringify({ inserted_count: inserted.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
