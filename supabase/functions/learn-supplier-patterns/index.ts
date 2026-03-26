import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, patterns } = await req.json();

    if (!supplier_id) {
      return new Response(JSON.stringify({ error: "supplier_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = { attribute_patterns: 0, matching_rules: 0, grouping_rules: 0 };

    if (patterns?.attribute_patterns?.length) {
      const rows = patterns.attribute_patterns.map((p: any) => ({ supplier_id, ...p }));
      const { error } = await supabase.from("supplier_attribute_patterns").upsert(rows, { onConflict: "id" });
      if (!error) results.attribute_patterns = rows.length;
    }

    if (patterns?.matching_rules?.length) {
      const rows = patterns.matching_rules.map((r: any) => ({ supplier_id, ...r }));
      const { error } = await supabase.from("supplier_matching_rules").upsert(rows, { onConflict: "id" });
      if (!error) results.matching_rules = rows.length;
    }

    if (patterns?.grouping_rules?.length) {
      const rows = patterns.grouping_rules.map((r: any) => ({ supplier_id, ...r }));
      const { error } = await supabase.from("supplier_grouping_rules").upsert(rows, { onConflict: "id" });
      if (!error) results.grouping_rules = rows.length;
    }

    return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
