import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface JobItem {
  id: string;
  job_id: string;
  product_id: string;
  status: "queued" | "processing" | "done" | "error" | "skipped";
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  retry_count: number;
  error_message: string | null;
  error_payload: any;
  created_at: string;
}

export interface OptimizationJobItem extends JobItem {
  fields_optimized: string[];
  model_used: string | null;
  tokens_used: number;
  rag_chunks_used: number;
}

export interface PublishJobItem extends JobItem {
  woocommerce_id: number | null;
  publish_fields: string[];
}

export function useOptimizationJobItems(jobId: string | null) {
  const query = useQuery({
    queryKey: ["optimization-job-items", jobId],
    enabled: !!jobId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("optimization_job_items" as any)
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as OptimizationJobItem[];
    },
  });

  // Subscribe to realtime
  useEffect(() => {
    if (!jobId) return;
    const channel = supabase
      .channel(`opt-items-${jobId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "optimization_job_items",
        filter: `job_id=eq.${jobId}`,
      }, () => {
        query.refetch();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [jobId]);

  return query;
}

export function usePublishJobItems(jobId: string | null) {
  const query = useQuery({
    queryKey: ["publish-job-items", jobId],
    enabled: !!jobId,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("publish_job_items" as any)
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as PublishJobItem[];
    },
  });

  useEffect(() => {
    if (!jobId) return;
    const channel = supabase
      .channel(`pub-items-${jobId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "publish_job_items",
        filter: `job_id=eq.${jobId}`,
      }, () => {
        query.refetch();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [jobId]);

  return query;
}
