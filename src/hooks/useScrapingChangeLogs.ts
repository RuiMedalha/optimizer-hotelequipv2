import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export function useScrapingChangeLogs(scheduleId?: string | null, limit = 50) {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["scraping-change-logs", workspaceId, scheduleId, limit],
    enabled: !!workspaceId,
    queryFn: async () => {
      let query = supabase
        .from("scraping_change_logs" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (scheduleId) {
        query = query.eq("schedule_id", scheduleId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useScrapingChangeStats(scheduleId?: string | null) {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["scraping-change-stats", workspaceId, scheduleId],
    enabled: !!workspaceId,
    queryFn: async () => {
      let query = supabase
        .from("scraping_change_logs" as any)
        .select("change_type, change_magnitude, created_at")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(500);

      if (scheduleId) {
        query = query.eq("schedule_id", scheduleId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const logs = (data || []) as any[];
      const stats = {
        total: logs.length,
        new_products: logs.filter(l => l.change_type === "new_product").length,
        removed_products: logs.filter(l => l.change_type === "removed_product").length,
        price_changes: logs.filter(l => l.change_type === "price_change").length,
        stock_changes: logs.filter(l => l.change_type === "stock_change").length,
        title_changes: logs.filter(l => l.change_type === "title_change").length,
        avg_price_change: 0,
      };

      const priceChanges = logs.filter(l => l.change_type === "price_change" && l.change_magnitude != null);
      if (priceChanges.length > 0) {
        stats.avg_price_change = priceChanges.reduce((sum: number, l: any) => sum + Math.abs(l.change_magnitude), 0) / priceChanges.length;
      }

      return stats;
    },
  });
}
