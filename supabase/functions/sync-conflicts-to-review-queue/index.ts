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

    const { workspace_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    // Get open conflicts requiring human review with product_id
    const { data: conflicts } = await supabase
      .from("conflict_cases")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("status", "open")
      .eq("requires_human_review", true)
      .not("product_id", "is", null);

    let synced = 0;
    for (const conflict of (conflicts || [])) {
      // Check if already in review queue
      const { data: existing } = await supabase
        .from("review_queue")
        .select("id")
        .eq("product_id", conflict.product_id)
        .in("status", ["pending", "in_review"])
        .limit(1);

      if (!existing || existing.length === 0) {
        const severityPriority = { critical: 90, high: 70, medium: 50, low: 30 };
        const priority = severityPriority[conflict.severity as keyof typeof severityPriority] || 50;

        await supabase.rpc("enqueue_product_for_review", {
          _workspace_id: workspace_id,
          _product_id: conflict.product_id,
          _reason: "low_confidence",
          _priority: priority,
        });
        synced++;
      }
    }

    return new Response(JSON.stringify({ synced }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
