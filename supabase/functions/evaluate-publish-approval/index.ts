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

    const { workspace_id, product_id, channel_id } = await req.json();
    if (!workspace_id || !product_id) throw new Error("workspace_id and product_id required");

    const blockers: string[] = [];
    const warnings: string[] = [];

    // Get product
    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("id", product_id)
      .single();

    if (!product) throw new Error("Product not found");

    // Get approval rules
    const { data: rules } = await supabase
      .from("publish_approval_rules")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("is_active", true);

    // Check open critical conflicts
    const { data: criticalConflicts } = await supabase
      .from("conflict_cases")
      .select("id")
      .eq("product_id", product_id)
      .eq("status", "open")
      .eq("severity", "critical");

    if (criticalConflicts && criticalConflicts.length > 0) {
      blockers.push(`${criticalConflicts.length} critical conflict(s) open`);
    }

    // Check pending review tasks
    const { data: pendingTasks } = await supabase
      .from("human_review_tasks")
      .select("id")
      .eq("product_id", product_id)
      .in("status", ["pending", "assigned", "in_review"]);

    if (pendingTasks && pendingTasks.length > 0) {
      warnings.push(`${pendingTasks.length} review task(s) pending`);
    }

    // Check publish locks
    const { data: locks } = await supabase
      .from("publish_locks")
      .select("id")
      .eq("product_id", product_id)
      .eq("is_active", true);

    if (locks && locks.length > 0) {
      blockers.push(`${locks.length} active publish lock(s)`);
    }

    // Check quality score
    const qualityScore = product.seo_score || 0;
    const price = product.optimized_price || product.original_price || 0;
    const hasImages = product.image_urls && product.image_urls.length > 0;

    for (const rule of (rules || [])) {
      if (rule.min_quality_score && qualityScore < rule.min_quality_score) {
        blockers.push(`Quality score ${qualityScore} below minimum ${rule.min_quality_score}`);
      }
      if (rule.block_on_conflict && criticalConflicts && criticalConflicts.length > 0) {
        blockers.push(`Rule "${rule.rule_name}" blocks publish on conflict`);
      }
    }

    if (price <= 0) blockers.push("Price is zero or negative");
    if (!hasImages) blockers.push("No images available");

    const requiresHumanApproval = (rules || []).some((r: any) => r.require_human_approval);
    const status = blockers.length > 0 ? "blocked" : requiresHumanApproval ? "review_required" : "approved";

    return new Response(JSON.stringify({ status, blockers, warnings, quality_score: qualityScore, price }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
