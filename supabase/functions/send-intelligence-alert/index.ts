import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspace_id, chat_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
    if (!TELEGRAM_API_KEY) throw new Error("TELEGRAM_API_KEY is not configured");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get chat_id from settings if not provided
    let targetChatId = chat_id;
    if (!targetChatId) {
      const { data: settings } = await supabase
        .from("workspace_notification_settings")
        .select("telegram_chat_id")
        .eq("workspace_id", workspace_id)
        .maybeSingle();
      targetChatId = (settings as any)?.telegram_chat_id;
    }
    if (!targetChatId) throw new Error("No Telegram chat_id configured");

    // Fetch latest pipeline run
    const { data: pipelineRun } = await supabase
      .from("agent_runs")
      .select("output_payload, completed_at")
      .eq("workspace_id", workspace_id)
      .eq("agent_name", "intelligence_pipeline")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!pipelineRun) {
      return new Response(JSON.stringify({ sent: false, reason: "No pipeline run found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const p = pipelineRun.output_payload as any;
    const alertLevel = p.catalog_priority >= 60 ? "🔴" : p.catalog_priority >= 30 ? "🟡" : "🟢";

    // Build message
    const lines: string[] = [
      `${alertLevel} <b>Relatório de Inteligência do Catálogo</b>`,
      "",
      `📊 <b>Saúde:</b> ${Math.max(0, 100 - (p.catalog_priority || 0))}%`,
      `⚠️ <b>Issues:</b> ${p.catalog_issues || 0}`,
      `🔍 <b>Oportunidades Procura:</b> ${p.demand_opportunities || 0}`,
      `💰 <b>Oportunidades Receita:</b> ${p.revenue_opportunities || 0}`,
    ];

    if (p.estimated_revenue > 0) {
      lines.push(`💶 <b>Receita Estimada:</b> €${Math.round(p.estimated_revenue).toLocaleString()}`);
    }

    // Fetch high-severity issues
    const { data: catalogRun } = await supabase
      .from("agent_runs")
      .select("output_payload")
      .eq("workspace_id", workspace_id)
      .eq("agent_name", "catalog_intelligence")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const issues = (catalogRun?.output_payload as any)?.issues_found || [];
    const highIssues = issues.filter((i: any) => i.severity === "high").slice(0, 3);
    if (highIssues.length > 0) {
      lines.push("", "🚨 <b>Issues Críticas:</b>");
      for (const issue of highIssues) {
        lines.push(`• ${issue.detail?.substring(0, 100)}`);
      }
    }

    lines.push("", `🕐 ${new Date(pipelineRun.completed_at || Date.now()).toLocaleString("pt-PT")}`);

    const text = lines.join("\n");

    // Send via Telegram Gateway
    const response = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: targetChatId,
        text,
        parse_mode: "HTML",
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Telegram API call failed [${response.status}]: ${JSON.stringify(data)}`);
    }

    return new Response(JSON.stringify({ sent: true, message_id: data.result?.message_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Telegram alert error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
