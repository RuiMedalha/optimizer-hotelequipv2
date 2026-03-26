import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { channelId } = await req.json();
    if (!channelId) throw new Error("channelId required");

    const { data: records } = await supabase.from("usage_cost_records")
      .select("total_cost, job_type, cost_category")
      .eq("channel_id", channelId);

    const publishRecords = (records || []).filter((r: any) => r.cost_category === "publish_api");
    const syncRecords = (records || []).filter((r: any) => r.cost_category === "sync_api");
    const buildRecords = (records || []).filter((r: any) => r.cost_category === "payload_build");

    const avg = (arr: any[]) => arr.length > 0 ? arr.reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0) / arr.length : 0;

    const { error } = await supabase.from("channel_cost_profiles").upsert({
      channel_id: channelId,
      average_cost_per_publish: avg(publishRecords),
      average_cost_per_sync: avg(syncRecords),
      average_payload_build_cost: avg(buildRecords),
      updated_at: new Date().toISOString(),
    }, { onConflict: "channel_id" });
    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
