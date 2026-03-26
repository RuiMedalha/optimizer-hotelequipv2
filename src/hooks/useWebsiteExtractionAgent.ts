import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useWebsiteExtractionAgent() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();

  // Configs list
  const configs = useQuery({
    queryKey: ["wea-configs", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("website_extraction_configs") as any)
        .select("*")
        .eq("workspace_id", wsId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // Runs for a config
  const useRuns = (configId?: string) => useQuery({
    queryKey: ["wea-runs", wsId, configId],
    enabled: !!wsId,
    queryFn: async () => {
      let q = (supabase.from("website_extraction_runs") as any)
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (configId) q = q.eq("config_id", configId);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  // Pages for a run
  const usePages = (runId?: string) => useQuery({
    queryKey: ["wea-pages", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("website_extraction_pages") as any)
        .select("*")
        .eq("run_id", runId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as any[];
    },
  });

  // Learnings for a config
  const useLearnings = (configId?: string) => useQuery({
    queryKey: ["wea-learnings", wsId, configId],
    enabled: !!wsId,
    queryFn: async () => {
      let q = (supabase.from("website_extraction_learnings") as any)
        .select("*")
        .eq("workspace_id", wsId!)
        .order("confidence", { ascending: false })
        .limit(100);
      if (configId) q = q.eq("config_id", configId);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  // Agent actions
  const invokeAgent = async (action: string, payload: Record<string, any>) => {
    const { data, error } = await supabase.functions.invoke("website-extraction-agent", {
      body: { action, workspace_id: wsId, ...payload },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const discover = useMutation({
    mutationFn: (payload: { target_url: string; config_id?: string; use_firecrawl?: boolean }) =>
      invokeAgent("discover", payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["wea-runs"] });
      qc.invalidateQueries({ queryKey: ["wea-pages"] });
      toast.success(`Discovery concluído: ${data.stats?.total || 0} links encontrados`);
    },
    onError: (err: any) => toast.error("Erro no discovery", { description: err.message }),
  });

  const classifyPages = useMutation({
    mutationFn: (payload: { urls: string[]; config_id?: string; use_firecrawl?: boolean }) =>
      invokeAgent("classify_pages", payload),
    onSuccess: () => toast.success("Classificação concluída"),
    onError: (err: any) => toast.error("Erro na classificação", { description: err.message }),
  });

  const extractTest = useMutation({
    mutationFn: (payload: { urls: string[]; config_id?: string; run_id?: string; use_firecrawl?: boolean }) =>
      invokeAgent("extract_test", payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["wea-pages"] });
      toast.success(`Extração teste concluída: ${data.total} páginas processadas`);
    },
    onError: (err: any) => toast.error("Erro na extração teste", { description: err.message }),
  });

  const saveLearning = useMutation({
    mutationFn: (payload: { config_id?: string; domain: string; learnings: any[] }) =>
      invokeAgent("save_learning", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wea-learnings"] });
      qc.invalidateQueries({ queryKey: ["wea-configs"] });
      toast.success("Padrões guardados com sucesso");
    },
    onError: (err: any) => toast.error("Erro ao guardar padrões", { description: err.message }),
  });

  const createConfig = useMutation({
    mutationFn: (payload: { domain: string; display_name?: string; supplier_id?: string }) =>
      invokeAgent("create_config", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wea-configs"] });
      toast.success("Configuração criada");
    },
    onError: (err: any) => toast.error("Erro ao criar configuração", { description: err.message }),
  });

  return {
    configs,
    useRuns,
    usePages,
    useLearnings,
    discover,
    classifyPages,
    extractTest,
    saveLearning,
    createConfig,
  };
}
