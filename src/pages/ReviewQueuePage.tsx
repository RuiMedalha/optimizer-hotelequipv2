import { useState } from "react";
import { useReviewQueue, useResolveReviewItem, useAssignReviewItem } from "@/hooks/useReviewQueue";
import { ReviewItemCard } from "@/components/ReviewItemCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";

const ReviewQueuePage = () => {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [reasonFilter, setReasonFilter] = useState("all");
  const { data: items, isLoading } = useReviewQueue({ status: statusFilter, reason: reasonFilter });
  const resolveItem = useResolveReviewItem();
  const assignItem = useAssignReviewItem();

  const counts = {
    pending: items?.filter(i => i.status === "pending").length ?? 0,
    in_review: items?.filter(i => i.status === "in_review").length ?? 0,
    total: items?.length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6" /> Fila de Revisão
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Produtos que necessitam de revisão humana antes de publicação
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">{counts.pending} pendentes</Badge>
          <Badge variant="outline">{counts.in_review} em revisão</Badge>
        </div>
      </div>

      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="in_review">Em revisão</SelectItem>
            <SelectItem value="approved">Aprovados</SelectItem>
            <SelectItem value="rejected">Rejeitados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os motivos</SelectItem>
            <SelectItem value="validation_fail">Validação falhou</SelectItem>
            <SelectItem value="low_confidence">Baixa confiança</SelectItem>
            <SelectItem value="quality_gate_fail">Quality gate</SelectItem>
            <SelectItem value="missing_fields">Campos em falta</SelectItem>
            <SelectItem value="human_requested">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}
        {!isLoading && (!items || items.length === 0) && (
          <div className="text-center py-12">
            <ClipboardList className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum item na fila de revisão</p>
          </div>
        )}
        {items?.map(item => (
          <ReviewItemCard
            key={item.id}
            item={item}
            onApprove={id => resolveItem.mutate({ id, status: "approved" })}
            onReject={id => resolveItem.mutate({ id, status: "rejected" })}
          />
        ))}
      </div>
    </div>
  );
};

export default ReviewQueuePage;
