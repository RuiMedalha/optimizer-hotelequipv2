import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useProductIdentity() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  const identityRules = useQuery({
    queryKey: ["product-identity-rules", wsId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("product_identity_rules") as any).select("*").eq("workspace_id", wsId!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const createIdentityRule = useMutation({
    mutationFn: async (p: { rule_name: string; rule_config: Record<string, unknown> }) => {
      const { error } = await (supabase.from("product_identity_rules") as any).insert({ workspace_id: wsId!, ...p });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Regra criada"); qc.invalidateQueries({ queryKey: ["product-identity-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const variationPolicies = useQuery({
    queryKey: ["variation-policies", wsId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("variation_policies") as any).select("*").eq("workspace_id", wsId!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const createVariationPolicy = useMutation({
    mutationFn: async (p: { policy_name: string; attribute_keys: string[]; variation_strategy: string }) => {
      const { error } = await (supabase.from("variation_policies") as any).insert({ workspace_id: wsId!, ...p });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Política criada"); qc.invalidateQueries({ queryKey: ["variation-policies"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const groupings = useQuery({
    queryKey: ["product-groupings", wsId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("product_groupings") as any).select("*").eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const seedDefaults = useMutation({
    mutationFn: async () => {
      const rules = [
        { workspace_id: wsId!, rule_name: "SKU Match", rule_config: { field: "sku", priority: 1, match_type: "exact" } },
        { workspace_id: wsId!, rule_name: "Supplier Ref Match", rule_config: { field: "supplier_ref", priority: 2, match_type: "exact" } },
        { workspace_id: wsId!, rule_name: "EAN Match", rule_config: { field: "ean", priority: 3, match_type: "exact" } },
        { workspace_id: wsId!, rule_name: "Model Match", rule_config: { field: "model", priority: 4, match_type: "fuzzy", threshold: 0.9 } },
        { workspace_id: wsId!, rule_name: "Normalized Name", rule_config: { field: "original_title", priority: 5, match_type: "fuzzy", threshold: 0.85 } },
      ];
      const policies = [
        { workspace_id: wsId!, policy_name: "Cor", attribute_keys: ["cor", "color", "colour"], variation_strategy: "auto" },
        { workspace_id: wsId!, policy_name: "Tamanho", attribute_keys: ["tamanho", "size", "dimensao"], variation_strategy: "auto" },
        { workspace_id: wsId!, policy_name: "Capacidade", attribute_keys: ["capacidade", "capacity", "volume"], variation_strategy: "auto" },
        { workspace_id: wsId!, policy_name: "Potência", attribute_keys: ["potencia", "power", "watts"], variation_strategy: "auto" },
        { workspace_id: wsId!, policy_name: "Tensão", attribute_keys: ["tensao", "voltage"], variation_strategy: "auto" },
        { workspace_id: wsId!, policy_name: "Comprimento", attribute_keys: ["comprimento", "length", "metros"], variation_strategy: "auto" },
      ];
      await (supabase.from("product_identity_rules") as any).insert(rules);
      await (supabase.from("variation_policies") as any).insert(policies);
    },
    onSuccess: () => {
      toast.success("Regras e políticas default criadas");
      qc.invalidateQueries({ queryKey: ["product-identity-rules"] });
      qc.invalidateQueries({ queryKey: ["variation-policies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { identityRules, createIdentityRule, variationPolicies, createVariationPolicy, groupings, seedDefaults };
}
