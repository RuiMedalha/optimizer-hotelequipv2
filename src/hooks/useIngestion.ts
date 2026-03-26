import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";
import { useEffect } from "react";

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
      fileName?: string;
      sourceType?: string;
      fieldMappings?: Record<string, string>;
      mergeStrategy?: string;
      duplicateDetectionFields?: string[];
      groupingConfig?: any;
      mode?: string;
      sourceId?: string;
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
      const { data, error } = await supabase.functions.invoke("run-ingestion-job", {
        body: { jobId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Run failed");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingestion-jobs"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Ingestão concluída");
    },
    onError: (e) => toast.error(e.message),
  });
}
