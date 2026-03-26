import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export interface AgentLastRun {
  agent_name: string;
  status: string | null;
  confidence_score: number | null;
  output_payload: any;
  completed_at: string | null;
  created_at: string | null;
}

export interface IntelligenceSummary {
  catalog: AgentLastRun | null;
  demand: AgentLastRun | null;
  revenue: AgentLastRun | null;
  // Derived KPIs
  totalIssues: number;
  highSeverityIssues: number;
  demandOpportunities: number;
  revenueOpportunities: number;
  estimatedRevenue: number;
  catalogPriority: number;
  overallHealth: number;
}

export function useIntelligenceDashboard() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["intelligence-dashboard", wsId],
    queryFn: async (): Promise<IntelligenceSummary> => {
      // Fetch latest run per agent
      const agentNames = ["catalog_intelligence", "demand_intelligence", "revenue_optimization"];
      const runs: Record<string, AgentLastRun | null> = {};

      await Promise.all(agentNames.map(async (name) => {
        const { data } = await supabase
          .from("agent_runs")
          .select("agent_name, status, confidence_score, output_payload, completed_at, created_at")
          .eq("workspace_id", wsId!)
          .eq("agent_name", name)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        runs[name] = data as AgentLastRun | null;
      }));

      const catalog = runs["catalog_intelligence"];
      const demand = runs["demand_intelligence"];
      const revenue = runs["revenue_optimization"];

      // Extract KPIs from outputs
      const catOutput = catalog?.output_payload || {};
      const demOutput = demand?.output_payload || {};
      const revOutput = revenue?.output_payload || {};

      const totalIssues = (catOutput.issues_found || []).length;
      const highSeverityIssues = (catOutput.issues_found || []).filter((i: any) => i.severity === "high").length;
      const catalogPriority = catOutput.priority_score || 0;

      const demandOpportunities = (demOutput.missing_catalog_opportunities || []).length + (demOutput.high_demand_products || []).length;

      const revOpps = revOutput.revenue_opportunities || [];
      const revenueOpportunities = revOpps.length;
      const estimatedRevenue = revOutput.estimated_impact?.total_estimated_revenue || revOpps.reduce((s: number, o: any) => s + (o.estimated_revenue_impact || 0), 0);

      // Overall health: 100 - normalized issues
      const overallHealth = Math.max(0, Math.min(100, 100 - catalogPriority));

      return {
        catalog, demand, revenue,
        totalIssues, highSeverityIssues,
        demandOpportunities, revenueOpportunities,
        estimatedRevenue, catalogPriority, overallHealth,
      };
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });
}
