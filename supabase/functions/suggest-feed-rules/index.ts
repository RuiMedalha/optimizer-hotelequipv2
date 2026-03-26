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

    const { workspace_id, channel_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    // Get learning patterns with frequency >= 3 (recurring issues)
    let query = supabase
      .from("channel_rule_learning")
      .select("*")
      .eq("workspace_id", workspace_id)
      .eq("accepted_by_user", false)
      .gte("frequency", 3)
      .order("frequency", { ascending: false })
      .limit(20);

    if (channel_id) query = query.eq("channel_id", channel_id);

    const { data: patterns, error } = await query;
    if (error) throw error;

    // Get rejection stats per channel
    const { data: rejectionStats } = await supabase
      .from("channel_rejections")
      .select("channel_id, rejection_type, resolved")
      .eq("workspace_id", workspace_id);

    const channelStats: Record<string, { total: number; resolved: number; types: Record<string, number> }> = {};
    for (const r of rejectionStats || []) {
      if (!channelStats[r.channel_id]) channelStats[r.channel_id] = { total: 0, resolved: 0, types: {} };
      channelStats[r.channel_id].total++;
      if (r.resolved) channelStats[r.channel_id].resolved++;
      channelStats[r.channel_id].types[r.rejection_type || "unknown"] = (channelStats[r.channel_id].types[r.rejection_type || "unknown"] || 0) + 1;
    }

    // Get failed job items
    const { data: failedItems } = await supabase
      .from("channel_publish_job_items")
      .select("channel_id, error_message")
      .eq("status", "failed")
      .limit(100);

    const failurePatterns: Record<string, number> = {};
    for (const fi of failedItems || []) {
      const key = fi.error_message?.substring(0, 80) || "unknown";
      failurePatterns[key] = (failurePatterns[key] || 0) + 1;
    }

    const suggestions = (patterns || []).map((p: any) => ({
      id: p.id,
      pattern: p.pattern_detected,
      frequency: p.frequency,
      source: p.source_type,
      suggested_rule: p.suggested_rule,
      channel_id: p.channel_id,
    }));

    return new Response(JSON.stringify({
      suggestions,
      channel_stats: channelStats,
      top_failure_patterns: Object.entries(failurePatterns).sort((a, b) => b[1] - a[1]).slice(0, 10),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
