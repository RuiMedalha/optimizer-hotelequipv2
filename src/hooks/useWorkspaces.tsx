import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { getStorageItem, setStorageItem } from "@/lib/safeStorage";

export interface Workspace {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  has_variable_products: boolean;
  created_at: string;
  updated_at: string;
}

interface CopyOptions {
  providers: boolean;
  routing: boolean;
  prompts: boolean;
  categories: boolean;
}

interface WorkspaceContextType {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  isLoading: boolean;
  createWorkspace: (name: string, description?: string, copyFromWorkspaceId?: string, copyOptions?: CopyOptions) => void;
  updateWorkspace: (id: string, name: string, description?: string) => void;
  toggleVariableProducts: (id: string, value: boolean) => void;
  deleteWorkspace: (id: string) => void;
  mergeWorkspaces: (sourceId: string, targetId: string) => void;
  isCreating: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspaceContext() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceContext must be used within WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(() => {
    return getStorageItem("active_workspace_id");
  });

  const { data: workspaces = [], isLoading, error: workspacesError } = useQuery({
    queryKey: ["workspaces"],
    enabled: !!user,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Workspace[];
    },
  });

  // Show error toast when workspace loading fails persistently
  useEffect(() => {
    if (workspacesError) {
      console.error("[WorkspaceProvider] Failed to load workspaces:", workspacesError);
      toast.error("Erro ao carregar workspaces. Verifique a sua conexão e tente recarregar.");
    }
  }, [workspacesError]);

  // Auto-create default workspace if none exist
  useEffect(() => {
    if (!isLoading && workspaces.length === 0 && user) {
      supabase
        .from("workspaces")
        .insert({ user_id: user.id, name: "Geral", description: "Workspace padrão" } as any)
        .select()
        .single()
        .then(({ data }) => {
          if (data) {
            qc.invalidateQueries({ queryKey: ["workspaces"] });
          }
        });
    }
  }, [isLoading, workspaces.length, user]);

  // Auto-select first workspace
  useEffect(() => {
    if (workspaces.length > 0 && (!activeId || !workspaces.find((w) => w.id === activeId))) {
      const id = workspaces[0].id;
      setActiveId(id);
      setStorageItem("active_workspace_id", id);
    }
  }, [workspaces, activeId]);

  const activeWorkspace = workspaces.find((w) => w.id === activeId) || null;

  const setActiveWorkspaceId = (id: string) => {
    const previousId = activeId;
    setActiveId(id);
    setStorageItem("active_workspace_id", id);
    if (previousId && previousId !== id) {
      qc.invalidateQueries({
        predicate: (query) => query.queryKey.includes(previousId),
        refetchType: "none",
      });
    }
  };

  const createMutation = useMutation({
    mutationFn: async ({ name, description, copyFromWorkspaceId, copyOpts }: { name: string; description?: string; copyFromWorkspaceId?: string; copyOpts?: CopyOptions }) => {
      if (!user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("workspaces")
        .insert({ user_id: user.id, name, description: description || null } as any)
        .select()
        .single();
      if (error) throw error;
      const newWs = data as unknown as Workspace;

      // Copy config from source workspace if requested
      if (copyFromWorkspaceId && copyOpts) {
        const anyCopy = copyOpts.providers || copyOpts.routing || copyOpts.prompts || copyOpts.categories;
        if (anyCopy) {
          const { data: copyResult, error: copyError } = await supabase.functions.invoke("copy-workspace-config", {
            body: {
              sourceWorkspaceId: copyFromWorkspaceId,
              targetWorkspaceId: newWs.id,
              copyProviders: copyOpts.providers,
              copyRouting: copyOpts.routing,
              copyPrompts: copyOpts.prompts,
              copyCategories: copyOpts.categories,
            },
          });
          if (copyError) {
            console.warn("Failed to copy workspace config:", copyError);
          } else if (copyResult?.stats) {
            const s = copyResult.stats;
            const parts: string[] = [];
            if (s.providers > 0) parts.push(`${s.providers} providers`);
            if (s.routing > 0) parts.push(`${s.routing} regras`);
            if (s.prompts > 0) parts.push(`${s.prompts} prompts`);
            if (s.categories > 0) parts.push(`${s.categories} categorias`);
            if (parts.length > 0) {
              toast.info(`Configuração copiada: ${parts.join(", ")}`);
            }
          }
        }
      }

      return newWs;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setActiveWorkspaceId(data.id);
      toast.success(`Workspace "${data.name}" criado!`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, description, has_variable_products }: { id: string; name: string; description?: string; has_variable_products?: boolean }) => {
      const updateData: any = { name, description: description || null };
      if (has_variable_products !== undefined) updateData.has_variable_products = has_variable_products;
      const { error } = await supabase
        .from("workspaces")
        .update(updateData)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace atualizado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workspaces").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (deletedId) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      if (activeId === deletedId && workspaces.length > 1) {
        const other = workspaces.find((w) => w.id !== deletedId);
        if (other) setActiveWorkspaceId(other.id);
      }
      toast.success("Workspace eliminado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      const { data, error } = await supabase.functions.invoke("merge-workspaces", {
        body: { sourceId, targetId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { targetId, merged: data?.merged ?? 0, moved: data?.moved ?? 0 };
    },
    onSuccess: ({ targetId, merged, moved }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["uploaded-files"] });
      setActiveWorkspaceId(targetId);
      toast.success(`Workspaces fundidos! ${merged} produtos enriquecidos, ${moved} movidos.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        setActiveWorkspaceId,
        isLoading,
        createWorkspace: (name, description, copyFromWorkspaceId, copyOpts) => createMutation.mutate({ name, description, copyFromWorkspaceId, copyOpts }),
        updateWorkspace: (id, name, description) => updateMutation.mutate({ id, name, description }),
        toggleVariableProducts: (id: string, value: boolean) => {
          const ws = workspaces.find((w) => w.id === id);
          if (ws) updateMutation.mutate({ id, name: ws.name, description: ws.description || undefined, has_variable_products: value });
        },
        deleteWorkspace: (id) => deleteMutation.mutate(id),
        mergeWorkspaces: (sourceId, targetId) => mergeMutation.mutate({ sourceId, targetId }),
        isCreating: createMutation.isPending,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
