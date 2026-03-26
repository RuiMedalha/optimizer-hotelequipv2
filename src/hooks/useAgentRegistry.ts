import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

const DEFAULT_AGENTS = [
  { agent_name: "intake_classifier_agent", agent_type: "intake", description: "Classifica tipo de ficheiro e decide pipeline" },
  { agent_name: "source_reconciliation_agent", agent_type: "reconciliation", description: "Reconcilia dados de múltiplas fontes" },
  { agent_name: "product_identity_agent", agent_type: "identity", description: "Identifica e desduplicar produtos" },
  { agent_name: "technical_extraction_agent", agent_type: "extraction", description: "Extrai especificações técnicas" },
  { agent_name: "schema_mapping_agent", agent_type: "mapping", description: "Mapeia campos para schema canónico" },
  { agent_name: "commercial_enrichment_agent", agent_type: "enrichment", description: "Enriquece conteúdo comercial com IA" },
  { agent_name: "pricing_validation_agent", agent_type: "pricing", description: "Valida e otimiza preços" },
  { agent_name: "asset_processing_agent", agent_type: "assets", description: "Processa e otimiza imagens e media" },
  { agent_name: "validation_agent", agent_type: "validation", description: "Valida qualidade e completude" },
  { agent_name: "channel_publish_agent", agent_type: "publishing", description: "Publica para canais externos" },
];

export function useAgentRegistry() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  const agents = useQuery({
    queryKey: ["agent-profiles", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_profiles")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("agent_name");
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const seedAgents = useMutation({
    mutationFn: async () => {
      const rows = DEFAULT_AGENTS.map((a) => ({ workspace_id: wsId!, ...a }));
      const { error } = await supabase.from("agent_profiles").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Agentes registados"); qc.invalidateQueries({ queryKey: ["agent-profiles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const useAgentLogs = (agentId: string | null) =>
    useQuery({
      queryKey: ["agent-execution-logs", agentId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("agent_execution_logs")
          .select("*")
          .eq("agent_id", agentId!)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        return data;
      },
      enabled: !!agentId,
    });

  const useAgentCapabilities = (agentId: string | null) =>
    useQuery({
      queryKey: ["agent-capabilities", agentId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("agent_capabilities")
          .select("*")
          .eq("agent_id", agentId!);
        if (error) throw error;
        return data;
      },
      enabled: !!agentId,
    });

  const addCapability = useMutation({
    mutationFn: async (p: { agent_id: string; capability_name: string; capability_description?: string }) => {
      const { error } = await supabase.from("agent_capabilities").insert(p);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Capacidade adicionada"); qc.invalidateQueries({ queryKey: ["agent-capabilities"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { agents, seedAgents, useAgentLogs, useAgentCapabilities, addCapability };
}
