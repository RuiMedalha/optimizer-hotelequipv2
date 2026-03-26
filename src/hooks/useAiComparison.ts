// src/hooks/useAiComparison.ts
// Hooks and utilities for the AI model comparison engine.
// Tables: ai_comparison_runs, ai_comparison_results (not in generated types — use as any).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import type { Product } from "@/hooks/useProducts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComparisonRun {
  id: string;
  workspace_id: string;
  created_by: string;
  product_ids: string[];
  model_ids: string[];
  sections: string[];
  product_count: number;
  model_count: number;
  status: "running" | "completed" | "cancelled" | "failed" | "partial";
  error_message?: string | null;
  created_at: string;
  completed_at: string | null;
  applications_count?: [{ count: number }] | null;
}

export interface ComparisonResult {
  id: string;
  run_id: string;
  product_id: string;
  model_id: string;
  provider_id: string;
  section: string;
  output_text: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  latency_ms: number;
  score: number | null;
  selected: boolean;
  created_at: string;
}

export type ComparisonSection =
  | "title"
  | "short_description"
  | "description"
  | "seo_title"
  | "meta_description";

export const COMPARISON_SECTIONS: {
  id: ComparisonSection;
  label: string;
  productField: string;
}[] = [
  { id: "title",             label: "Título",          productField: "optimized_title" },
  { id: "short_description", label: "Descrição curta", productField: "optimized_short_description" },
  { id: "description",       label: "Descrição",       productField: "optimized_description" },
  { id: "seo_title",         label: "Título SEO",      productField: "meta_title" },
  { id: "meta_description",  label: "Meta descrição",  productField: "meta_description" },
];

// ── Create run ────────────────────────────────────────────────────────────────

export function useCreateComparisonRun() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productIds,
      modelIds,
      sections,
    }: {
      productIds: string[];
      modelIds: string[];
      sections: string[];
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("ai_comparison_runs" as any)
        .insert({
          workspace_id:  activeWorkspace!.id,
          created_by:    user.id,
          product_ids:   productIds,
          model_ids:     modelIds,
          sections,
          product_count: productIds.length,
          model_count:   modelIds.length,
          status:        "running",
        })
        .select()
        .single();

      if (error) throw error;
      return data as unknown as ComparisonRun;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparison-runs"], exact: false }),
  });
}

// ── Execute comparison (batched frontend orchestration) ────────────────────────

const BATCH_CONCURRENCY = 3;

export async function executeComparison({
  runId,
  productIds,
  modelIds,
  sections,
  workspaceId,
  onProgress,
}: {
  runId: string;
  productIds: string[];
  modelIds: string[];
  sections: string[];
  workspaceId: string;
  onProgress?: (completed: number, total: number) => void;
}) {
  const combinations = productIds.flatMap((pid) =>
    modelIds.map((mid) => ({ productId: pid, modelId: mid }))
  );

  const total = combinations.length;
  let completed = 0;

  for (let i = 0; i < combinations.length; i += BATCH_CONCURRENCY) {
    const batch = combinations.slice(i, i + BATCH_CONCURRENCY);
    // Use a local counter per batch to avoid race conditions
    const batchResults = await Promise.allSettled(
      batch.map(({ productId, modelId }) =>
        supabase.functions.invoke("run-ai-comparison", {
          body: { runId, productId, modelId, sections, workspaceId },
        })
      )
    );
    completed += batchResults.length;
    onProgress?.(completed, total);

    for (const result of batchResults) {
      if (result.status === "rejected") {
        console.error("[executeComparison] batch item failed:", result.reason);
      }
    }
  }
}

// ── Mark run completed ────────────────────────────────────────────────────────

export function useCompleteComparisonRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase
        .from("ai_comparison_runs" as any)
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparison-runs"], exact: false }),
  });
}

// ── Mark run failed ───────────────────────────────────────────────────────────

