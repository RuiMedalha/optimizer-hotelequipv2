import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function usePlaybookEngine() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();

  const invalidateDrafts = () => qc.invalidateQueries({ queryKey: ["supplier-playbook-drafts", wsId] });
  const invalidatePlaybooks = () => qc.invalidateQueries({ queryKey: ["supplier-playbooks", wsId] });

  const detections = useQuery({
    queryKey: ["supplier-auto-detections", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_auto_detections") as any)
        .select("*").eq("workspace_id", wsId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  const inferences = useQuery({
    queryKey: ["supplier-column-inferences", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_column_inferences") as any)
        .select("*").eq("workspace_id", wsId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  const playbookDrafts = useQuery({
    queryKey: ["supplier-playbook-drafts", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_playbook_drafts") as any)
        .select("*").eq("workspace_id", wsId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const overrides = useQuery({
    queryKey: ["supplier-overrides", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_overrides") as any)
        .select("*").eq("workspace_id", wsId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as any[];
    },
  });

  const autoDetect = useMutation({
    mutationFn: async (params: { file_name?: string; source_url?: string; headers?: string[]; sample_data?: any[]; source_type?: string }) => {
      const { data, error } = await supabase.functions.invoke("auto-detect-supplier", {
        body: { workspace_id: wsId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["supplier-auto-detections"] });
      qc.invalidateQueries({ queryKey: ["supplier-profiles"] });
      toast.success(data.matched_supplier_id ? "Fornecedor detetado e associado" : "Fornecedor detetado (não confirmado)");
    },
  });

  const inferMapping = useMutation({
    mutationFn: async (params: { supplier_id?: string; detection_id?: string; headers: string[]; sample_data?: any[]; file_name?: string }) => {
      const { data, error } = await supabase.functions.invoke("infer-column-mapping", {
        body: { workspace_id: wsId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-column-inferences"] });
      toast.success("Mapeamento inferido com sucesso");
    },
  });

  const generateDraft = useMutation({
    mutationFn: async (params: { supplier_id?: string; detection_id?: string; inference_id?: string; ingestion_job_id?: string; uploaded_file_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-playbook-draft", {
        body: { workspace_id: wsId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateDrafts();
      toast.success("Playbook draft gerado");
    },
  });

  const applyCorrections = useMutation({
    mutationFn: async (params: { supplier_id?: string; corrections?: any[]; instruction?: string; draft_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("apply-supplier-corrections", {
        body: { workspace_id: wsId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-overrides"] });
      invalidateDrafts();
      toast.success("Correções aplicadas");
    },
  });

  // ─── Draft CRUD ───

  const promoteDraft = useMutation({
    mutationFn: async (draftId: string) => {
      const { data: draft, error: dErr } = await (supabase.from("supplier_playbook_drafts") as any)
        .select("*").eq("id", draftId).single();
      if (dErr) throw dErr;

      const { data: playbook, error: pErr } = await supabase.functions.invoke("create-supplier-playbook", {
        body: {
          workspace_id: wsId,
          supplier_id: draft.supplier_id,
          playbook_name: draft.playbook_name,
          playbook_type: (draft.playbook_config as any)?.source_type || "excel_only",
          playbook_config: {
            ...draft.playbook_config,
            column_mapping: draft.column_mapping,
            matching_rules: draft.matching_rules,
            grouping_rules: draft.grouping_rules,
            taxonomy_suggestion: draft.taxonomy_suggestion,
            image_strategy: draft.image_strategy,
            validation_profile: draft.validation_profile,
          },
          origin_draft_id: draftId,
          origin_ingestion_job_id: draft.ingestion_job_id,
        },
      });
      if (pErr) throw pErr;

      await (supabase.from("supplier_playbook_drafts") as any)
        .update({ status: "promoted", promoted_playbook_id: playbook?.playbook?.id })
        .eq("id", draftId);

      return playbook;
    },
    onSuccess: () => {
      invalidateDrafts();
      invalidatePlaybooks();
      toast.success("Playbook promovido com sucesso");
    },
  });

  const deleteDraft = useMutation({
    mutationFn: async (draftId: string) => {
      const { error } = await (supabase.from("supplier_playbook_drafts") as any).delete().eq("id", draftId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateDrafts();
      toast.success("Draft eliminado");
    },
  });

  const updateDraft = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await (supabase.from("supplier_playbook_drafts") as any)
        .update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateDrafts();
      toast.success("Draft atualizado");
    },
  });

  const archiveDraft = useMutation({
    mutationFn: async (draftId: string) => {
      const { error } = await (supabase.from("supplier_playbook_drafts") as any)
        .update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", draftId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateDrafts();
      toast.success("Draft arquivado");
    },
  });

  // ─── Playbook CRUD ───

  const updatePlaybook = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from("supplier_playbooks")
        .update(updates as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidatePlaybooks();
      toast.success("Playbook atualizado");
    },
  });

  const archivePlaybook = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("supplier_playbooks")
        .update({ is_active: false, archived_at: new Date().toISOString() } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidatePlaybooks();
      toast.success("Playbook arquivado");
    },
  });

  const deletePlaybook = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("supplier_playbooks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidatePlaybooks();
      toast.success("Playbook eliminado");
    },
  });

  const duplicatePlaybook = useMutation({
    mutationFn: async (id: string) => {
      const { data: orig, error: gErr } = await supabase.from("supplier_playbooks")
        .select("*").eq("id", id).single();
      if (gErr) throw gErr;
      const { id: _id, created_at: _ca, updated_at: _ua, archived_at: _aa, ...rest } = orig as any;
      const { error } = await supabase.from("supplier_playbooks")
        .insert({ ...rest, playbook_name: `${rest.playbook_name} (cópia)`, is_active: false, version_number: 1 } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidatePlaybooks();
      toast.success("Playbook duplicado");
    },
  });

  // ─── Ingestion Job CRUD ───

  const deleteIngestionJob = useMutation({
    mutationFn: async (jobId: string) => {
      // Delete items first
      await (supabase.from("ingestion_job_items") as any).delete().eq("job_id", jobId);
      const { error } = await (supabase.from("ingestion_jobs") as any).delete().eq("id", jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingestion-jobs"] });
      toast.success("Job eliminado");
    },
  });

  const archiveIngestionJob = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await (supabase.from("ingestion_jobs") as any)
        .update({ archived_at: new Date().toISOString() }).eq("id", jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingestion-jobs"] });
      toast.success("Job arquivado");
    },
  });

  // ─── Auto-draft after ingestion ───

  const triggerAutoDraftFromIngestion = useMutation({
    mutationFn: async (params: {
      ingestion_job_id: string;
      uploaded_file_id?: string;
      file_name: string;
      headers: string[];
      sample_data: any[];
      source_type: string;
    }) => {
      // 1. Auto-detect supplier
      const detResult = await autoDetect.mutateAsync({
        file_name: params.file_name,
        headers: params.headers,
        sample_data: params.sample_data.slice(0, 50),
        source_type: params.source_type,
      });

      // 2. Infer column mapping
      const infResult = await inferMapping.mutateAsync({
        supplier_id: detResult.matched_supplier_id || undefined,
        detection_id: detResult.detection?.id,
        headers: params.headers,
        sample_data: params.sample_data.slice(0, 50),
        file_name: params.file_name,
      });

      // 3. Generate playbook draft with ingestion link
      const draftResult = await generateDraft.mutateAsync({
        supplier_id: detResult.matched_supplier_id || undefined,
        detection_id: detResult.detection?.id,
        inference_id: infResult.inference?.id,
        ingestion_job_id: params.ingestion_job_id,
        uploaded_file_id: params.uploaded_file_id,
      });

      return draftResult;
    },
  });

  return {
    detections, inferences, playbookDrafts, overrides,
    autoDetect, inferMapping, generateDraft, applyCorrections,
    promoteDraft, deleteDraft, updateDraft, archiveDraft,
    updatePlaybook, archivePlaybook, deletePlaybook, duplicatePlaybook,
    deleteIngestionJob, archiveIngestionJob,
    triggerAutoDraftFromIngestion,
  };
}
