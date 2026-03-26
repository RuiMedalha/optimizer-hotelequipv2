import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { channel_id, workspace_id, user_id, product_ids, locale } = await req.json();

    if (!product_ids || !product_ids.length) throw new Error("No product_ids provided");

    // Create job
    const { data: job, error: jErr } = await supabase.from("channel_publish_jobs").insert({
      workspace_id,
      channel_id,
      user_id,
      job_status: "running",
      total_products: product_ids.length,
    }).select().single();
    if (jErr) throw jErr;

    // Create job items
    const items = product_ids.map((pid: string) => ({
      job_id: job.id,
      product_id: pid,
      channel_id,
      status: "queued",
    }));
    await supabase.from("channel_publish_job_items").insert(items);

    // Process each
    let processed = 0, failed = 0;
    for (const pid of product_ids) {
      try {
        const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/publish-to-channel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ product_id: pid, channel_id, workspace_id, user_id, locale }),
        });

        const result = await resp.json();
        
        await supabase.from("channel_publish_job_items").update({
          status: result.error ? "failed" : "completed",
          external_id: result.external_id || null,
          response: result,
          error_message: result.error || null,
          completed_at: new Date().toISOString(),
        }).eq("job_id", job.id).eq("product_id", pid);

        if (result.error) failed++;
        else processed++;
      } catch (e: unknown) {
        failed++;
        await supabase.from("channel_publish_job_items").update({
          status: "failed",
          error_message: e instanceof Error ? (e as Error).message : "Unknown error",
          completed_at: new Date().toISOString(),
        }).eq("job_id", job.id).eq("product_id", pid);
      }

      await supabase.from("channel_publish_jobs").update({
        processed_products: processed,
        failed_products: failed,
      }).eq("id", job.id);
    }

    // Mark complete
    await supabase.from("channel_publish_jobs").update({
      job_status: failed === product_ids.length ? "failed" : "completed",
      processed_products: processed,
      failed_products: failed,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);

    return new Response(JSON.stringify({ success: true, job_id: job.id, processed, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("publish-batch error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? (e as Error).message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
