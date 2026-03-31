import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export interface ArchitectRule {
  id: string;
  workspace_id: string;
  user_id: string;
  source_category_id: string | null;
  source_category_name: string;
  action: "keep" | "convert_to_attribute" | "merge_into";
  target_category_id: string | null;
  attribute_slug: string | null;
  attribute_name: string | null;
  attribute_values: string[];
  attribute_woo_id: number | null;
  migration_status: "pending" | "attribute_created" | "migrating" | "migrated" | "error";
  migration_progress: number;
  migration_total: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function useArchitectRules() {
  const { activeWorkspace } = useWorkspaceContext();
  const wid = activeWorkspace?.id;

  return useQuery({
    queryKey: ["architect-rules", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("category_architect_rules")
        .select("*")
        .eq("workspace_id", wid!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as ArchitectRule[];
    },
  });
}

export function useSaveRule() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (rule: Partial<ArchitectRule> & { source_category_name: string; action: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !activeWorkspace) throw new Error("Not authenticated");

      if (rule.id) {
        const { error } = await supabase
          .from("category_architect_rules")
          .update({
            source_category_id: rule.source_category_id ?? null,
            source_category_name: rule.source_category_name,
            action: rule.action,
            target_category_id: rule.target_category_id ?? null,
            attribute_slug: rule.attribute_slug ?? null,
            attribute_name: rule.attribute_name ?? null,
            attribute_values: rule.attribute_values ?? [],
          })
          .eq("id", rule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("category_architect_rules")
          .insert({
            workspace_id: activeWorkspace.id,
            user_id: user.id,
            source_category_id: rule.source_category_id ?? null,
            source_category_name: rule.source_category_name,
            action: rule.action,
            target_category_id: rule.target_category_id ?? null,
            attribute_slug: rule.attribute_slug ?? null,
            attribute_name: rule.attribute_name ?? null,
            attribute_values: rule.attribute_values ?? [],
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["architect-rules"] });
      toast.success("Regra guardada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("category_architect_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["architect-rules"] });
      toast.success("Regra removida!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCreateWooAttribute() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (rule: ArchitectRule) => {
      if (!activeWorkspace) throw new Error("No workspace");
      const { data, error } = await supabase.functions.invoke("create-woo-attribute", {
        body: {
          workspaceId: activeWorkspace.id,
          ruleId: rule.id,
          name: rule.attribute_name || rule.attribute_slug,
          slug: rule.attribute_slug,
          values: rule.attribute_values,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["architect-rules"] });
      toast.success("Atributo criado no WooCommerce!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useMigrateProducts() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (rule: ArchitectRule) => {
      if (!activeWorkspace) throw new Error("No workspace");
      const { data, error } = await supabase.functions.invoke("migrate-category-to-attribute", {
        body: {
          workspaceId: activeWorkspace.id,
          ruleId: rule.id,
          sourceCategoryId: rule.source_category_id,
          attributeSlug: rule.attribute_slug,
          attributeValues: rule.attribute_values,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["architect-rules"] });
      toast.success("Migração concluída!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useResetRuleStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase
        .from("category_architect_rules")
        .update({ migration_status: "pending", error_message: null })
        .eq("id", ruleId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["architect-rules"] });
      toast.success("Estado resetado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteWooCategory() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (rule: ArchitectRule) => {
      if (!activeWorkspace) throw new Error("No workspace");
      const { data, error } = await supabase.functions.invoke("delete-woo-category", {
        body: {
          workspaceId: activeWorkspace.id,
          categoryId: rule.source_category_id,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["architect-rules"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Categoria removida!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
