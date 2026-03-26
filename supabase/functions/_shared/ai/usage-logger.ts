// supabase/functions/_shared/ai/usage-logger.ts
// Fire-and-forget. Never throws. Errors are console.warn'd, not propagated.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { UsageLogEntry } from "./provider-types.ts";

export async function logUsage(
  supabase: SupabaseClient,
  entry: UsageLogEntry,
): Promise<void> {
  try {
    const { error } = await supabase.from("ai_usage_logs").insert({
      workspace_id: entry.workspaceId,
      task_type: entry.taskType ?? null,
      capability: entry.capability,
      provider_id: entry.provider,
      model_name: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      estimated_cost: entry.estimatedCostUsd,
      fallback_used: entry.fallbackUsed,
      decision_source: entry.decisionSource,
      latency_ms: entry.latencyMs,
      error_category: entry.errorCategory ?? null,
      is_shadow: entry.isShadow,
      prompt_version_id: entry.promptVersionId ?? null,
    });
    if (error) {
      console.warn("[usage-logger] Failed to log usage:", error.message);
    }
  } catch (err) {
    console.warn("[usage-logger] Unexpected error:", err);
  }
}
