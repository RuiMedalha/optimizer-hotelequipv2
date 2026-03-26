import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { channel_id, fields } = await req.json();
    if (!channel_id || !fields) throw new Error("channel_id and fields required");

    const { data: transformers } = await supabase
      .from("channel_field_transformers")
      .select("*")
      .eq("channel_id", channel_id)
      .eq("is_active", true);

    const result: Record<string, any> = {};

    for (const [fieldName, value] of Object.entries(fields)) {
      const transformer = (transformers || []).find((t: any) => t.source_field === fieldName);
      if (transformer) {
        let transformed = value;
        const config = transformer.transform_config || {};
        if (config.truncate && typeof transformed === "string") {
          transformed = (transformed as string).substring(0, config.truncate);
        }
        if (config.prefix && typeof transformed === "string") {
          transformed = config.prefix + transformed;
        }
        if (config.suffix && typeof transformed === "string") {
          transformed = transformed + config.suffix;
        }
        result[transformer.target_field || fieldName] = transformed;
      } else {
        result[fieldName] = value;
      }
    }

    return new Response(JSON.stringify({ transformed_fields: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
