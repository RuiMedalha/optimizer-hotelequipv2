// src/pages/AiComparisonHistoryPage.tsx
import { useState } from "react";
import { GitCompare, Loader2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useComparisonHistory,
  useProductsByIds,
  type ComparisonRun,
} from "@/hooks/useAiComparison";
import { AiComparisonResults } from "@/components/ai-comparison/AiComparisonResults";

// ── Run viewer sub-component ───────────────────────────────────────────────────

function RunViewer({ run, onClose }: { run: ComparisonRun; onClose: () => void }) {
  const { data: products = [], isLoading } = useProductsByIds(run.product_ids);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-7xl w-full h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-base flex items-center gap-2">
            <GitCompare className="w-4 h-4" />
            Comparação de {new Date(run.created_at).toLocaleString("pt-PT")}
            <Badge variant="secondary" className="ml-auto text-xs">
              {run.model_ids.length} modelos · {run.product_count} produto{run.product_count !== 1 ? "s" : ""}
            </Badge>
          </DialogTitle>
          <div className="flex flex-wrap gap-1 mt-1">
            {run.model_ids.map((m) => (
              <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <AiComparisonResults
              runId={run.id}
              products={products}
              modelIds={run.model_ids}
              sections={run.sections}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiComparisonHistoryPage() {
  const { data: runs = [], isLoading } = useComparisonHistory();
  const [viewing, setViewing] = useState<ComparisonRun | null>(null);

  const statusLabel: Record<string, string> = {
    completed: "Concluída",
    running:   "A correr",
    cancelled: "Cancelada",
    failed:    "Falhou",
    partial:   "Parcial",
  };

  const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: "default",
    running:   "secondary",
    cancelled: "outline",
    failed:    "destructive",
    partial:   "outline",
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <GitCompare className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold">Histórico de Comparações IA</h1>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-24 text-sm text-muted-foreground">
          Nenhuma comparação realizada ainda.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Data</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Modelos</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Produtos</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Estado</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(run.created_at).toLocaleString("pt-PT")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-sm">
                      {run.model_ids.slice(0, 3).map((m) => (
                        <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
                      ))}
                      {run.model_ids.length > 3 && (
                        <Badge variant="outline" className="text-[10px]">+{run.model_ids.length - 3}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{run.product_count}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[run.status] ?? "secondary"} className="text-[10px]">
                      {statusLabel[run.status] ?? run.status}
                    </Badge>
                    {run.status === "running" && run.created_at && (
                      (() => {
                        const ageMinutes = (Date.now() - new Date(run.created_at).getTime()) / 60_000;
                        return ageMinutes > 30 ? (
                          <span className="text-xs text-muted-foreground ml-1">(pode estar presa)</span>
                        ) : null;
                      })()
                    )}
                    {(run.applications_count?.[0]?.count ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {run.applications_count![0].count} campo(s) aplicado(s)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1"
                      disabled={run.status !== "completed"}
                      onClick={() => setViewing(run)}
                    >
                      Rever <ChevronRight className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <RunViewer run={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
