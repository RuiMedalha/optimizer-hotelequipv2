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

export interface BrainStats {
  totalObservations: number;
  recentObservations: number;
  totalPlans: number;
  activePlans: number;
  pendingApproval: number;
  completedPlans: number;
  failedPlans: number;
  totalOutcomes: number;
  positiveOutcomes: number;
  totalEntities: number;
  totalRelations: number;
}

export interface AgentStats {
  totalAgents: number;
  activeAgents: number;
  pausedAgents: number;
  totalTasks: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalActions: number;
  pendingApproval: number;
  approvedActions: number;
}

export interface AlertInfo {
  id: string;
  alert_type: string;
  message: string;
  severity: number;
  status: string;
  created_at: string;
  agent_id: string | null;
}

export interface RecentRun {
  agent_name: string;
  status: string;
  confidence_score: number | null;
  completed_at: string | null;
  created_at: string;
  latency_ms: number | null;
  cost_estimate: number | null;
}

export interface IntelligenceSummary {
  // Agent pipeline runs
  catalog: AgentLastRun | null;
  demand: AgentLastRun | null;
  revenue: AgentLastRun | null;
  // Brain stats
  brain: BrainStats;
  // Agent stats
  agents: AgentStats;
  // Alerts
  alerts: AlertInfo[];
  // Recent runs
  recentRuns: RecentRun[];
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
      // Parallel fetch all data sources
      const [
        catalogRunRes,
        demandRunRes,
        revenueRunRes,
        observationsRes,
        plansRes,
        outcomesRes,
        entitiesCountRes,
        relationsCountRes,
        agentsRes,
        tasksRes,
        actionsRes,
        alertsRes,
        recentRunsRes,
      ] = await Promise.all([
        // Pipeline runs
        supabase.from("agent_runs").select("agent_name, status, confidence_score, output_payload, completed_at, created_at")
          .eq("workspace_id", wsId!).eq("agent_name", "catalog_intelligence").eq("status", "completed")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("agent_runs").select("agent_name, status, confidence_score, output_payload, completed_at, created_at")
          .eq("workspace_id", wsId!).eq("agent_name", "demand_intelligence").eq("status", "completed")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("agent_runs").select("agent_name, status, confidence_score, output_payload, completed_at, created_at")
          .eq("workspace_id", wsId!).eq("agent_name", "revenue_optimization").eq("status", "completed")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        // Brain data
        supabase.from("catalog_brain_observations" as any).select("id, created_at", { count: "exact", head: false })
          .eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(100),
        supabase.from("catalog_brain_plans" as any).select("id, status, requires_approval")
          .eq("workspace_id", wsId!),
        supabase.from("catalog_brain_outcomes" as any).select("id, outcome_type, impact_score")
          .eq("workspace_id", wsId!),
        supabase.from("catalog_brain_entities" as any).select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId!),
        supabase.from("catalog_brain_relations" as any).select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId!),
        // Agents
        supabase.from("catalog_agents" as any).select("id, status")
          .eq("workspace_id", wsId!),
        supabase.from("agent_tasks" as any).select("id, status")
          .eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(200),
        supabase.from("agent_actions" as any).select("id, approved_by_user")
          .eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(200),
        // Alerts
        supabase.from("agent_runtime_alerts" as any).select("id, alert_type, message, severity, status, created_at, agent_id")
          .eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(20),
        // Recent runs (all agents)
        supabase.from("agent_runs").select("agent_name, status, confidence_score, completed_at, created_at, latency_ms, cost_estimate")
          .eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(15),
      ]);

      // Parse pipeline runs
      const catalog = catalogRunRes.data as AgentLastRun | null;
      const demand = demandRunRes.data as AgentLastRun | null;
      const revenue = revenueRunRes.data as AgentLastRun | null;

      // Brain stats
      const observations = (observationsRes.data || []) as any[];
      const plans = (plansRes.data || []) as any[];
      const outcomes = (outcomesRes.data || []) as any[];
      const now = Date.now();
      const recentCutoff = now - 7 * 24 * 60 * 60 * 1000; // 7 days

      const brain: BrainStats = {
        totalObservations: observations.length,
        recentObservations: observations.filter((o: any) => new Date(o.created_at).getTime() > recentCutoff).length,
        totalPlans: plans.length,
        activePlans: plans.filter((p: any) => p.status === "running" || p.status === "ready").length,
        pendingApproval: plans.filter((p: any) => p.status === "draft" && p.requires_approval).length,
        completedPlans: plans.filter((p: any) => p.status === "completed").length,
        failedPlans: plans.filter((p: any) => p.status === "failed").length,
        totalOutcomes: outcomes.length,
        positiveOutcomes: outcomes.filter((o: any) => (o.impact_score || 0) > 0).length,
        totalEntities: entitiesCountRes.count || 0,
        totalRelations: relationsCountRes.count || 0,
      };

      // Agent stats
      const agents = (agentsRes.data || []) as any[];
      const tasks = (tasksRes.data || []) as any[];
      const actions = (actionsRes.data || []) as any[];

      const agentStats: AgentStats = {
        totalAgents: agents.length,
        activeAgents: agents.filter((a: any) => a.status === "active").length,
        pausedAgents: agents.filter((a: any) => a.status === "paused").length,
        totalTasks: tasks.length,
        pendingTasks: tasks.filter((t: any) => t.status === "queued" || t.status === "pending").length,
        completedTasks: tasks.filter((t: any) => t.status === "completed").length,
        failedTasks: tasks.filter((t: any) => t.status === "failed").length,
        totalActions: actions.length,
        pendingApproval: actions.filter((a: any) => !a.approved_by_user).length,
        approvedActions: actions.filter((a: any) => a.approved_by_user).length,
      };

      // Alerts
      const alerts = ((alertsRes.data || []) as unknown as AlertInfo[]).filter((a: any) => a.status !== "resolved");

      // Recent runs
      const recentRuns = (recentRunsRes.data || []) as RecentRun[];

      // KPIs from pipeline outputs
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

      // Overall health: composite score
      const brainHealth = brain.totalPlans > 0 ? (brain.completedPlans / brain.totalPlans) * 100 : 50;
      const agentHealth = agentStats.totalTasks > 0 ? (agentStats.completedTasks / agentStats.totalTasks) * 100 : 50;
      const catalogHealth = Math.max(0, 100 - catalogPriority);
      const overallHealth = Math.round((brainHealth * 0.3 + agentHealth * 0.3 + catalogHealth * 0.4));

      return {
        catalog, demand, revenue,
        brain, agents: agentStats, alerts, recentRuns,
        totalIssues, highSeverityIssues,
        demandOpportunities, revenueOpportunities,
        estimatedRevenue, catalogPriority, overallHealth,
      };
    },
    enabled: !!wsId,
    staleTime: 60_000,
  });
}
