// supabase/functions/_shared/ai/error-classifier.ts
import type { ErrorCategory } from "./provider-types.ts";

export function classifyError(
  status: number,
  responseBody: string,
  _providerId: string,
): ErrorCategory {
  if (status === 0) return "network_error";
  if (status === 401 || status === 403) return "auth_error";
  if (status === 429) return "rate_limit";
  if (status === 503 || status === 529) return "provider_overload";
  if (status === 451) return "policy_error";
  if (status === 400) {
    if (responseBody.includes("content_filter") || responseBody.includes("safety")) {
      return "policy_error";
    }
    return "invalid_request";
  }
  if (status === 500 && responseBody.includes("overloaded")) return "provider_overload";
  if (status >= 500) return "provider_overload";
  if (status >= 400) return "unknown_error";
  return "unknown_error";
}

export function classifyNetworkError(_err: unknown): ErrorCategory {
  return "network_error";
}

export function isRetryable(category: ErrorCategory): boolean {
  return category === "rate_limit" ||
    category === "provider_overload" ||
    category === "network_error";
}
