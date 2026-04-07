import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { taskId } = await req.json();
    if (!taskId) throw new Error("taskId required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: task, error } = await supabase
      .from("agent_tasks")
      .select("*, catalog_agents(*)")
      .eq("id", taskId)
      .single();
    if (error || !task) throw new Error("Task not found");

    // Mark as running
    await supabase.from("agent_tasks").update({ status: "running", started_at: new Date().toISOString() }).eq("id", taskId);

    const productId = task.payload?.product_id;
    let result: any = { success: true };

    try {
      // Check publish locks
      if (productId) {
        const { data: locks } = await supabase
          .from("publish_locks").select("id").eq("product_id", productId).eq("is_active", true);
        if (locks?.length) throw new Error("Product is locked by publish_locks");
      }

      // Check policies
      const { data: policies } = await supabase
        .from("agent_policies").select("*")
        .eq("workspace_id", task.workspace_id)
        .eq("agent_type", task.catalog_agents?.agent_type);

      const requiresApproval = policies?.some((p: any) => p.requires_approval) ?? true;

      // Load product data if needed
      let product: any = null;
      if (productId) {
        const { data } = await supabase.from("products")
          .select("id, sku, original_title, optimized_title, optimized_description, optimized_short_description, meta_title, meta_description, seo_slug, category, attributes, tags, image_urls, original_price, optimized_price, technical_specs")
          .eq("id", productId).single();
        product = data;
      }

      // Execute based on task type with real AI
      switch (task.task_type) {
        case "update_seo_fields":
          result = await executeSeoOptimization(supabase, task, product, requiresApproval);
          break;

        case "fix_completeness":
          result = await executeAttributeCompletion(supabase, task, product, requiresApproval);
          break;

        case "update_title":
          result = await executeTitleOptimization(supabase, task, product, requiresApproval);
          break;

        case "update_description":
          result = await executeDescriptionOptimization(supabase, task, product, requiresApproval);
          break;

        case "create_bundle":
          result = { bundle_suggestion_recorded: true };
          break;

        default:
          result = { task_type: task.task_type, status: "recorded" };
      }

      // Log action
      await supabase.from("agent_actions").insert({
        workspace_id: task.workspace_id,
        agent_id: task.agent_id,
        product_id: productId,
        action_type: mapTaskToAction(task.task_type),
        action_payload: task.payload,
        action_result: result,
        confidence: result.confidence || 70,
        approved_by_user: !requiresApproval,
      });

      await supabase.from("agent_tasks").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        result,
      }).eq("id", taskId);

      // Learn from decision
      await supabase.from("agent_decision_memory").insert({
        workspace_id: task.workspace_id,
        agent_type: task.catalog_agents?.agent_type,
        decision_context: { task_type: task.task_type, product_id: productId },
        decision_action: result,
        confidence: result.confidence || 70,
        approved: !requiresApproval,
      });

    } catch (execErr: any) {
      await supabase.from("agent_tasks").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: execErr.message,
      }).eq("id", taskId);
      result = { error: execErr.message };
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// ─── AI-Powered Task Executors ───

async function callAI(supabase: any, workspaceId: string, taskType: string, systemPrompt: string, userMessage: string) {
  const { data, error } = await supabase.functions.invoke("resolve-ai-route", {
    body: {
      taskType,
      workspaceId,
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      options: { response_format: { type: "json_object" }, temperature: 0.3 },
    },
  });
  if (error) throw new Error(`AI call failed: ${error.message}`);
  if (data?.error) throw new Error(`AI error: ${data.error}`);

  // Parse JSON from AI response
  const text = data?.result?.content || data?.choices?.[0]?.message?.content || data?.content || "";
  try {
    return JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
  } catch {
    return { raw_response: text };
  }
}

async function executeSeoOptimization(supabase: any, task: any, product: any, requiresApproval: boolean) {
  if (!product) return { error: "Product not found" };

  const systemPrompt = `Otimiza SEO para produtos HORECA em português europeu. Responde APENAS em JSON com as chaves: meta_title (max 60 chars), meta_description (max 160 chars), seo_slug, focus_keywords (array de 3-5 keywords). Mantém terminologia técnica do setor.`;

  const userMessage = `Produto: ${product.optimized_title || product.original_title}
Categoria: ${product.category || "N/A"}
Descrição: ${(product.optimized_description || product.optimized_short_description || "").substring(0, 500)}
Especificações: ${(product.technical_specs || "").substring(0, 300)}
SKU: ${product.sku || "N/A"}`;

  const aiResult = await callAI(supabase, task.workspace_id, "seo_optimization", systemPrompt, userMessage);

  if (aiResult.meta_title && !requiresApproval) {
    await supabase.from("products").update({
      meta_title: aiResult.meta_title,
      meta_description: aiResult.meta_description,
      seo_slug: aiResult.seo_slug,
      focus_keyword: aiResult.focus_keywords,
    }).eq("id", product.id);
  }

  // Store recommendation
  await supabase.from("seo_recommendations").insert({
    workspace_id: task.workspace_id,
    product_id: product.id,
    recommended_title: aiResult.meta_title,
    recommended_meta_description: aiResult.meta_description,
    recommended_slug: aiResult.seo_slug,
    confidence: 0.85,
    status: requiresApproval ? "pending" : "applied",
  }).catch(() => {});

  return { applied: !requiresApproval, confidence: 85, seo: aiResult };
}

