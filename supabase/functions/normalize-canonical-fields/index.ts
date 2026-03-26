import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NORMALIZATION_RULES: Record<string, (v: string) => string> = {
  voltage: (v) => v.replace(/(\d+)\s*v\b/gi, "$1 V"),
  capacity: (v) => v.replace(/(\d+[.,]?\d*)\s*l\b/gi, (_, n) => `${n.replace(",", ".")} L`),
  material: (v) => {
    const map: Record<string, string> = { "inox": "Aço Inoxidável", "aço inox": "Aço Inoxidável", "stainless steel": "Aço Inoxidável", "abs": "ABS", "pp": "Polipropileno" };
    return map[v.toLowerCase()] || v;
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { canonical_product_id } = await req.json();

    if (!canonical_product_id) {
      return new Response(JSON.stringify({ error: "canonical_product_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: fields } = await supabase.from("canonical_product_fields").select("*").eq("canonical_product_id", canonical_product_id);

    let normalized = 0;
    for (const field of fields || []) {
      const raw = field.field_value?.v || (typeof field.field_value === "string" ? field.field_value : null);
      if (!raw || typeof raw !== "string") continue;

      let value = raw;
      // Apply all normalization rules
      for (const rule of Object.values(NORMALIZATION_RULES)) {
        value = rule(value);
      }

      if (value !== raw) {
        await supabase.from("canonical_product_fields").update({
          normalized_value: { v: value },
          updated_at: new Date().toISOString(),
        }).eq("id", field.id);
        normalized++;
      }
    }

    await supabase.from("canonical_assembly_logs").insert({
      canonical_product_id,
      assembly_step: "normalize_fields",
      status: "completed",
      output_summary: { fields_normalized: normalized },
    });

    return new Response(JSON.stringify({ normalized }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
