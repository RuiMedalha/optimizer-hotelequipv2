import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader! } },
    });
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { workspaceId, ruleId } = await req.json();
    if (!workspaceId || !ruleId) {
      return new Response(JSON.stringify({ error: "Parâmetros em falta" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify workspace access
    const { data: member } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!member) {
      return new Response(JSON.stringify({ error: "Sem acesso ao workspace" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const woo = await getWooConfig(supabase);
    if (!woo) {
      return new Response(JSON.stringify({ error: "Credenciais WooCommerce não configuradas" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all snapshots for this rule
    const { data: snapshots, error: snapErr } = await adminClient
      .from("category_architect_snapshots")
      .select("*")
      .eq("rule_id", ruleId)
      .eq("workspace_id", workspaceId)
      .eq("rollback_status", "pending");

    if (snapErr || !snapshots || snapshots.length === 0) {
      return new Response(JSON.stringify({ error: "Sem snapshots para reverter" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update rule status
    await adminClient.from("category_architect_rules").update({
      migration_status: "migrating",
      migration_progress: 0,
      migration_total: snapshots.length,
      error_message: "Rollback em curso...",
    }).eq("id", ruleId);

    let restored = 0;
    let errors = 0;
    const restoredProducts: { id: number; name: string; status: string }[] = [];
    const failedProducts: { id: number; name: string; error: string }[] = [];

    for (const snap of snapshots) {
      try {
        const updatePayload: any = {
          categories: snap.original_categories,
          attributes: snap.original_attributes,
        };

        const resp = await fetch(`${woo.baseUrl}/wp-json/wc/v3/products/${snap.woo_product_id}`, {
          method: "PUT",
          headers: { Authorization: `Basic ${woo.auth}`, "Content-Type": "application/json" },
          body: JSON.stringify(updatePayload),
        });

        if (resp.ok) {
          restored++;
          await adminClient.from("category_architect_snapshots")
            .update({ rollback_status: "restored" })
            .eq("id", snap.id);
          restoredProducts.push({ id: snap.woo_product_id, name: snap.product_name || "", status: "restored" });
        } else {
          const errText = await resp.text();
          errors++;
          await adminClient.from("category_architect_snapshots")
            .update({ rollback_status: "error" })
            .eq("id", snap.id);
          failedProducts.push({ id: snap.woo_product_id, name: snap.product_name || "", error: errText.substring(0, 200) });
        }
      } catch (err) {
        errors++;
        await adminClient.from("category_architect_snapshots")
          .update({ rollback_status: "error" })
          .eq("id", snap.id);
        failedProducts.push({ id: snap.woo_product_id, name: snap.product_name || "", error: String(err).substring(0, 200) });
      }

      // Progress
      await adminClient.from("category_architect_rules").update({
        migration_progress: restored + errors,
      }).eq("id", ruleId);

      await sleep(200);
    }

    // Reset rule to pending after rollback
    await adminClient.from("category_architect_rules").update({
      migration_status: "pending",
      migration_progress: 0,
      migration_total: 0,
      error_message: errors > 0 ? `Rollback: ${errors} erros` : null,
    }).eq("id", ruleId);

    return new Response(JSON.stringify({
      success: true,
      restored,
      errors,
      total: snapshots.length,
      restoredProducts,
      failedProducts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    console.error("rollback-category-migration error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
