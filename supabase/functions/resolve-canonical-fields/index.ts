import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { canonical_product_id, field_name, candidates } = await req.json();

    if (!canonical_product_id || !field_name || !candidates?.length) {
      return new Response(JSON.stringify({ error: "canonical_product_id, field_name, and candidates required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Sort by priority (lower = better), then confidence (higher = better)
    const sorted = [...candidates].sort((a: any, b: any) => {
      if (a.priority !== b.priority) return (a.priority || 10) - (b.priority || 10);
      return (b.confidence || 0) - (a.confidence || 0);
    });

    const winner = sorted[0];
    const reason = winner.is_human_override ? "human_override" : winner.priority < (sorted[1]?.priority || 99) ? "source_priority" : "confidence_win";

    const { data, error } = await supabase.from("canonical_product_fields").upsert({
      canonical_product_id,
      field_name,
      field_value: typeof winner.value === "object" ? winner.value : { v: winner.value },
      confidence_score: winner.confidence || 0,
      selected_source_type: winner.source_type,
      selected_source_record_id: winner.source_record_id || null,
      selection_reason: reason,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" }).select().single();

    if (error) throw error;

    return new Response(JSON.stringify({ field: data, reason, alternatives: sorted.slice(1).map((c: any) => ({ source: c.source_type, confidence: c.confidence })) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
