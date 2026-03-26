// supabase/functions/_shared/ai/error-classifier_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyError, isRetryable } from "./error-classifier.ts";

Deno.test("classifyError: 401 → auth_error", () => {
  assertEquals(classifyError(401, "", "openai"), "auth_error");
});
Deno.test("classifyError: 403 → auth_error", () => {
  assertEquals(classifyError(403, "", "openai"), "auth_error");
});
Deno.test("classifyError: 429 → rate_limit", () => {
  assertEquals(classifyError(429, "", "openai"), "rate_limit");
});
Deno.test("classifyError: 503 → provider_overload", () => {
  assertEquals(classifyError(503, "", "openai"), "provider_overload");
});
Deno.test("classifyError: 529 → provider_overload", () => {
  assertEquals(classifyError(529, "", "anthropic"), "provider_overload");
});
Deno.test("classifyError: 400 → invalid_request", () => {
  assertEquals(classifyError(400, "", "openai"), "invalid_request");
});
Deno.test("classifyError: unknown status → unknown_error", () => {
  assertEquals(classifyError(418, "", "openai"), "unknown_error");
});
Deno.test("classifyError: network (status 0) → network_error", () => {
  assertEquals(classifyError(0, "", "openai"), "network_error");
});
Deno.test("classifyError: body contains content_filter → policy_error", () => {
  assertEquals(classifyError(400, '{"error":{"code":"content_filter"}}', "openai"), "policy_error");
});
Deno.test("isRetryable: rate_limit → true", () => {
  assertEquals(isRetryable("rate_limit"), true);
});
Deno.test("isRetryable: provider_overload → true", () => {
  assertEquals(isRetryable("provider_overload"), true);
});
Deno.test("isRetryable: network_error → true", () => {
  assertEquals(isRetryable("network_error"), true);
});
Deno.test("isRetryable: auth_error → false", () => {
  assertEquals(isRetryable("auth_error"), false);
});
Deno.test("isRetryable: policy_error → false", () => {
  assertEquals(isRetryable("policy_error"), false);
});
Deno.test("isRetryable: invalid_request → false", () => {
  assertEquals(isRetryable("invalid_request"), false);
});
Deno.test("isRetryable: parse_error → false", () => {
  assertEquals(isRetryable("parse_error"), false);
});
Deno.test("isRetryable: unknown_error → false", () => {
  assertEquals(isRetryable("unknown_error"), false);
});
