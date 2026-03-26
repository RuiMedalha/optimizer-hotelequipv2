// supabase/functions/resolve-ai-route/legacy-compat.ts
// Converts InvokeResult → OpenAI-format response object.
// All existing callers receive the same shape they always have.
// This is the only file that knows about the old response contract.
import type { InvokeResult } from "../_shared/ai/provider-types.ts";

export function toLegacyResponse(result: InvokeResult): unknown {
  return result.normalizedResponse;
}
