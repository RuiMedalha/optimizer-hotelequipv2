// supabase/functions/test-woo-connection/index.ts
// Tests WooCommerce REST API connectivity with caller-supplied credentials.
// No auth required — credentials are passed in the request body.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { siteUrl, consumerKey, consumerSecret } = await req.json();

    if (!siteUrl || !consumerKey || !consumerSecret) {
      return new Response(
        JSON.stringify({ success: false, status: 400, error: "siteUrl, consumerKey e consumerSecret são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const baseUrl = (siteUrl as string).replace(/\/+$/, "");
    const auth = btoa(`${consumerKey}:${consumerSecret}`);
    const url = `${baseUrl}/wp-json/wc/v3/products?per_page=1`;

    const startMs = Date.now();
    let resp: Response;

    try {
      resp = await fetch(url, {
        headers: { "Authorization": `Basic ${auth}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, status: 0, error: err instanceof Error ? err.message : "Erro de rede" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const latencyMs = Date.now() - startMs;

    if (!resp.ok) {
      const text = await resp.text();
      let errorMsg = `HTTP ${resp.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed.message) errorMsg = parsed.message;
        else if (parsed.error) errorMsg = parsed.error;
      } catch { /* keep default */ }
      return new Response(
        JSON.stringify({ success: false, status: resp.status, error: errorMsg }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const products = await resp.json();
    const productsFound = Array.isArray(products) ? products.length : 0;

    return new Response(
      JSON.stringify({ success: true, productsFound, latencyMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, status: 500, error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
