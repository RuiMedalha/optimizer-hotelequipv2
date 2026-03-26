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
// Returns { text, versionId } — versionId is null when falling back to
// base_prompt or the caller's hardcoded systemPrompt.
async function resolvePromptTemplate(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  taskType: string,
  fallbackPrompt: string,
): Promise<{ text: string; versionId: string | null }> {
  try {
    // 1. Workspace-specific rule
    const { data: wsRule } = await supabase
      .from("ai_routing_rules")
      .select("prompt_template_id, prompt:prompt_template_id(base_prompt)")
      .eq("workspace_id", workspaceId)
      .eq("task_type", taskType)
      .eq("is_active", true)
      .maybeSingle();

    // 2. Global rule (workspace_id IS NULL) — checked only if no workspace rule found
    const { data: globalRule } = wsRule?.prompt_template_id
      ? { data: null }
      : await supabase
          .from("ai_routing_rules")
          .select("prompt_template_id, prompt:prompt_template_id(base_prompt)")
          .is("workspace_id", null)
          .eq("task_type", taskType)
          .eq("is_active", true)
          .maybeSingle();

    const rule = wsRule?.prompt_template_id ? wsRule : globalRule;

    if (rule?.prompt_template_id) {
      const { data: version } = await supabase
        .from("prompt_versions")
        .select("id, prompt_text")
        .eq("template_id", rule.prompt_template_id)
        .eq("is_active", true)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (version?.prompt_text) {
        console.log(`[resolve-ai-route] Using DB prompt version ${version.id} for task "${taskType}" (workspace: ${workspaceId}). Caller prompt overridden.`);
        return { text: version.prompt_text, versionId: version.id as string };
      }

      const basePrompt = (rule.prompt as { base_prompt?: string } | null)?.base_prompt;
      if (basePrompt) {
        console.log(`[resolve-ai-route] Using base_prompt from template for task "${taskType}" (workspace: ${workspaceId}). No active version found.`);
        return { text: basePrompt, versionId: null };
      }
    }
  } catch {
    /* no rule or template — use caller's prompt */
  }

  console.log(`[resolve-ai-route] No DB prompt found for task "${taskType}" (workspace: ${workspaceId}). Using caller's hardcoded prompt.`);
  return { text: fallbackPrompt || "", versionId: null };
}
