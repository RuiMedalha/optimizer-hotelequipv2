import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useValidationResults(productId: string | null) {
  return useQuery({
    queryKey: ["validation-results", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("validation_results")
        .select("*")
        .eq("product_id", productId!)
        .order("validated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useValidateProduct() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async ({ productId, channel }: { productId: string; channel?: string }) => {
      const { data, error } = await supabase.functions.invoke("validate-product", {
        body: {
          productId,
          workspaceId: activeWorkspace?.id,
          channel,
          forceRevalidate: true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["validation-results", data.productId] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["publish-locks"] });
      const status = data.validationStatus;
      if (status === "valid") toast.success(`Validação OK — Score: ${data.qualityScore}%`);
      else if (status === "partial") toast.warning(`Validação com avisos — Score: ${data.qualityScore}%`);
      else toast.error(`Validação falhou — ${data.errors?.length} erro(s)`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCategorySchemas() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["category-schemas", activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("category_schemas")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCategorySchema() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (schema: {
      name: string;
      category_id?: string | null;
      required_fields?: string[];
      optional_fields?: string[];
      variation_attributes?: any[];
      schema_definition?: any;
    }) => {
      const { error } = await supabase.from("category_schemas").insert({
        workspace_id: activeWorkspace!.id,
        name: schema.name,
        category_id: schema.category_id || null,
        required_fields: schema.required_fields || [],
        optional_fields: schema.optional_fields || [],
        variation_attributes: schema.variation_attributes || [],
        schema_definition: schema.schema_definition || {},
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-schemas"] });
      toast.success("Schema criado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateCategorySchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from("category_schemas").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-schemas"] });
      toast.success("Schema atualizado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteCategorySchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("category_schemas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-schemas"] });
      toast.success("Schema eliminado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useValidationRules(workspaceId?: string) {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = workspaceId || activeWorkspace?.id;
  return useQuery({
    queryKey: ["validation-rules", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("validation_rules")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("field_key");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateValidationRule() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (rule: {
      field_key: string;
      rule_type: string;
      rule_config?: any;
      severity?: string;
      schema_id?: string | null;
      error_message_template?: string;
    }) => {
      const { error } = await supabase.from("validation_rules").insert({
        workspace_id: activeWorkspace!.id,
        field_key: rule.field_key,
        rule_type: rule.rule_type as any,
        rule_config: rule.rule_config || {},
        severity: (rule.severity || "error") as any,
        schema_id: rule.schema_id || null,
        error_message_template: rule.error_message_template || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validation-rules"] });
      toast.success("Regra criada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteValidationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("validation_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validation-rules"] });
      toast.success("Regra eliminada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
