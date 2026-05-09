import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toast } from "sonner";
import type { PricingOptions, SkuPrefixOptions } from "@/components/WooPublishModal";
import { logger } from "@/lib/logger";

export interface PublishJob {
  id: string;
  status: string;
  total_products: number;
  processed_products: number;
  failed_products: number;
  current_product_name: string | null;
  results: any[];
  scheduled_for: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export function usePublishJob() {
  const [activePublishJob, setActivePublishJob] = useState<PublishJob | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const wakeupInFlightRef = useRef(false);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!activePublishJob || activePublishJob.status === "completed" || activePublishJob.status === "cancelled" || activePublishJob.status === "failed") return;

    const channel = supabase
      .channel(`publish-job-${activePublishJob.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "publish_jobs",
          filter: `id=eq.${activePublishJob.id}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setActivePublishJob(updated);

          if (updated.status === "completed" || updated.status === "failed" || updated.processed_products >= updated.total_products) {
            const results = updated.results || [];
            const created = results.filter((r: any) => r.status === "created").length;
            const updatedCount = results.filter((r: any) => r.status === "updated").length;
            const errors = results.filter((r: any) => r.status === "error").length;
            const skipped = results.filter((r: any) => r.status === "skipped_complex").length;
            const parts: string[] = [];
            if (created > 0) parts.push(`${created} criado(s)`);
            if (updatedCount > 0) parts.push(`${updatedCount} atualizado(s)`);
            if (skipped > 0) parts.push(`${skipped} ignorado(s) (variável — usar Clássico)`);
            
            if (updated.status === "failed") {
              toast.error(`Publicação falhou: ${updated.error_message || "Erro desconhecido"}`);
            } else if (errors > 0) {
              parts.push(`${errors} com erro`);
              toast.warning(`Publicação concluída: ${parts.join(", ")}`);
            } else if (created + updatedCount === 0 && skipped > 0) {
              toast.info(`Publicação concluída: ${parts.join(", ")}`);
            } else {
              toast.success(`${parts.join(", ")} no WooCommerce! 🚀`);
            }
            
            // Auto-dismiss after 5 seconds
            const jobIdToClear = updated.id;
            setTimeout(() => {
              setActivePublishJob(prev => (prev?.id === jobIdToClear ? null : prev));
            }, 5000);
          } else if (updated.status === "cancelled") {
            toast.info(`Publicação cancelada. ${updated.processed_products} de ${updated.total_products} processados.`);
            setTimeout(() => setActivePublishJob(null), 5000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activePublishJob?.id, activePublishJob?.status]);

  // Check for active jobs on mount and periodically as a fallback to realtime
  const checkActiveJobs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("publish_jobs")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["queued", "processing", "scheduled", "completed"]) // Include completed to catch transitions
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      logger.error("Erro ao verificar jobs ativos:", error);
      return;
    }

    if (data && data.length > 0) {
      const job = data[0] as any;
      
      // If we already have this job and it's completed in DB, update local state
      if (activePublishJob?.id === job.id) {
        if (job.status !== activePublishJob.status || job.processed_products !== activePublishJob.processed_products) {
          setActivePublishJob(job);
        }
      } else {
        // Only set as active if it's truly active or very recently completed
        const isActuallyActive = ["queued", "processing", "scheduled"].includes(job.status);
        const isRecentCompletion = job.status === "completed" && (Date.now() - new Date(job.updated_at).getTime() < 30000);
        
        if (isActuallyActive || isRecentCompletion) {
          // Final safeguard for stale processing jobs
          if (job.status === "processing" && job.processed_products >= job.total_products && job.total_products > 0) {
            // This is actually completed but DB says processing (likely a crash)
            return;
          }
          setActivePublishJob(job);
        }
      }

      // Auto-trigger queued jobs that haven't started
      if (job.status === "queued" && !job.started_at) {
        invokeEdgeFunction("publish-woocommerce", {
          body: { jobId: job.id, startIndex: 0 },
        }).catch((err) => logger.error("Auto-trigger publish falhou:", err));
      }
    }
  }, [activePublishJob?.id, activePublishJob?.status, activePublishJob?.processed_products]);

  useEffect(() => {
    checkActiveJobs();
    const interval = setInterval(checkActiveJobs, 10000); // Poll every 10s as fallback
    return () => clearInterval(interval);
  }, [checkActiveJobs]);

  // Watchdog: re-invoke stalled jobs (but never if all products processed)
  useEffect(() => {
    if (!activePublishJob || (activePublishJob.status !== "processing" && activePublishJob.status !== "queued")) return;
    if (activePublishJob.total_products > 0 && activePublishJob.processed_products >= activePublishJob.total_products) return;

    const interval = setInterval(async () => {
      if (!activePublishJob || wakeupInFlightRef.current) return;
      // Re-check completion guard inside interval
      if (activePublishJob.total_products > 0 && activePublishJob.processed_products >= activePublishJob.total_products) return;

      const ageMs = Date.now() - new Date(activePublishJob.updated_at).getTime();
      if (ageMs <= 120_000) return; // 2 min, more conservative

      wakeupInFlightRef.current = true;
      try {
        await invokeEdgeFunction("publish-woocommerce", {
          body: {
            jobId: activePublishJob.id,
            startIndex: activePublishJob.processed_products,
          },
        });
        toast.info("Publicação retomada automaticamente.");
      } catch (err: any) {
        logger.warn("Wakeup publish falhou:", { message: err?.message || err });
      } finally {
        wakeupInFlightRef.current = false;
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, [activePublishJob]);

  const createPublishJob = useCallback(
    async ({
      productIds,
      publishFields,
      pricing,
      scheduledFor,
      workspaceId,
      skuPrefix,
      turboMode,
    }: {
      productIds: string[];
      publishFields?: string[];
      pricing?: PricingOptions;
      scheduledFor?: string;
      workspaceId?: string;
      skuPrefix?: SkuPrefixOptions;
      turboMode?: boolean;
    }) => {
      setIsCreating(true);
      const MAX_RETRIES = 3;
      let lastError: Error | null = null;
      // Modo Turbo → função nova; Clássico → função actual (sem mexer no fluxo).
      const fnName = turboMode ? "publish-woocommerce-turbo" : "publish-woocommerce";

      try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const { data, error } = await supabase.functions.invoke(fnName, {
              body: {
                productIds,
                publishFields,
                pricing,
                scheduledFor,
                workspaceId,
                skuPrefix,
              },
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            if (data?.jobId) {
              const { data: jobData } = await supabase
                .from("publish_jobs")
                .select("*")
                .eq("id", data.jobId)
                .single();

              if (jobData) {
                setActivePublishJob(jobData as any);
              }

              if (scheduledFor) {
                toast.success(`Publicação agendada para ${new Date(scheduledFor).toLocaleString("pt-PT")} ⏰`);
              } else {
                toast.success(`Publicação iniciada (${turboMode ? "Turbo" : "Clássico"}): ${productIds.length} produtos em background 🚀`);
              }
            }

            return data;
          } catch (err: any) {
            lastError = err;
            if (attempt < MAX_RETRIES) {
              const delay = Math.min(1000 * 2 ** (attempt - 1), 4000);
              logger.warn(`createPublishJob attempt ${attempt} failed, retrying in ${delay}ms...`, { message: err?.message });
              await new Promise((r) => setTimeout(r, delay));
            }
          }
        }

        toast.error(`Erro ao criar publicação: ${lastError?.message}`);
        throw lastError;
      } finally {
        setIsCreating(false);
      }
    },
    []
  );

  const cancelPublishJob = useCallback(async () => {
    if (!activePublishJob) return;
    const { error } = await supabase
      .from("publish_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", activePublishJob.id);

    if (error) {
      toast.error("Erro ao cancelar publicação");
    } else {
      toast.info("Publicação a cancelar...");
    }
  }, [activePublishJob]);

  const dismissPublishJob = useCallback(() => {
    setActivePublishJob(null);
  }, []);

  return {
    activePublishJob,
    isCreating,
    createPublishJob,
    cancelPublishJob,
    dismissPublishJob,
  };
}
