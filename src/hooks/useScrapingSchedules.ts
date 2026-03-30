import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useScrapingSchedules() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["scraping-schedules", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scraping_schedules" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useScrapingScheduleRuns(scheduleId: string | null) {
  return useQuery({
    queryKey: ["scraping-schedule-runs", scheduleId],
    enabled: !!scheduleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scraping_schedule_runs" as any)
        .select("*")
        .eq("schedule_id", scheduleId!)
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useCreateScrapingSchedule() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (schedule: {
      schedule_name: string;
      source_url: string;
      selectors?: any;
      field_mapping?: any;
      frequency: string;
      cron_expression: string;
      notify_on_changes?: boolean;
    }) => {
      const nextRun = calculateNextRun(schedule.frequency);
      const { data, error } = await supabase
        .from("scraping_schedules" as any)
        .insert({
          ...schedule,
          workspace_id: activeWorkspace!.id,
          next_run_at: nextRun.toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Agendamento criado com sucesso");
      queryClient.invalidateQueries({ queryKey: ["scraping-schedules"] });
    },
    onError: (e: Error) => toast.error("Erro ao criar agendamento: " + e.message),
  });
}

export function useUpdateScrapingSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase
        .from("scraping_schedules" as any)
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento atualizado");
      queryClient.invalidateQueries({ queryKey: ["scraping-schedules"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export function useDeleteScrapingSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("scraping_schedules" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento eliminado");
      queryClient.invalidateQueries({ queryKey: ["scraping-schedules"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export function useRunScheduleNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const { data, error } = await supabase.functions.invoke("run-scheduled-scrape", {
        body: { scheduleId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Scraping manual iniciado");
      queryClient.invalidateQueries({ queryKey: ["scraping-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["scraping-schedule-runs"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

function calculateNextRun(frequency: string): Date {
  const now = new Date();
  switch (frequency) {
    case "hourly": return new Date(now.getTime() + 60 * 60 * 1000);
    case "daily": return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly": return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "monthly": { const n = new Date(now); n.setMonth(n.getMonth() + 1); return n; }
    default: return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
}
