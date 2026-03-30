import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";
import { logger } from "@/lib/logger";

export function usePdfExtractions() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  const query = useQuery({
    queryKey: ["pdf-extractions", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pdf_extractions")
        .select("*, uploaded_files:file_id(file_name, file_type)")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    // Auto-poll every 5s when any extraction is in progress
    refetchInterval: (query) => {
      const data = query.state.data as any[] | undefined;
      const hasActive = data?.some((e: any) =>
        ["queued", "extracting", "processing"].includes(e.status)
      );
      return hasActive ? 5000 : false;
    },
  });

  return query;
}

export function usePdfPages(extractionId: string | null) {
  return useQuery({
    queryKey: ["pdf-pages", extractionId],
    enabled: !!extractionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pdf_pages")
        .select("*")
        .eq("extraction_id", extractionId!)
        .order("page_number");
      if (error) throw error;
      return data;
    },
  });
}

export function usePdfTables(pageIds: string[]) {
  return useQuery({
    queryKey: ["pdf-tables", pageIds],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pdf_tables")
        .select("*, pdf_table_rows(*)")
        .in("page_id", pageIds)
        .order("table_index");
      if (error) throw error;
      return data;
    },
  });
}

export function useStartPdfExtraction() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (params: string | { fileId: string; language?: string }) => {
      const fileId = typeof params === "string" ? params : params.fileId;
      const language = typeof params === "string" ? undefined : params.language;

      // Create extraction record
      const { data: extraction, error: createErr } = await supabase
        .from("pdf_extractions")
        .insert({
          workspace_id: activeWorkspace!.id,
          file_id: fileId,
          status: "queued",
        })
        .select("id")
        .single();
      if (createErr) throw createErr;

      // Fire-and-forget: trigger extraction without awaiting completion
      // The edge function runs server-side and updates the DB as it progresses
      invokeEdgeFunction("extract-pdf-pages", {
        body: { extractionId: extraction.id, ...(language ? { languageHint: language } : {}) },
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
      }).catch((err) => {
        logger.error("Background extraction error:", err);
        // The extraction status will be set to "error" by the edge function itself
        queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
      });

      return { extractionId: extraction.id };
    },
    onSuccess: () => {
      toast.success("Extração PDF iniciada em segundo plano");
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
    },
    onError: (e: Error) => toast.error("Erro na extração: " + e.message),
  });
}

export function useVisionParsePage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pageId: string) => {
      const { data, error } = await supabase.functions.invoke("vision-parse-pdf", {
        body: { pageId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Análise visual concluída");
      queryClient.invalidateQueries({ queryKey: ["pdf-pages"] });
      queryClient.invalidateQueries({ queryKey: ["pdf-tables"] });
    },
    onError: (e: Error) => toast.error("Erro na análise: " + e.message),
  });
}

export function useDeletePdfExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (extractionId: string) => {
      // Delete child records first (cascade may handle some, but be explicit)
      const { data: pages } = await supabase
        .from("pdf_pages")
        .select("id")
        .eq("extraction_id", extractionId);

      if (pages?.length) {
        const pageIds = pages.map((p) => p.id);
        // Get table IDs for these pages
        const { data: tables } = await supabase
          .from("pdf_tables")
          .select("id")
          .in("page_id", pageIds);

        if (tables?.length) {
          const tableIds = tables.map((t) => t.id);
          await supabase.from("pdf_table_rows").delete().in("table_id", tableIds);
          await supabase.from("pdf_tables").delete().in("page_id", pageIds);
        }
        await supabase.from("pdf_pages").delete().eq("extraction_id", extractionId);
      }

      // Delete metrics
      await supabase.from("pdf_extraction_metrics" as any).delete().eq("extraction_id", extractionId);

      // Delete extraction
      const { error } = await supabase.from("pdf_extractions").delete().eq("id", extractionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Extração eliminada");
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
    },
    onError: (e: Error) => toast.error("Erro ao eliminar: " + e.message),
  });
}

export function useMapPdfToProducts() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async ({ extractionId, sendToIngestion }: { extractionId: string; sendToIngestion?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("map-pdf-to-products", {
        body: { extractionId, sendToIngestion, workspaceId: activeWorkspace?.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.rowsMapped} linhas mapeadas${data.sentToIngestion ? " e enviadas para ingestão" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion-jobs"] });
    },
    onError: (e: Error) => toast.error("Erro no mapeamento: " + e.message),
  });
}
