// supabase/functions/resolve-ai-route/index.ts
// Thin HTTP wrapper (~80 lines). All AI logic lives in _shared/ai/.
// HTTP contract is identical to the previous implementation (backward compatible).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runPrompt } from "../_shared/ai/prompt-runner.ts";
import { mapTaskTypeToCapability } from "../_shared/ai/capability-matrix.ts";
import { toLegacyResponse } from "./legacy-compat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { taskType, workspaceId, messages, systemPrompt, options, modelOverride, providerOverride } =
      await req.json();
    if (!taskType || !workspaceId) throw new Error("taskType and workspaceId required");

    // Resolve system prompt from prompt_templates/prompt_versions if a routing rule
    // specifies one. Checks workspace-specific rule first, then global (workspace_id IS NULL).
    const { text: resolvedPrompt, versionId: promptVersionId } = await resolvePromptTemplate(
      supabase,
      workspaceId,
      taskType,
      systemPrompt,
    );

    const { result, meta } = await runPrompt(supabase, {
      workspaceId,
      capability: mapTaskTypeToCapability(taskType),
      taskType,
      systemPrompt: resolvedPrompt,
      messages,
      temperature: options?.temperature,
      maxTokens: options?.max_tokens,
      jsonMode: !!options?.response_format,
      modelOverride,
      providerOverride,
      tools: options?.tools,
      toolChoice: options?.tool_choice,
      promptVersionId: promptVersionId ?? undefined,
      modalities: options?.modalities,
    });

    return new Response(
      JSON.stringify({
        result: toLegacyResponse(result),
        meta: {
          usedProvider: meta.provider,
          usedModel: meta.model,
          fallbackUsed: meta.fallbackUsed,
          requestedModel: meta.requestedModel ?? null,
          fallbackReason: meta.fallbackReason ?? null,
          attemptedProviders: meta.attemptedProviders,
          attemptedModels: meta.attemptedModels,
          errorCategory: meta.errorCategory ?? null,
          decisionSource: meta.decisionSource,
          latencyMs: meta.latencyMs,
          taskType,
          promptVersionId: promptVersionId ?? null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const details = error instanceof Error && error.stack ? error.stack.split("\n").slice(0, 3).join("\n") : null;
    return new Response(JSON.stringify({ error: message, details }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Resolves the system prompt via prompt_templates / prompt_versions.
// Precedence: workspace-specific active version > global active version >
//             base_prompt from template > caller's systemPrompt.
// Returns { text, versionId, promptSource } for full transparency.
async function resolvePromptTemplate(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  taskType: string,
  fallbackPrompt: string,
): Promise<{ text: string; versionId: string | null; promptSource: string }> {
  try {
    // 1. Workspace-specific rule
    const { data: wsRule } = await supabase
      .from("ai_routing_rules")
      .select("id, prompt_template_id, prompt:prompt_template_id(id, prompt_name, base_prompt)")
      .eq("workspace_id", workspaceId)
      .eq("task_type", taskType)
      .eq("is_active", true)
      .maybeSingle();

    // 2. Global rule (workspace_id IS NULL) — checked only if no workspace rule found
    const { data: globalRule } = wsRule?.prompt_template_id
      ? { data: null }
      : await supabase
          .from("ai_routing_rules")
          .select("id, prompt_template_id, prompt:prompt_template_id(id, prompt_name, base_prompt)")
          .is("workspace_id", null)
          .eq("task_type", taskType)
          .eq("is_active", true)
          .maybeSingle();

    const rule = wsRule?.prompt_template_id ? wsRule : globalRule;
    const ruleScope = wsRule?.prompt_template_id ? "workspace" : (globalRule ? "global" : "none");

    if (rule?.prompt_template_id) {
      const promptMeta = rule.prompt as { id?: string; prompt_name?: string; base_prompt?: string } | null;
      const templateName = promptMeta?.prompt_name || "unknown";

      const { data: version } = await supabase
        .from("prompt_versions")
        .select("id, prompt_text, version_number")
        .eq("template_id", rule.prompt_template_id)
        .eq("is_active", true)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (version?.prompt_text) {
        const source = `db_version (${ruleScope} rule → template "${templateName}" → version v${version.version_number})`;
        console.log(`🟢 [prompt-governance] task="${taskType}" → SOURCE: ${source}`);
        return { text: version.prompt_text, versionId: version.id as string, promptSource: source };
      }

      const basePrompt = promptMeta?.base_prompt;
      if (basePrompt) {
        const source = `db_base_prompt (${ruleScope} rule → template "${templateName}" base_prompt)`;
        console.log(`🟡 [prompt-governance] task="${taskType}" → SOURCE: ${source} (no active version found)`);
        return { text: basePrompt, versionId: null, promptSource: source };
      }
    }
  } catch (err) {
    console.warn(`⚠️ [prompt-governance] DB lookup failed for task="${taskType}": ${err instanceof Error ? err.message : err}`);
  }

  const source = "hardcoded_fallback (no DB template/rule found)";
  console.log(`🔴 [prompt-governance] task="${taskType}" → SOURCE: ${source}`);
  return { text: fallbackPrompt || "", versionId: null, promptSource: source };
}
