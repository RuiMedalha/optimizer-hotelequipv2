// supabase/functions/_shared/ai/prompt-runner.ts
// Single entry point for all AI calls in edge functions.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InvokeParams, InvokeResult, RunMeta, RunPromptParams } from "./provider-types.ts";
import { resolveRoute } from "./provider-registry.ts";
import { executeWithFallback } from "./fallback-policy.ts";
import { invokeProvider } from "./invoke-provider.ts";
import { logUsage } from "./usage-logger.ts";
import { getModel, estimateCost } from "./model-catalog.ts";

export async function runPrompt(
  supabase: SupabaseClient,
  params: RunPromptParams,
): Promise<{ result: InvokeResult; meta: RunMeta }> {
  // Feature flag: kill-switch
  if (Deno.env.get("AI_ROUTER_ENABLED") === "false") {
    throw new Error("AI router disabled (AI_ROUTER_ENABLED=false)");
  }

  const shadowMode = Deno.env.get("AI_ROUTER_SHADOW_MODE") === "true";

  const route = await resolveRoute(supabase, params);
  const { selectedProvider, selectedModel, fallbackChain, finalParams } = route;

  // Strict mode: when modelOverride is provided, do not fallback silently.
  // If the requested provider/model fails, return an error instead of using a different model.
  const strictMode = !!params.modelOverride;
  const chain = strictMode
    ? [{ provider: selectedProvider, model: selectedModel }]
    : [
        { provider: selectedProvider, model: selectedModel },
        ...fallbackChain,
      ];

  if (params.taskType === "product_optimization") {
    console.log(
      `[prompt-runner] product_optimization chain: ${chain.map((c) => `${c.provider.id}/${c.model}`).join(" -> ")}`,
    );
  }

  if (strictMode) {
    console.log(`[prompt-runner] Strict mode: modelOverride="${params.modelOverride}" — fallback disabled, using ${selectedProvider.id}/${selectedModel} only`);
  }

  // Build the base invoke params, merging workspace preferences (finalParams) as defaults
  const baseInvokeParams: Omit<InvokeParams, "provider" | "model"> = {
    systemPrompt: params.systemPrompt,
    messages: (
      params.messages ??
      (params.userPrompt ? [{ role: "user" as const, content: params.userPrompt }] : [])
    ) as InvokeParams["messages"],
    temperature: params.temperature ?? finalParams.temperature,
    maxTokens: params.maxTokens ?? finalParams.maxTokens,
    jsonMode: params.jsonMode ?? finalParams.jsonMode,
    tools: params.tools,
    toolChoice: params.toolChoice,
    modalities: params.modalities,
  };

  const invokeFn = (
    provider: typeof selectedProvider,
    model: string,
    p: typeof baseInvokeParams,
  ) => invokeProvider({ provider, model, ...p });

  const raw = await executeWithFallback(
    chain,
    baseInvokeParams,
    invokeFn,
    params.taskType === "product_optimization"
      ? { maxAttempts: 2, baseDelayMs: 500, backoffMultiplier: 2 }
      : undefined,
  );

  // Cost estimation — DB-first with static fallback
  const modelConfig = await getModel(supabase, raw.provider, raw.model);
  const estimatedCostUsd = estimateCost(modelConfig, raw.inputTokens, raw.outputTokens);

  // Surface the last error category encountered (present when fallback was used)
  const lastErrorCategory = raw.errorCategories.length > 0
    ? raw.errorCategories[raw.errorCategories.length - 1].category
    : undefined;

  // Build detailed fallback reason from actual provider errors
  let fallbackReason: string | undefined;
  if (raw.fallbackUsed && raw.errorMessages.length > 0) {
    fallbackReason = raw.errorMessages
      .map((e) => `${e.provider}: ${e.message}`)
      .join(" → ");
  } else if (raw.fallbackUsed) {
    fallbackReason = "primary_provider_failed";
  }

  if (raw.fallbackUsed) {
    console.warn(`[prompt-runner] Fallback used: requested=${params.modelOverride ?? selectedModel}, used=${raw.model}. Reason: ${fallbackReason}`);
  }

  const meta: RunMeta = {
    provider: raw.provider,
    model: raw.model,
    fallbackUsed: raw.fallbackUsed,
    requestedModel: params.modelOverride ?? undefined,
    fallbackReason,
    attemptedProviders: raw.attemptedProviders,
    attemptedModels: raw.attemptedModels,
    decisionSource: route.decisionSource,
    errorCategory: lastErrorCategory,
    latencyMs: raw.latencyMs,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd,
    shadowMode,
  };

  // Fire-and-forget — never awaited, never throws to caller
  logUsage(supabase, {
    workspaceId: params.workspaceId,
    taskType: params.taskType,
    capability: params.capability,
    provider: raw.provider,
    model: raw.model,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd,
    fallbackUsed: raw.fallbackUsed,
    decisionSource: route.decisionSource,
    latencyMs: raw.latencyMs,
    errorCategory: meta.errorCategory,
    isShadow: shadowMode,
    promptVersionId: params.promptVersionId,
  });

  // Shadow mode: result is returned but callers must check meta.shadowMode
  // before persisting to business state
  return { result: raw, meta };
}