async function executeAttributeCompletion(supabase: any, task: any, product: any, requiresApproval: boolean) {
  if (!product) return { error: "Product not found" };

  const currentAttrs = product.attributes || {};

  const systemPrompt = `Completa atributos técnicos de produtos HORECA. Responde APENAS em JSON com a chave "attributes" contendo um objeto com atributos técnicos relevantes (material, dimensões, capacidade, voltagem, peso, etc.). Usa unidades métricas. Português europeu.`;

  const userMessage = `Produto: ${product.optimized_title || product.original_title}
Categoria: ${product.category || "N/A"}
Atributos atuais: ${JSON.stringify(currentAttrs).substring(0, 500)}
Especificações: ${(product.technical_specs || "").substring(0, 500)}`;

  const aiResult = await callAI(supabase, task.workspace_id, "attribute_extraction", systemPrompt, userMessage);

  if (aiResult.attributes && !requiresApproval) {
    const merged = { ...currentAttrs, ...aiResult.attributes };
    await supabase.from("products").update({ attributes: merged }).eq("id", product.id);
  }

  return { applied: !requiresApproval, confidence: 80, new_attributes: aiResult.attributes || {}, merged: !requiresApproval };
}

async function executeTitleOptimization(supabase: any, task: any, product: any, requiresApproval: boolean) {
  if (!product) return { error: "Product not found" };

  const systemPrompt = `Otimiza títulos de produtos HORECA para SEO e conversão. Responde APENAS em JSON: { "optimized_title": "...", "reasoning": "..." }. Max 80 chars. Português europeu. Inclui marca, modelo e característica principal.`;

  const userMessage = `Título original: ${product.original_title || "N/A"}
Título atual otimizado: ${product.optimized_title || "N/A"}
Categoria: ${product.category || "N/A"}
SKU: ${product.sku || "N/A"}`;

  const aiResult = await callAI(supabase, task.workspace_id, "content_generation", systemPrompt, userMessage);

  if (aiResult.optimized_title && !requiresApproval) {
    await supabase.from("products").update({ optimized_title: aiResult.optimized_title }).eq("id", product.id);
  }

  return { applied: !requiresApproval, confidence: 82, title: aiResult.optimized_title, reasoning: aiResult.reasoning };
}

async function executeDescriptionOptimization(supabase: any, task: any, product: any, requiresApproval: boolean) {
  if (!product) return { error: "Product not found" };

  const systemPrompt = `Gera descrição otimizada para produto HORECA. Responde APENAS em JSON: { "optimized_description": "...", "optimized_short_description": "..." }. Descrição longa: 150-300 palavras, com benefícios, especificações e uso profissional. Descrição curta: 2-3 frases. Português europeu. Formato HTML básico permitido (<p>, <ul>, <li>, <strong>).`;

  const userMessage = `Produto: ${product.optimized_title || product.original_title}
Categoria: ${product.category || "N/A"}
Descrição original: ${(product.optimized_description || product.optimized_short_description || "").substring(0, 600)}
Especificações: ${(product.technical_specs || "").substring(0, 400)}
Atributos: ${JSON.stringify(product.attributes || {}).substring(0, 300)}`;

  const aiResult = await callAI(supabase, task.workspace_id, "content_generation", systemPrompt, userMessage);

  if (aiResult.optimized_description && !requiresApproval) {
    await supabase.from("products").update({
      optimized_description: aiResult.optimized_description,
      optimized_short_description: aiResult.optimized_short_description,
    }).eq("id", product.id);
  }

  return { applied: !requiresApproval, confidence: 80, description_length: (aiResult.optimized_description || "").length };
}

function mapTaskToAction(taskType: string): string {
  const map: Record<string, string> = {
    update_seo_fields: "update_seo_fields",
    create_bundle: "create_bundle",
    update_title: "update_title",
    update_description: "update_description",
    fix_completeness: "update_attributes",
  };
  return map[taskType] || "update_attributes";
}