export function useFailComparisonRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, errorMessage }: { runId: string; errorMessage: string }) => {
      const { error } = await supabase
        .from("ai_comparison_runs" as any)
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparison-runs"], exact: false }),
  });
}

// ── Fetch results for a run ───────────────────────────────────────────────────

export function useComparisonResults(runId: string | null) {
  return useQuery({
    queryKey: ["comparison-results", runId],
    enabled: !!runId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_comparison_results" as any)
        .select("*")
        .eq("run_id", runId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as ComparisonResult[];
    },
  });
}

// ── Select a result (mark as winner for product+section) ──────────────────────

export function useSelectComparisonResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      runId,
      resultId,
      productId,
      section,
    }: {
      runId: string;
      resultId: string;
      productId: string;
      section: string;
    }) => {
      // Deselect all results for same run + product + section
      await supabase
        .from("ai_comparison_results" as any)
        .update({ selected: false })
        .eq("run_id", runId)
        .eq("product_id", productId)
        .eq("section", section);

      // Select this one
      const { error } = await supabase
        .from("ai_comparison_results" as any)
        .update({ selected: true })
        .eq("id", resultId);
      if (error) throw error;
    },
    onSuccess: (_data, { runId }) =>
      qc.invalidateQueries({ queryKey: ["comparison-results", runId] }),
  });
}

// ── Apply a selected result to the product ────────────────────────────────────

export function useApplyComparisonResult() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      productId,
      section,
      outputText,
      resultId,
      runId,
    }: {
      productId: string;
      section: string;
      outputText: string;
      resultId: string;
      runId: string;
    }) => {
      const sectionDef = COMPARISON_SECTIONS.find((s) => s.id === section);
      if (!sectionDef) throw new Error(`Unknown section: ${section}`);
      if (!activeWorkspace) throw new Error("No active workspace");

      // Always scope writes to active workspace — never mutate across workspaces
      const { error } = await supabase
        .from("products")
        .update({ [sectionDef.productField]: outputText })
        .eq("id", productId)
        .eq("workspace_id", activeWorkspace.id);
      if (error) throw error;

      // 4. Write audit record (best-effort — failure must not block the product update)
      try {
        const { data: resultRow } = await supabase
          .from("ai_comparison_results" as any)
          .select("model_id, provider_id")
          .eq("id", resultId)
          .single();

        if (resultRow) {
          await supabase.from("ai_comparison_applications" as any).insert({
            run_id:      runId,
            result_id:   resultId,
            product_id:  productId,
            field_name:  sectionDef.productField,
            model_id:    (resultRow as unknown as { model_id: string; provider_id: string }).model_id,
            provider_id: (resultRow as unknown as { model_id: string; provider_id: string }).provider_id,
            applied_by:  (await supabase.auth.getUser()).data.user?.id ?? null,
          });
        }
      } catch (auditErr) {
        console.warn("[useApplyComparisonResult] audit record failed (non-blocking):", auditErr);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      qc.invalidateQueries({ queryKey: ["comparison-runs"], exact: false });
    },
  });
}

// ── Comparison run history ─────────────────────────────────────────────────────

export function useComparisonHistory() {
  const { activeWorkspace } = useWorkspaceContext();

  return useQuery({
    queryKey: ["comparison-runs", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_comparison_runs" as any)
        .select(`
          *,
          applications_count:ai_comparison_applications(count)
        `)
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as ComparisonRun[];
    },
  });
}

// ── Fetch products by array of IDs (for reopening historical runs) ──────────────

export function useProductsByIds(ids: string[]) {
  const { activeWorkspace } = useWorkspaceContext();

  return useQuery({
    queryKey: ["products-by-ids", activeWorkspace?.id, ids],
    enabled: ids.length > 0 && !!activeWorkspace,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, optimized_title, original_title, sku")
        .eq("workspace_id", activeWorkspace!.id)
        .in("id", ids);
      if (error) throw error;
      return (data ?? []) as Pick<Product, "id" | "optimized_title" | "original_title" | "sku">[];
    },
  });
}
