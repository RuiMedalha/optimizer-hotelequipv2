import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle, Eye, User, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const reasonLabels: Record<string, string> = {
  low_confidence: "Baixa confiança",
  ai_generated: "Gerado por IA",
  missing_fields: "Campos em falta",
  quality_gate_fail: "Quality gate falhou",
  validation_fail: "Validação falhou",
  human_requested: "Revisão manual",
};

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendente", color: "bg-warning/10 text-warning" },
  in_review: { label: "Em revisão", color: "bg-blue-500/10 text-blue-500" },
  approved: { label: "Aprovado", color: "bg-success/10 text-success" },
  rejected: { label: "Rejeitado", color: "bg-destructive/10 text-destructive" },
};

interface Props {
  item: any;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onOpen?: (productId: string) => void;
}

export function ReviewItemCard({ item, onApprove, onReject, onOpen }: Props) {
  const product = item.products;
  const title = product?.optimized_title || product?.original_title || product?.sku || "Sem título";
  const sc = statusConfig[item.status] || statusConfig.pending;

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          {product?.image_urls?.[0] ? (
            <img src={product.image_urls[0]} alt={title} className="w-10 h-10 rounded border object-contain bg-background shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded border bg-muted/30 flex items-center justify-center shrink-0">
              <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium truncate">{title}</p>
              <Badge variant="outline" className={cn("text-[10px]", sc.color)}>{sc.label}</Badge>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="secondary" className="text-[10px]">{reasonLabels[item.reason] || item.reason}</Badge>
              <span className="text-[10px] text-muted-foreground">Prioridade: {item.priority}</span>
              {product?.quality_score != null && (
                <span className={cn("text-[10px] font-mono",
                  product.quality_score >= 70 ? "text-success" :
                  product.quality_score >= 40 ? "text-warning" : "text-destructive"
                )}>
                  Score: {product.quality_score}%
                </span>
              )}
            </div>
            {item.reviewer_notes && (
              <p className="text-xs text-muted-foreground mt-1 italic">"{item.reviewer_notes}"</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onOpen && (
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onOpen(product?.id)}>
                <Eye className="w-3.5 h-3.5" />
              </Button>
            )}
            {item.status === "pending" || item.status === "in_review" ? (
              <>
                {onApprove && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-success hover:text-success" onClick={() => onApprove(item.id)}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </Button>
                )}
                {onReject && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onReject(item.id)}>
                    <XCircle className="w-3.5 h-3.5" />
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
