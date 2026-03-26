// supabase/functions/_shared/ai/fallback-policy_test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { executeWithFallback } from "./fallback-policy.ts";
import type { ProviderConfig, InvokeResult } from "./provider-types.ts";
import { ProviderError } from "./invoke-provider.ts";

const mockProvider = (id: string): ProviderConfig => ({
  id, displayName: id, format: "openai_compatible",
  apiBaseUrl: "", apiKeyEnvVar: "FAKE_KEY",
  authScheme: "bearer", enabled: true, isLegacy: false, priority: 1,
});

const baseParams = { systemPrompt: "test", messages: [] as never[] };

function makeResult(provider: string, model: string): InvokeResult {
  return {
    content: `ok from ${provider}`,
    finishReason: "stop",
    inputTokens: 10, outputTokens: 5,
    provider, model, latencyMs: 50,
    rawResponse: {},
    normalizedResponse: {
      choices: [{ message: { role: "assistant", content: `ok from ${provider}` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model,
    },
  };
}

Deno.test("executeWithFallback: succeeds on first provider", async () => {
  let callCount = 0;
  const result = await executeWithFallback(
    [{ provider: mockProvider("p1"), model: "m1" }],
    baseParams,
    async (_p, _m) => { callCount++; return makeResult("p1", "m1"); },
    { maxAttempts: 1, baseDelayMs: 0, backoffMultiplier: 1 },
  );
  assertEquals(result.fallbackUsed, false);
  assertEquals(result.provider, "p1");
  assertEquals(callCount, 1);
});

Deno.test("executeWithFallback: falls back when first provider throws auth_error", async () => {
  const calls: string[] = [];
  const result = await executeWithFallback(
    [{ provider: mockProvider("p1"), model: "m1" }, { provider: mockProvider("p2"), model: "m2" }],
    baseParams,
    async (p, _m) => {
      calls.push(p.id);
      if (p.id === "p1") throw new ProviderError("auth failed", "auth_error");
      return makeResult("p2", "m2");
    },
    { maxAttempts: 2, baseDelayMs: 0, backoffMultiplier: 1 },
  );
  assertEquals(result.fallbackUsed, true);
  assertEquals(result.provider, "p2");
  // auth_error is not retried — p1 attempted exactly once, then p2
  assertEquals(calls, ["p1", "p2"]);
});

Deno.test("executeWithFallback: retries rate_limit before moving to fallback", async () => {
  const calls: string[] = [];
  const result = await executeWithFallback(
    [{ provider: mockProvider("p1"), model: "m1" }, { provider: mockProvider("p2"), model: "m2" }],
    baseParams,
    async (p, _m) => {
      calls.push(p.id);
      if (p.id === "p1") throw new ProviderError("rate limited", "rate_limit");
      return makeResult("p2", "m2");
    },
    { maxAttempts: 2, baseDelayMs: 0, backoffMultiplier: 1 },
  );
  // p1 attempted 2 times (maxAttempts), then p2
  assertEquals(calls, ["p1", "p1", "p2"]);
  assertEquals(result.fallbackUsed, true);
});

Deno.test("executeWithFallback: throws when all providers fail", async () => {
  await assertRejects(
    () => executeWithFallback(
      [{ provider: mockProvider("p1"), model: "m1" }],
      baseParams,
      async () => { throw new ProviderError("always fails", "auth_error"); },
      { maxAttempts: 1, baseDelayMs: 0, backoffMultiplier: 1 },
    ),
    Error,
    "All providers failed",
  );
});

Deno.test("executeWithFallback: errorCategories populated on fallback", async () => {
  const result = await executeWithFallback(
    [{ provider: mockProvider("p1"), model: "m1" }, { provider: mockProvider("p2"), model: "m2" }],
    baseParams,
    async (p, _m) => {
      if (p.id === "p1") throw new ProviderError("rate limited", "rate_limit");
      return makeResult("p2", "m2");
    },
    { maxAttempts: 1, baseDelayMs: 0, backoffMultiplier: 1 },
  );
  assertEquals(result.errorCategories.length, 1);
  assertEquals(result.errorCategories[0], { provider: "p1", category: "rate_limit" });
});
