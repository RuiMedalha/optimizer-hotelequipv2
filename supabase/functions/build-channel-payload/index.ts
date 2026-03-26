import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, channel_id, canonical_product_id } = await req.json();
    if (!workspace_id || !channel_id || !canonical_product_id) throw new Error("workspace_id, channel_id and canonical_product_id required");

    // Load canonical product fields
    const { data: fields } = await supabase
      .from("canonical_product_fields")
      .select("*")
      .eq("canonical_product_id", canonical_product_id);

    // Load channel field transformers
    const { data: transformers } = await supabase
      .from("channel_field_transformers")
      .select("*")
      .eq("channel_id", channel_id)
      .eq("is_active", true);

    // Load channel product overrides
    const { data: overrides } = await supabase
      .from("channel_product_data")
      .select("*")
      .eq("channel_id", channel_id)
      .eq("canonical_product_id", canonical_product_id);

    // Build payload data
    const payloadData: Record<string, any> = {};
    const payloadFields: any[] = [];

    for (const field of (fields || [])) {
      const override = (overrides || []).find((o: any) => o.field_name === field.field_name);
      const transformer = (transformers || []).find((t: any) => t.source_field === field.field_name);

      let finalValue = override?.override_value || field.field_value;
      let transformerUsed = null;

      if (transformer) {
        // Apply simple transformations
        const targetField = transformer.target_field || field.field_name;
        if (transformer.transform_config?.truncate) {
          const maxLen = transformer.transform_config.truncate;
          if (typeof finalValue === "string" && finalValue.length > maxLen) {
            finalValue = finalValue.substring(0, maxLen);
          }
        }
        transformerUsed = transformer.id;
        payloadData[targetField] = finalValue;

        payloadFields.push({
          field_name: targetField,
          source_field_name: field.field_name,
          source_value: field.field_value,
          transformed_value: finalValue,
          transformer_used: transformerUsed,
          validation_status: "valid",
        });
      } else {
        payloadData[field.field_name] = finalValue;
        payloadFields.push({
          field_name: field.field_name,
          source_field_name: field.field_name,
          source_value: field.field_value,
          transformed_value: finalValue,
          transformer_used: null,
          validation_status: "valid",
        });
      }
    }

    // Create payload record
    const { data: payload, error: payloadError } = await supabase
      .from("channel_payloads")
      .insert({
        workspace_id,
        channel_id,
        canonical_product_id,
        payload_status: "built",
        payload_data: payloadData,
        validation_status: "pending",
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (payloadError) throw payloadError;

    // Save field-level trace
    for (const pf of payloadFields) {
      await supabase.from("channel_payload_fields").insert({ channel_payload_id: payload.id, ...pf });
    }

    // Log
    await supabase.from("channel_payload_logs").insert({
      channel_payload_id: payload.id,
      step_name: "build_payload",
      status: "success",
      input_payload: { canonical_product_id, fields_count: (fields || []).length },
      output_payload: { payload_fields_count: payloadFields.length },
    });

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
