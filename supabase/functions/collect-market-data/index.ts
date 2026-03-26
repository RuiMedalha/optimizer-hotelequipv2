import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { workspaceId } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: sources } = await supabase.from("market_sources").select("*").eq("workspace_id", workspaceId).eq("is_active", true);
    if (!sources || sources.length === 0) return new Response(JSON.stringify({ collected: 0, message: "Nenhuma fonte ativa" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let collected = 0;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

    for (const source of sources) {
      if (!source.base_url || !firecrawlKey) continue;
      try {
        const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { "Authorization": `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: source.base_url, formats: ["markdown"], onlyMainContent: true }),
        });
        const scrapeData = await resp.json();
        const content = scrapeData?.data?.markdown || scrapeData?.markdown || "";
        const title = scrapeData?.data?.metadata?.title || scrapeData?.metadata?.title || source.source_name || "";

        await supabase.from("market_observations").insert({
          workspace_id: workspaceId,
          source_id: source.id,
          observed_url: source.base_url,
          observed_title: title.slice(0, 500),
          observed_category: source.config?.category || null,
          observed_attributes: { raw_content_length: content.length },
          observed_at: new Date().toISOString(),
        });
        collected++;
      } catch (e: unknown) { console.error(`Source ${source.id} error:`, (e as Error).message); }
    }

    return new Response(JSON.stringify({ collected }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
