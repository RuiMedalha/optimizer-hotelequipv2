import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";
import { useEffect } from "react";

export interface SyncStagingItem {
  id: string;
  workspace_id: string;
  supplier_id: string | null;
  ingestion_job_id: string | null;
  sku_supplier: string | null;
  sku_site_target: string | null;
  existing_product_id: string | null;
  proposed_changes: any;
  supplier_data: any;
  site_data: any;
  confidence_score: number;
  match_method: 'exact' | 'normalized' | 'fuzzy' | 'ean' | 'manual';
  status: 'pending' | 'approved' | 'rejected' | 'processed' | 'flagged';
  change_type: 'discontinued' | 'new_product' | 'price_change' | 'field_update' | 'multiple_changes' | null;
  created_at: string;
  updated_at: string;
}



// ─── Types ───
export interface IngestionSource {
  id: string;
  workspace_id: string;
  name: string;
  source_type: string;
  config: any;
  field_mappings: Record<string, string>;
  schedule_cron: string | null;
  merge_strategy: string;
  duplicate_detection_fields: string[];
  grouping_config: any;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngestionJob {
  id: string;
  workspace_id: string;
  user_id: string | null;
  source_id: string | null;
  source_type: string;
  file_name: string | null;
  status: string;
  mode: string;
  merge_strategy: string;
  total_rows: number;
  parsed_rows: number;
  imported_rows: number;
  updated_rows: number;
  skipped_rows: number;
  failed_rows: number;
  duplicate_rows: number;
  results: any;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  role: string | null;
  supplier_id: string | null;
  config?: {
    fieldMappings?: Record<string, string>;
    skuPrefix?: string;
    sourceLanguage?: string;
    mergeStrategy?: string;
    duplicateDetectionFields?: string[];
    role?: string;
    groupingConfig?: any;
  } | null;
}

export interface IngestionJobItem {
  id: string;
  job_id: string;
  status: string;
  source_row_index: number;
  source_data: any;
  mapped_data: any;
  product_id: string | null;
  matched_existing_id: string | null;
  action: string;
  match_confidence: number | null;
  parent_group_key: string | null;
  is_parent: boolean;
  grouping_confidence: number | null;
  error_message: string | null;
  created_at: string;
}

// ─── Hooks ───

export function useIngestionSources() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["ingestion-sources", activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingestion_sources" as any)
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as IngestionSource[];
    },
  });
}

export function useIngestionJobs() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["ingestion-jobs", activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingestion_jobs" as any)
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as IngestionJob[];
    },
  });

  // Realtime subscription
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const channel = supabase
      .channel(`ingestion-jobs-${activeWorkspace.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "ingestion_jobs",
        filter: `workspace_id=eq.${activeWorkspace.id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["ingestion-jobs", activeWorkspace.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeWorkspace?.id]);

  return query;
}

export function useIngestionJobItems(jobId: string | null) {
  return useQuery({
    queryKey: ["ingestion-job-items", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingestion_job_items" as any)
        .select("*")
        .eq("job_id", jobId)
        .limit(10000) // Increase limit to handle larger jobs (up to 10k rows)
        .order("source_row_index", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as IngestionJobItem[];
    },
  });
}

export function useCreateIngestionSource() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (source: Partial<IngestionSource>) => {
      const { data, error } = await supabase
        .from("ingestion_sources" as any)
        .insert({ ...source, workspace_id: activeWorkspace!.id } as any)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as IngestionSource;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingestion-sources"] });
      toast.success("Fonte de ingestão criada");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useParseIngestion() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (params: {
      data: any[];
      masterData?: any[];
      fileName?: string;
      sourceType?: string;
      fieldMappings?: Record<string, string>;
      mergeStrategy?: string;
      duplicateDetectionFields?: string[];
      groupingConfig?: any;
      mode?: string;
      sourceId?: string;
      skuPrefix?: string;
      sourceLanguage?: string;
      role?: string;
      supplierId?: string;
      defaultBrand?: string;
      autoModelFromSku?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke("parse-ingestion", {
        body: {
          workspaceId: activeWorkspace!.id,
          ...params,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Parse failed");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingestion-jobs"] });
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useRunIngestionJob() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      let finished = false;
      let totalImported = 0;
      let iterations = 0;
      const MAX_ITERATIONS = 500; // Increased to 500 to support up to 25,000 products (50 per batch)

      while (!finished && iterations < MAX_ITERATIONS) {
        const { data, error } = await supabase.functions.invoke("run-ingestion-job", {
          body: { jobId },
        });
        
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || "Run failed");
        
        finished = data.finished;
        totalImported += (data.lastBatch?.imported || 0);
        iterations++;
        
        // Invalidate after each batch to show progress in UI if needed
        qc.invalidateQueries({ queryKey: ["ingestion-jobs"] });
        
        if (!finished) {
          console.log(`Processed batch ${iterations}. Remaining items...`);
          // Small delay to let the server breathe and prevent resource spikes
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      return { success: true, jobId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingestion-jobs"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Ingestão concluída");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function usePendingStagingItems(options?: { changeType?: string; limit?: number; offset?: number }) {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["pending-staging-items", activeWorkspace?.id, options?.changeType, options?.limit, options?.offset],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      let query = supabase
        .from("sync_staging")
        .select(`
          *,
          supplier:supplier_profiles(supplier_name)
        `, { count: 'exact' })
        .eq("workspace_id", activeWorkspace!.id)
        .in("status", ["pending", "flagged"]);

      if (options?.changeType) {
        query = query.eq("change_type", options.changeType);
      }

      const limit = options?.limit || 50;
      const offset = options?.offset || 0;

      const { data, error, count } = await query
        .order("confidence_score", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return {
        items: data as unknown as (SyncStagingItem & { supplier: { supplier_name: string } | null })[],
        totalCount: count || 0
      };
    },
  });
}

export function useStagingCounts() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["staging-counts", activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_staging")
        .select("change_type")
        .eq("workspace_id", activeWorkspace!.id)
        .in("status", ["pending", "flagged"]);

      if (error) throw error;
      
      const counts: Record<string, number> = {
        discontinued: 0,
        new_product: 0,
        price_change: 0,
        field_update: 0,
        multiple_changes: 0,
        total: data.length
      };
export function useBatchProcessStaging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ changeType, action, workspaceId }: { changeType: string; action: string; workspaceId: string }) => {
      // We'll use a Supabase Edge Function to process in batch
      const { data, error } = await supabase.functions.invoke("batch-process-staging", {
        body: { changeType, action, workspaceId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-staging-items"] });
      qc.invalidateQueries({ queryKey: ["staging-counts"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Processamento em lote concluído");
    },
    onError: (e) => toast.error(e.message),
  });
}

      data.forEach(item => {
        if (item.change_type && counts[item.change_type] !== undefined) {
          counts[item.change_type]++;
        }
      });

      return counts;
    },
  });
}

export function useProcessStagingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, data }: { id: string; action: 'approve' | 'reject'; data?: any }) => {
      const { data: result, error } = await supabase.functions.invoke("process-staging-item", {
        body: { id, action, data },
      });
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-staging-items"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Ação processada com sucesso");
    },
    onError: (e) => toast.error(e.message),
  });
}

