import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export function useSupplierPlaybooks() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();

  const playbooks = useQuery({
    queryKey: ["supplier-playbooks", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_playbooks")
        .select("*")
        .eq("workspace_id", wsId!)
        .is("archived_at" as any, null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const connectorSetups = useQuery({
    queryKey: ["supplier-connector-setups", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_connector_setups")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const createPlaybook = useMutation({
    mutationFn: async (params: any) => {
      const { data, error } = await supabase.functions.invoke("create-supplier-playbook", {
        body: { workspace_id: wsId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplier-playbooks", wsId] }),
  });

  const runWizard = useMutation({
    mutationFn: async (params: any) => {
      const { data, error } = await supabase.functions.invoke("run-supplier-setup-wizard", {
        body: { workspace_id: wsId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplier-connector-setups", wsId] }),
  });

  const testConnector = useMutation({
    mutationFn: async (params: { supplier_id: string; test_type: string; playbook_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("test-supplier-connector", { body: params });
      if (error) throw error;
      return data;
    },
  });

  const validatePlaybook = useMutation({
    mutationFn: async (playbook_id: string) => {
      const { data, error } = await supabase.functions.invoke("validate-supplier-playbook", {
        body: { playbook_id },
      });
      if (error) throw error;
      return data;
    },
  });

  const activatePlaybook = useMutation({
    mutationFn: async (params: { playbook_id: string; supplier_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("activate-supplier-playbook", { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-playbooks", wsId] });
      qc.invalidateQueries({ queryKey: ["supplier-connector-setups", wsId] });
    },
  });

  const suggestTemplate = useMutation({
    mutationFn: async (file_types: string[]) => {
      const { data, error } = await supabase.functions.invoke("suggest-playbook-template", {
        body: { file_types },
      });
      if (error) throw error;
      return data;
    },
  });

  return {
    playbooks, connectorSetups, createPlaybook, runWizard,
    testConnector, validatePlaybook, activatePlaybook, suggestTemplate,
  };
}
