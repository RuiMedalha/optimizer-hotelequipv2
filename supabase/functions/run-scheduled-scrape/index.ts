const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const scheduleId = body.scheduleId as string | undefined;

    // If scheduleId provided, run just that one; otherwise find all due schedules
    let schedules: any[] = [];

    if (scheduleId) {
      const { data, error } = await supabase
        .from("scraping_schedules")
        .select("*")
        .eq("id", scheduleId)
        .single();
      if (error) throw new Error("Schedule not found: " + error.message);
      schedules = [data];
    } else {
      // Find all active schedules where next_run_at <= now
      const { data, error } = await supabase
        .from("scraping_schedules")
        .select("*")
        .eq("is_active", true)
        .lte("next_run_at", new Date().toISOString());
      if (error) throw error;
      schedules = data || [];
    }

    const results = [];

    for (const schedule of schedules) {
      // Create a run record
      const { data: run, error: runErr } = await supabase
        .from("scraping_schedule_runs")
        .insert({
          schedule_id: schedule.id,
          workspace_id: schedule.workspace_id,
          status: "running",
        })
        .select("id")
        .single();

      if (runErr) {
        console.error("Failed to create run:", runErr);
        continue;
      }

      try {
        // Call scrape-with-selectors
        const scrapeResponse = await fetch(`${supabaseUrl}/functions/v1/scrape-with-selectors`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            url: schedule.source_url,
            selectors: schedule.selectors,
            fieldMapping: schedule.field_mapping,
            workspaceId: schedule.workspace_id,
            scheduledRun: true,
          }),
        });

        const scrapeResult = await scrapeResponse.json();
        
        const productsFound = scrapeResult.products?.length || scrapeResult.totalProducts || 0;

        // Update run with results
        await supabase
          .from("scraping_schedule_runs")
          .update({
            status: "completed",
            products_found: productsFound,
            products_new: scrapeResult.newProducts || 0,
            products_updated: scrapeResult.updatedProducts || 0,
            completed_at: new Date().toISOString(),
            run_payload: { summary: scrapeResult.summary || null },
          })
          .eq("id", run.id);

        // Update schedule
        const nextRun = calculateNextRun(schedule.cron_expression, schedule.frequency);
        await supabase
          .from("scraping_schedules")
          .update({
            last_run_at: new Date().toISOString(),
            last_run_status: "success",
            last_run_products_count: productsFound,
            next_run_at: nextRun.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", schedule.id);

        results.push({ scheduleId: schedule.id, status: "success", productsFound });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        
        await supabase
          .from("scraping_schedule_runs")
          .update({
            status: "error",
            error_message: errorMsg,
            completed_at: new Date().toISOString(),
          })
          .eq("id", run.id);

        await supabase
          .from("scraping_schedules")
          .update({
            last_run_at: new Date().toISOString(),
            last_run_status: "error",
            updated_at: new Date().toISOString(),
          })
          .eq("id", schedule.id);

        results.push({ scheduleId: schedule.id, status: "error", error: errorMsg });
      }
    }

    return new Response(JSON.stringify({ scheduled: schedules.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function calculateNextRun(cronExpr: string, frequency: string): Date {
  const now = new Date();
  switch (frequency) {
    case "hourly":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "monthly":
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      return next;
    default:
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
}
