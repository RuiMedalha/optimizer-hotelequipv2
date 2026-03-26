import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { channel_payload_id } = await req.json();
    if (!channel_payload_id) throw new Error("channel_payload_id required");

    const { data: payload } = await supabase.from("channel_payloads").select("*").eq("id", channel_payload_id).single();
    if (!payload) throw new Error("Payload not found");

    const errors: string[] = [];
    const data = payload.payload_data as Record<string, any> || {};

    // Required fields check
    const requiredFields = ["title", "sku"];
    for (const f of requiredFields) {
      if (!data[f] || (typeof data[f] === "string" && data[f].trim() === "")) {
        errors.push(`Missing required field: ${f}`);
      }
    }

    // Price check
    const price = data.optimized_price || data.original_price;
    if (!price || Number(price) <= 0) errors.push("Price must be greater than 0");

    // Title length
    if (data.title && typeof data.title === "string" && data.title.length > 200) {
      errors.push("Title exceeds 200 characters");
    }

    // Description length
    if (data.description && typeof data.description === "string" && data.description.length > 10000) {
      errors.push("Description exceeds 10000 characters");
    }

    const status = errors.length === 0 ? "validated" : "invalid";

    await supabase.from("channel_payloads").update({
      payload_status: status,
      validation_status: status,
      validation_errors: errors,
    }).eq("id", channel_payload_id);

    await supabase.from("channel_payload_logs").insert({
      channel_payload_id,
      step_name: "validate_payload",
      status: errors.length === 0 ? "success" : "warning",
      output_payload: { errors },
    });

    return new Response(JSON.stringify({ status, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
