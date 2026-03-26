// supabase/functions/_shared/ai/fallback-policy.ts
// Retry (same provider) and fallback (next provider) are separated concerns.
//
// Design note: spec defines executeWithFallback without an invokeFn parameter.
// An explicit invokeFn parameter is added here to enable unit testing with
// mock providers. Production callers (prompt-runner.ts) pass the real invokeProvider.
import type { InvokeParams, InvokeResult, ProviderConfig, RetryConfig, ErrorCategory } from "./provider-types.ts";
import { isRetryable } from "./error-classifier.ts";
import { ProviderError } from "./invoke-provider.ts";

export type InvokeFn = (
  provider: ProviderConfig,
  model: string,
  params: Omit<InvokeParams, "provider" | "model">,
) => Promise<InvokeResult>;

const DEFAULT_RETRY: RetryConfig = { maxAttempts: 2, baseDelayMs: 500, backoffMultiplier: 2 };

export async function executeWithFallback(
  chain: Array<{ provider: ProviderConfig; model: string }>,
  baseParams: Omit<InvokeParams, "provider" | "model">,
  invokeFn: InvokeFn,
  retryConfig: RetryConfig = DEFAULT_RETRY,
): Promise<InvokeResult & {
  fallbackUsed: boolean;
  attemptedProviders: string[];
  attemptedModels: string[];
  errorCategories: Array<{ provider: string; category: ErrorCategory }>;
  errorMessages: Array<{ provider: string; message: string }>;
}> {
  const attemptedProviders: string[] = [];
  const attemptedModels: string[] = [];
  const errorCategories: Array<{ provider: string; category: ErrorCategory }> = [];
  const errorMessages: Array<{ provider: string; message: string }> = [];

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];
    attemptedProviders.push(provider.id);
    attemptedModels.push(model);

    let lastCategory: ErrorCategory = "unknown_error";
    let lastMessage = "unknown error";

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await invokeFn(provider, model, baseParams);
        return {
          ...result,
          fallbackUsed: i > 0,
          attemptedProviders,
          attemptedModels,
          errorCategories,
          errorMessages,
        };
      } catch (err) {
        const category = err instanceof ProviderError ? err.category : "unknown_error";
        const message = err instanceof Error ? err.message : String(err);
        lastCategory = category;
        lastMessage = message;

        console.error(`[fallback-policy] ${provider.id}/${model} attempt ${attempt} failed: ${message}`);

        // Non-retryable: skip remaining attempts for this provider immediately
        if (!isRetryable(category)) break;

        if (attempt < retryConfig.maxAttempts) {
          const delay = retryConfig.baseDelayMs *
            Math.pow(retryConfig.backoffMultiplier, attempt - 1);
          await sleep(delay);
        }
      }
    }

    errorCategories.push({ provider: provider.id, category: lastCategory });
    errorMessages.push({ provider: provider.id, message: lastMessage });
    if (i < chain.length - 1) {
      const next = chain[i + 1];
      console.warn(
        `[fallback-policy] Falling back from ${provider.id}/${model} to ${next.provider.id}/${next.model} due to ${lastCategory}: ${lastMessage}`,
      );
    }
  }

  const errorDetail = errorMessages
    .map((e) => `${e.provider}: ${e.message}`)
    .join(" | ");

  throw new Error(
    `All providers failed. Attempted: ${attemptedProviders.join(", ")}. ` +
      `Errors: ${errorDetail}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
