import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toast } from "sonner";
import type { OptimizationField } from "@/hooks/useOptimizeProducts";
import { logger } from "@/lib/logger";

export interface OptimizationJob {
  id: string;
  status: string;
  total_products: number;
  processed_products: number;
  failed_products: number;
  current_product_name: string | null;
  current_phase: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export function useOptimizationJob() {
  const [activeJob, setActiveJob] = useState<OptimizationJob | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const wakeupInFlightRef = useRef(false);
  const refreshActiveJob = useCallback(async (jobId: string) => {
    const { data, error } = await supabase
      .from("optimization_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (!error && data) {
      setActiveJob(data as unknown as OptimizationJob);
    }
  }, []);

  // Subscribe to realtime updates for the active job
  useEffect(() => {
    if (!activeJob || ["completed", "cancelled", "failed"].includes(activeJob.status)) return;

    const channel = supabase
      .channel(`job-${activeJob.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "optimization_jobs",
          filter: `id=eq.${activeJob.id}`,
        },
        (payload) => {
          const updated = payload.new as OptimizationJob;
          setActiveJob(updated);

          if (updated.status === "completed") {
            const failed = updated.failed_products || 0;
            const ok = updated.processed_products - failed;
            if (failed > 0) {
              toast.warning(`Job concluído: ${ok} otimizado(s), ${failed} com erro.`);
            } else {
              toast.success(`${ok} produto(s) otimizado(s) com sucesso! 🚀`);
            }
          } else if (updated.status === "cancelled") {
            toast.info(`Job cancelado. ${updated.processed_products} de ${updated.total_products} processados.`);
          } else if (updated.status === "failed") {
            toast.error("O job de otimização falhou.");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeJob?.id, activeJob?.status]);

  useEffect(() => {
    if (!activeJob) return;
    if (["completed", "cancelled", "failed"].includes(activeJob.status)) return;

    const interval = setInterval(() => {
      void refreshActiveJob(activeJob.id);
    }, 10000);

    return () => clearInterval(interval);
  }, [activeJob?.id, activeJob?.status, refreshActiveJob]);

  // Check for any active jobs on mount
  useEffect(() => {
    const checkActiveJobs = async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data } = await supabase
        .from("optimization_jobs")
        .select("*")
        .eq("user_id", user.user.id)
        .in("status", ["queued", "processing"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setActiveJob(data[0] as unknown as OptimizationJob);
      }
    };
    checkActiveJobs();
  }, []);

  // Wakeup para jobs queued OU processing que estejam parados (sem progresso recente).
  useEffect(() => {
    if (!activeJob) return;
    if (["completed", "cancelled", "failed"].includes(activeJob.status)) return;
    if (activeJob.processed_products >= activeJob.total_products) return;

    const interval = setInterval(async () => {
      if (!activeJob || wakeupInFlightRef.current) return;

      const ageMs = Date.now() - new Date(activeJob.updated_at).getTime();
      // queued: 120s, processing: 90s (mais agressivo para jobs stuck em processing)
      const stalledThreshold = activeJob.status === "queued" ? 120_000 : 90_000;
      const isStalled = ageMs > stalledThreshold;
      if (!isStalled) return;

      wakeupInFlightRef.current = true;
      try {
        logger.info("Wakeup attempt for stalled job", { jobId: activeJob.id, status: activeJob.status, ageMs });
        await invokeEdgeFunction("optimize-batch", {
          body: {
            jobId: activeJob.id,
            startIndex: activeJob.processed_products,
          },
        });
        await refreshActiveJob(activeJob.id);
      } catch (err: any) {
        logger.warn("Wakeup falhou (vai tentar novamente):", { message: err?.message || err });
      } finally {
        wakeupInFlightRef.current = false;
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, [activeJob, refreshActiveJob]);

  const createJob = useCallback(
    async ({
      productIds,
      selectedPhases,
      fieldsToOptimize,
      modelOverride,
      workspaceId,
      skipKnowledge,
      skipScraping,
      skipReranking,
      includeUsoProfissional,
      usoProfissionalRouting,
      includeImageProcessing,
      promptTemplateId,
      imagePromptTemplateId,
    }: {
      productIds: string[];
      selectedPhases?: number[];
      fieldsToOptimize?: OptimizationField[];
      modelOverride?: string;
      workspaceId?: string;
      skipKnowledge?: boolean;
      skipScraping?: boolean;
      skipReranking?: boolean;
      includeUsoProfissional?: boolean;
      usoProfissionalRouting?: { inDescription: boolean; inCustomField: boolean };
      includeImageProcessing?: boolean;
      promptTemplateId?: string;
      imagePromptTemplateId?: string;
    }) => {
      setIsCreating(true);
      try {
        const { data, error } = await supabase.functions.invoke("optimize-batch", {
          body: {
            productIds,
            selectedPhases: selectedPhases || [],
            fieldsToOptimize: fieldsToOptimize || [],
            modelOverride,
            workspaceId,
            skipKnowledge,
            skipScraping,
            skipReranking,
            includeUsoProfissional,
            usoProfissionalRouting,
            includeImageProcessing,
            promptTemplateId,
            imagePromptTemplateId,
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        if (data?.jobId) {
          // Fetch the created job
          const { data: jobData } = await supabase
            .from("optimization_jobs")
            .select("*")
            .eq("id", data.jobId)
            .single();

          if (jobData) {
            setActiveJob(jobData as unknown as OptimizationJob);
          }
          toast.success(
            `Job de otimização criado: ${productIds.length} produtos em modo background 🚀`
          );
        }

        return data;
      } catch (err: any) {
        toast.error(`Erro ao criar job: ${err.message}`);
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    []
  );

  const cancelJob = useCallback(async () => {
    if (!activeJob) return;
    const { error } = await supabase
      .from("optimization_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", activeJob.id);

    if (error) {
      toast.error("Erro ao cancelar job");
    } else {
      toast.info("Job de otimização a cancelar...");
    }
  }, [activeJob]);

  const dismissJob = useCallback(() => {
    setActiveJob(null);
  }, []);

  return {
    activeJob,
    isCreating,
    createJob,
    cancelJob,
    dismissJob,
  };
}
