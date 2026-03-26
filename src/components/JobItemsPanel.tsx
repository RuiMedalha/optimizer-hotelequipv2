import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Check, X, Clock, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobItem } from "@/hooks/useJobItems";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";

const statusConfig: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
  queued: { icon: <Clock className="h-3 w-3" />, label: "Na fila", className: "text-muted-foreground" },
  processing: { icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "A processar", className: "text-primary" },
  done: { icon: <Check className="h-3 w-3" />, label: "Concluído", className: "text-success" },
  error: { icon: <X className="h-3 w-3" />, label: "Erro", className: "text-destructive" },
  skipped: { icon: <SkipForward className="h-3 w-3" />, label: "Ignorado", className: "text-muted-foreground" },
};

interface Props {
  items: JobItem[];
  title?: string;
  productNames?: Record<string, string>;
}

export function JobItemsPanel({ items, title = "Items do Job", productNames = {} }: Props) {
  if (!items || items.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Sem items de job registados.
        </CardContent>
      </Card>
    );
  }

  const done = items.filter(i => i.status === "done").length;
  const errors = items.filter(i => i.status === "error").length;
  const processing = items.filter(i => i.status === "processing").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <div className="flex gap-2 text-xs">
            <span className="text-success">{done} ✓</span>
            {errors > 0 && <span className="text-destructive">{errors} ✗</span>}
            {processing > 0 && <span className="text-primary">{processing} ⟳</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[300px]">
          <div className="space-y-1">
            {items.map((item) => {
              const config = statusConfig[item.status] || statusConfig.queued;
              const name = productNames[item.product_id] || item.product_id.slice(0, 8);

              const sanitizedError = item.error_message ? sanitizeErrorMessage(item.error_message) : null;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center justify-between py-1.5 px-2 rounded text-xs",
                    item.status === "error" && "bg-destructive/5"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={config.className}>{config.icon}</span>
                    <span className="truncate">{name}</span>
                  </div>

                  <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                    {item.duration_ms != null && (
                      <span>{(item.duration_ms / 1000).toFixed(1)}s</span>
                    )}
                    {item.retry_count > 0 && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        R{item.retry_count}
                      </Badge>
                    )}
                    {sanitizedError && (
                      <span
                        className="text-destructive truncate max-w-[150px]"
                        title={sanitizedError.message}
                      >
                        {sanitizedError.message.slice(0, 40)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
