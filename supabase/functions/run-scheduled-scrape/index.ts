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
        // Get previous run's products for comparison
        const previousProducts = await getPreviousRunProducts(supabase, schedule.id, run.id);

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
        const currentProducts = scrapeResult.products || [];

        // Detect changes between runs
        const changes = detectChanges(previousProducts, currentProducts, schedule);
        
        // Store changes in the change log
        if (changes.length > 0) {
          const changeLogs = changes.map((c: any) => ({
            schedule_id: schedule.id,
            run_id: run.id,
            workspace_id: schedule.workspace_id,
            change_type: c.change_type,
            product_sku: c.product_sku,
            product_title: c.product_title,
            field_name: c.field_name,
            old_value: c.old_value,
            new_value: c.new_value,
            change_magnitude: c.change_magnitude,
          }));

          // Insert in batches of 100
          for (let i = 0; i < changeLogs.length; i += 100) {
            const batch = changeLogs.slice(i, i + 100);
            await supabase.from("scraping_change_logs").insert(batch);
          }
        }

        // Store current products snapshot for future comparison
        await supabase
          .from("scraping_schedule_runs")
          .update({
            status: "completed",
            products_found: productsFound,
            products_new: scrapeResult.newProducts || changes.filter((c: any) => c.change_type === 'new_product').length,
            products_updated: scrapeResult.updatedProducts || changes.filter((c: any) => c.change_type !== 'new_product' && c.change_type !== 'removed_product').length,
            completed_at: new Date().toISOString(),
            run_payload: { 
              summary: scrapeResult.summary || null,
              changes_detected: changes.length,
              products_snapshot: currentProducts.slice(0, 500), // store snapshot for next comparison
            },
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

        results.push({ scheduleId: schedule.id, status: "success", productsFound, changesDetected: changes.length });
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

// Get products from the most recent completed run for comparison
async function getPreviousRunProducts(supabase: any, scheduleId: string, currentRunId: string): Promise<any[]> {
  const { data } = await supabase
    .from("scraping_schedule_runs")
    .select("run_payload")
    .eq("schedule_id", scheduleId)
    .eq("status", "completed")
    .neq("id", currentRunId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .single();

  return data?.run_payload?.products_snapshot || [];
}

// Detect changes between two product sets
function detectChanges(previousProducts: any[], currentProducts: any[], schedule: any): any[] {
  if (!previousProducts.length) return []; // First run, nothing to compare

  const changes: any[] = [];
  
  // Index by SKU or title for matching
  const prevMap = new Map<string, any>();
  for (const p of previousProducts) {
    const key = p.sku || p.ref || p.title || p.original_title || JSON.stringify(p).slice(0, 100);
    prevMap.set(key, p);
  }

  const currMap = new Map<string, any>();
  for (const p of currentProducts) {
    const key = p.sku || p.ref || p.title || p.original_title || JSON.stringify(p).slice(0, 100);
    currMap.set(key, p);
  }

  // New products
  for (const [key, product] of currMap) {
    if (!prevMap.has(key)) {
      changes.push({
        change_type: "new_product",
        product_sku: product.sku || product.ref || null,
        product_title: product.title || product.original_title || key,
        field_name: null,
        old_value: null,
        new_value: "Novo produto detetado",
        change_magnitude: null,
      });
    }
  }

  // Removed products
  for (const [key, product] of prevMap) {
    if (!currMap.has(key)) {
      changes.push({
        change_type: "removed_product",
        product_sku: product.sku || product.ref || null,
        product_title: product.title || product.original_title || key,
        field_name: null,
        old_value: "Produto existente",
        new_value: null,
        change_magnitude: null,
      });
    }
  }

  // Changed products
  for (const [key, curr] of currMap) {
    const prev = prevMap.get(key);
    if (!prev) continue;

    // Price changes
    const prevPrice = parseFloat(prev.price || prev.original_price || "0");
    const currPrice = parseFloat(curr.price || curr.original_price || "0");
    if (prevPrice > 0 && currPrice > 0 && prevPrice !== currPrice) {
      const magnitude = ((currPrice - prevPrice) / prevPrice) * 100;
      changes.push({
        change_type: "price_change",
        product_sku: curr.sku || curr.ref || null,
        product_title: curr.title || curr.original_title || key,
        field_name: "price",
        old_value: prevPrice.toFixed(2),
        new_value: currPrice.toFixed(2),
        change_magnitude: Math.round(magnitude * 100) / 100,
      });
    }

    // Title changes
    const prevTitle = prev.title || prev.original_title || "";
    const currTitle = curr.title || curr.original_title || "";
    if (prevTitle && currTitle && prevTitle !== currTitle) {
      changes.push({
        change_type: "title_change",
        product_sku: curr.sku || curr.ref || null,
        product_title: currTitle,
        field_name: "title",
        old_value: prevTitle,
        new_value: currTitle,
        change_magnitude: null,
      });
    }

    // Stock changes
    const prevStock = prev.stock ?? prev.stock_status ?? null;
    const currStock = curr.stock ?? curr.stock_status ?? null;
    if (prevStock !== null && currStock !== null && String(prevStock) !== String(currStock)) {
      changes.push({
        change_type: "stock_change",
        product_sku: curr.sku || curr.ref || null,
        product_title: curr.title || curr.original_title || key,
        field_name: "stock",
        old_value: String(prevStock),
        new_value: String(currStock),
        change_magnitude: null,
      });
    }
  }

  return changes;
}

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
