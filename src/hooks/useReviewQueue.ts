import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";
import { useEffect } from "react";

export function useReviewQueue(filters?: {
  status?: string;
  reason?: string;
  assignedTo?: string;
}) {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["review-queue", activeWorkspace?.id, filters],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      let q = supabase
        .from("review_queue")
        .select("*, products!inner(id, optimized_title, original_title, sku, quality_score, validation_status, image_urls)")
        .eq("workspace_id", activeWorkspace!.id)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });

      if (filters?.status && filters.status !== "all") {
        q = q.eq("status", filters.status as any);
      }
      if (filters?.reason && filters.reason !== "all") {
        q = q.eq("reason", filters.reason as any);
      }
      if (filters?.assignedTo) {
        q = q.eq("assigned_to", filters.assignedTo);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Realtime subscription
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const channel = supabase
      .channel("review-queue-changes")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "review_queue",
        filter: `workspace_id=eq.${activeWorkspace.id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["review-queue"] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeWorkspace?.id, qc]);

  return query;
}

export function useAssignReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, assignedTo }: { id: string; assignedTo: string }) => {
      const { error } = await supabase
        .from("review_queue")
        .update({ assigned_to: assignedTo, status: "in_review" as any })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Item atribuído!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useResolveReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reviewerNotes }: { id: string; status: "approved" | "rejected"; reviewerNotes?: string }) => {
      const { error } = await supabase
        .from("review_queue")
        .update({
          status: status as any,
          reviewer_notes: reviewerNotes || null,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success(vars.status === "approved" ? "Produto aprovado!" : "Produto rejeitado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
