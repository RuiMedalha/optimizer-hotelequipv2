import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export interface PromptTemplate {
  id: string;
  workspace_id: string | null;
  prompt_name: string;
  prompt_type: string;
  base_prompt: string;
  description: string | null;
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptVersion {
  id: string;
  template_id: string;
  version_number: number;
  prompt_text: string;
  is_active: boolean;
  version_notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PromptUsageLog {
  id: string;
  prompt_version_id: string | null;
  agent_name: string | null;
  input_size: number | null;
  output_size: number | null;
  execution_time: number | null;
  confidence_score: number | null;
  cost_estimate: number | null;
  status: string | null;
  fallback_used: boolean | null;
  created_at: string;
}

export interface VersionPerformance {
  total_executions: number;
  avg_confidence: number;
  avg_cost: number;
  avg_latency: number;
  success_rate: number;
  fallback_rate: number;
  last_used: string | null;
}

export function usePromptGovernance() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  const templates = useQuery({
    queryKey: ["prompt-templates", wsId, "with-global"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_templates")
        .select("*")
        .or(`workspace_id.eq.${wsId!},workspace_id.is.null`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PromptTemplate[];
    },
    enabled: !!wsId,
  });

  const createTemplate = useMutation({
    mutationFn: async (p: { prompt_name: string; prompt_type: string; base_prompt: string; description?: string }) => {
      const { data, error } = await supabase
        .from("prompt_templates")
        .insert({ workspace_id: wsId!, ...p })
        .select()
        .single();
      if (error) throw error;
      await supabase.from("prompt_versions").insert({
        template_id: data.id,
        version_number: 1,
        prompt_text: p.base_prompt,
        is_active: true,
      });
      return data;
    },
    onSuccess: () => { toast.success("Template criado"); qc.invalidateQueries({ queryKey: ["prompt-templates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateTemplate = useMutation({
    mutationFn: async (p: { id: string; prompt_name?: string; prompt_type?: string; base_prompt?: string; description?: string; is_active?: boolean }) => {
      const { id, ...updates } = p;
      const { error } = await supabase
        .from("prompt_templates")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Template atualizado"); qc.invalidateQueries({ queryKey: ["prompt-templates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("prompt_templates")
        .update({ is_active: false, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Template arquivado"); qc.invalidateQueries({ queryKey: ["prompt-templates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("prompt_templates")
        .update({ is_active: true, archived_at: null, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Template restaurado"); qc.invalidateQueries({ queryKey: ["prompt-templates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      // Check if template has been used via versions -> usage logs
      const { data: versions } = await supabase.from("prompt_versions").select("id").eq("template_id", id);
      if (versions && versions.length > 0) {
        const versionIds = versions.map(v => v.id);
        const { count } = await supabase.from("prompt_usage_logs").select("id", { count: "exact", head: true }).in("prompt_version_id", versionIds);
        if (count && count > 0) {
          throw new Error("Este template já foi utilizado em execuções. Use 'Arquivar' em vez de apagar.");
        }
      }
      // Safe to hard delete - delete versions first
      await supabase.from("prompt_versions").delete().eq("template_id", id);
      const { error } = await supabase.from("prompt_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Template apagado"); qc.invalidateQueries({ queryKey: ["prompt-templates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateTemplate = useMutation({
    mutationFn: async (sourceId: string) => {
      const source = templates.data?.find(t => t.id === sourceId);
      if (!source) throw new Error("Template não encontrado");
      const { data, error } = await supabase
        .from("prompt_templates")
        .insert({
          workspace_id: wsId!,
          prompt_name: `${source.prompt_name} (cópia)`,
          prompt_type: source.prompt_type,
          base_prompt: source.base_prompt,
          description: source.description,
        })
        .select()
        .single();
      if (error) throw error;
      await supabase.from("prompt_versions").insert({
        template_id: data.id,
        version_number: 1,
        prompt_text: source.base_prompt,
        is_active: true,
      });
      return data;
    },
    onSuccess: () => { toast.success("Template duplicado"); qc.invalidateQueries({ queryKey: ["prompt-templates"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const useVersions = (templateId: string | null) =>
    useQuery({
      queryKey: ["prompt-versions", templateId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("prompt_versions")
          .select("*")
          .eq("template_id", templateId!)
          .order("version_number", { ascending: false });
        if (error) throw error;
        return data as PromptVersion[];
      },
      enabled: !!templateId,
    });

  const createVersion = useMutation({
    mutationFn: async (p: { template_id: string; prompt_text: string; version_notes?: string }) => {
      const { data: existing } = await supabase
        .from("prompt_versions")
        .select("version_number")
        .eq("template_id", p.template_id)
        .order("version_number", { ascending: false })
        .limit(1);
      const nextVersion = (existing?.[0]?.version_number || 0) + 1;
      await supabase.from("prompt_versions").update({ is_active: false }).eq("template_id", p.template_id);
      const { data, error } = await supabase
        .from("prompt_versions")
        .insert({
          template_id: p.template_id,
          version_number: nextVersion,
          prompt_text: p.prompt_text,
          is_active: true,
          version_notes: p.version_notes || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Nova versão criada"); qc.invalidateQueries({ queryKey: ["prompt-versions"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const activateVersion = useMutation({
    mutationFn: async (p: { template_id: string; version_id: string }) => {
      await supabase.from("prompt_versions").update({ is_active: false }).eq("template_id", p.template_id);
      const { error } = await supabase.from("prompt_versions").update({ is_active: true }).eq("id", p.version_id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Versão ativada"); qc.invalidateQueries({ queryKey: ["prompt-versions"] }); },
  });

  const usageLogs = (versionId: string | null) =>
    useQuery({
      queryKey: ["prompt-usage-logs", versionId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("prompt_usage_logs")
          .select("*")
          .eq("prompt_version_id", versionId!)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        return data as PromptUsageLog[];
      },
      enabled: !!versionId,
    });

  const useVersionPerformance = (versionId: string | null) =>
    useQuery({
      queryKey: ["prompt-version-performance", versionId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("prompt_usage_logs")
          .select("*")
          .eq("prompt_version_id", versionId!);
        if (error) throw error;
        const logs = data || [];
        const total = logs.length;
        if (total === 0) return {
          total_executions: 0, avg_confidence: 0, avg_cost: 0, avg_latency: 0,
          success_rate: 0, fallback_rate: 0, last_used: null,
        } as VersionPerformance;

        const successful = logs.filter(l => (l as any).status === "completed" || !(l as any).status).length;
        const fallbacks = logs.filter(l => (l as any).fallback_used).length;
        const confidences = logs.filter(l => l.confidence_score != null).map(l => l.confidence_score!);
        const costs = logs.filter(l => (l as any).cost_estimate != null).map(l => (l as any).cost_estimate!);
        const latencies = logs.filter(l => l.execution_time != null).map(l => l.execution_time!);

        return {
          total_executions: total,
          avg_confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0,
          avg_cost: costs.length ? costs.reduce((a: number, b: number) => a + b, 0) / costs.length : 0,
          avg_latency: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
          success_rate: total ? (successful / total) * 100 : 0,
          fallback_rate: total ? (fallbacks / total) * 100 : 0,
          last_used: logs[0]?.created_at || null,
        } as VersionPerformance;
      },
      enabled: !!versionId,
    });

  const overrides = useQuery({
    queryKey: ["prompt-overrides", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_overrides")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  return {
    templates, createTemplate, updateTemplate, archiveTemplate, restoreTemplate,
    deleteTemplate, duplicateTemplate, useVersions, createVersion, activateVersion,
    overrides, usageLogs, useVersionPerformance,
  };
}
