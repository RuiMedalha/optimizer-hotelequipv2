import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getWooConfig(supabase: any) {
  const { data: settings } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);
  const map: Record<string, string> = {};
  settings?.forEach((s: any) => { map[s.key] = s.value; });
  const url = map["woocommerce_url"];
  const key = map["woocommerce_consumer_key"];
  const secret = map["woocommerce_consumer_secret"];
  if (!url || !key || !secret) return null;
  return { baseUrl: url.replace(/\/+$/, ""), auth: btoa(`${key}:${secret}`) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader! } } });
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { workspaceId, categoryId } = body;

    if (!workspaceId || !categoryId) {
      return new Response(JSON.stringify({ error: "Parâmetros em falta" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: member } = await adminClient.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (!member) {
      return new Response(JSON.stringify({ error: "Sem acesso ao workspace" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const woo = await getWooConfig(supabase);
    if (!woo) {
      return new Response(JSON.stringify({ error: "Credenciais WooCommerce não configuradas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get woocommerce_id from Supabase
    const { data: catData } = await adminClient.from("categories").select("woocommerce_id").eq("id", categoryId).maybeSingle();
    const wooId = catData?.woocommerce_id;

    if (wooId) {
      // Delete from WooCommerce
      const resp = await fetch(`${woo.baseUrl}/wp-json/wc/v3/products/categories/${wooId}?force=true`, {
        method: "DELETE",
        headers: { Authorization: `Basic ${woo.auth}` },
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.warn(`WooCommerce delete failed: ${err}`);
      }
    }

    // Delete from Supabase
    await adminClient.from("categories").delete().eq("id", categoryId);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    console.error("delete-woo-category error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
