import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";
import { logger } from "@/lib/logger";

export function useProductLocalizations(productId: string | null) {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["product-localizations", productId],
    enabled: !!productId && !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_localizations")
        .select("*")
        .eq("product_id", productId!)
        .eq("workspace_id", activeWorkspace!.id)
        .order("locale");
      if (error) throw error;
      return data;
    },
  });
}

export function useTranslationMemories() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["translation-memories", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("translation_memories")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
}

export function useTerminologyDictionaries() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["terminology-dictionaries", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terminology_dictionaries")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("source_term");
      if (error) throw error;
      return data;
    },
  });
}

export function useLocaleStyleGuides() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["locale-style-guides", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locale_style_guides")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("locale");
      if (error) throw error;
      return data;
    },
  });
}

export function useTranslationJobs() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["translation-jobs", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("translation_jobs")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
}

export function useTranslationJobItems(jobId: string | null) {
  return useQuery({
    queryKey: ["translation-job-items", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("translation_job_items")
        .select("*")
        .eq("job_id", jobId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useTranslateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { product_id: string; workspace_id: string; source_locale: string; target_locale: string; user_id: string }) => {
      const { data, error } = await supabase.functions.invoke("translate-product", { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success(`Tradução para ${vars.target_locale} concluída`);
      qc.invalidateQueries({ queryKey: ["product-localizations", vars.product_id] });
    },
    onError: (e: any) => toast.error(e.message || "Erro na tradução"),
  });
}

export function useCreateTranslationJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { workspace_id: string; user_id: string; source_locale: string; target_locales: string[]; product_ids: string[] }) => {
      // Create job
      const { data: job, error: jErr } = await supabase
        .from("translation_jobs")
        .insert({
          workspace_id: params.workspace_id,
          user_id: params.user_id,
          source_locale: params.source_locale,
          target_locales: params.target_locales,
          product_ids: params.product_ids,
          status: "processing",
        })
        .select()
        .single();
      if (jErr) throw jErr;

      // Create job items
      const items = params.product_ids.flatMap((pid) =>
        params.target_locales.map((locale) => ({
          job_id: job.id,
          product_id: pid,
          locale,
          status: "queued",
        }))
      );
      await supabase.from("translation_job_items").insert(items);

      // Process each item
      for (const item of items) {
        try {
          await supabase.functions.invoke("translate-product", {
            body: {
              product_id: item.product_id,
              workspace_id: params.workspace_id,
              source_locale: params.source_locale,
              target_locale: item.locale,
              user_id: params.user_id,
              job_id: job.id,
            },
          });
        } catch (e) {
          logger.error("Translation item failed:", e);
        }
      }

      // Mark job complete
      await supabase.from("translation_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        processed_products: params.product_ids.length,
      }).eq("id", job.id);

      return job;
    },
    onSuccess: () => {
      toast.success("Job de tradução concluído");
      qc.invalidateQueries({ queryKey: ["translation-jobs"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro no job de tradução"),
  });
}

export function useAddTerminology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { workspace_id: string; source_locale: string; target_locale: string; source_term: string; target_term: string; is_mandatory?: boolean; notes?: string }) => {
      const { error } = await supabase.from("terminology_dictionaries").insert(params);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Termo adicionado");
      qc.invalidateQueries({ queryKey: ["terminology-dictionaries"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteTerminology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("terminology_dictionaries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminology-dictionaries"] });
    },
  });
}

export function useUpsertStyleGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: any) => {
      const { error } = await supabase.from("locale_style_guides").upsert(params);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Style guide guardado");
      qc.invalidateQueries({ queryKey: ["locale-style-guides"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useApproveLocalization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; product_id: string }) => {
      const { error } = await supabase
        .from("product_localizations")
        .update({ status: "approved", needs_review: false, quality_score: 95 })
        .eq("id", params.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success("Localização aprovada");
      qc.invalidateQueries({ queryKey: ["product-localizations", vars.product_id] });
    },
  });
}

export const SUPPORTED_LOCALES = [
  { code: "pt-PT", label: "Português (Portugal)", flag: "🇵🇹" },
  { code: "pt-BR", label: "Português (Brasil)", flag: "🇧🇷" },
  { code: "en-GB", label: "English (UK)", flag: "🇬🇧" },
  { code: "en-US", label: "English (US)", flag: "🇺🇸" },
  { code: "es-ES", label: "Español", flag: "🇪🇸" },
  { code: "fr-FR", label: "Français", flag: "🇫🇷" },
  { code: "de-DE", label: "Deutsch", flag: "🇩🇪" },
  { code: "it-IT", label: "Italiano", flag: "🇮🇹" },
];
