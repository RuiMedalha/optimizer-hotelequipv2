// src/components/ai-comparison/AiComparisonWizard.tsx
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, ChevronRight, ChevronLeft, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAiModelPricing } from "@/hooks/useAiPricingDashboard";
import {
  COMPARISON_SECTIONS,
  type ComparisonSection,
  executeComparison,
  useCreateComparisonRun,
  useCompleteComparisonRun,
  useFailComparisonRun,
} from "@/hooks/useAiComparison";
import type { Product } from "@/hooks/useProducts";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { AiComparisonResults } from "./AiComparisonResults";

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardStep = "products" | "models" | "sections" | "running" | "results";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected products from ProductsPage checkboxes */
  preSelectedProducts: Product[];
  /** All products currently visible (for sample picking) */
  allProducts: Product[];
}

const SAMPLE_SIZES = [5, 10, 20] as const;

// ── Tier badge helpers ─────────────────────────────────────────────────────────

const tierColors: Record<string, Record<string, string>> = {
  speed:   { fast: "text-success", medium: "text-warning",  slow: "text-destructive" },
  quality: { standard: "text-muted-foreground", high: "text-blue-500", premium: "text-purple-500" },
  cost:    { cheap: "text-success",  medium: "text-warning", expensive: "text-destructive" },
};

const tierLabels: Record<string, Record<string, string>> = {
  speed:   { fast: "⚡ Rápido", medium: "⏱ Médio", slow: "🐢 Lento" },
  quality: { standard: "★ Padrão", high: "★★ Alta",   premium: "★★★ Premium" },
  cost:    { cheap: "€",         medium: "€€",        expensive: "€€€" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AiComparisonWizard({
  open,
  onOpenChange,
  preSelectedProducts,
  allProducts,
}: Props) {
  const { activeWorkspace } = useWorkspaceContext();
  const { data: allPricing = [] } = useAiModelPricing();
  const createRun   = useCreateComparisonRun();
  const completeRun = useCompleteComparisonRun();
  const failRun     = useFailComparisonRun();

  const [step,             setStep]             = useState<WizardStep>("products");
  const [selectedProducts, setSelectedProducts] = useState<Product[]>(preSelectedProducts);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [selectedSections, setSelectedSections] = useState<Set<ComparisonSection>>(
    new Set<ComparisonSection>(["title", "description"])
  );
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [runId,    setRunId]    = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  // Only show canonical (non-legacy) active models
  const availableModels = allPricing.filter((p) => !p.model_id.includes("/"));

  const totalCalls = selectedProducts.length * selectedModelIds.size;

  const handleStart = useCallback(async () => {
    if (!activeWorkspace) return;
    setStep("running");
    setError(null);
    setProgress({ completed: 0, total: totalCalls });

    let run: Awaited<ReturnType<typeof createRun.mutateAsync>> | null = null;
    try {
      run = await createRun.mutateAsync({
        productIds: selectedProducts.map((p) => p.id),
        modelIds:   Array.from(selectedModelIds),
        sections:   Array.from(selectedSections),
      });
      setRunId(run.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep("sections");
      return;
    }

    try {
      await executeComparison({
        runId:       run.id,
        productIds:  selectedProducts.map((p) => p.id),
        modelIds:    Array.from(selectedModelIds),
        sections:    Array.from(selectedSections),
        workspaceId: activeWorkspace.id,
        onProgress:  (completed, total) => setProgress({ completed, total }),
      });

      await completeRun.mutateAsync(run.id);
      setStep("results");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro durante a comparação";
      console.error("[AiComparisonWizard] comparison failed:", msg);
      try {
        await failRun.mutateAsync({ runId: run.id, errorMessage: msg });
      } catch (failErr) {
        console.error("[AiComparisonWizard] could not mark run as failed:", failErr);
      }
      toast.error(`Comparação falhou: ${msg}`);
      setStep("sections");
      return;
    }
  }, [activeWorkspace, selectedProducts, selectedModelIds, selectedSections, totalCalls, createRun, completeRun, failRun]);

  const handleClose = useCallback(() => {
    setStep("products");
    setSelectedProducts(preSelectedProducts);
    setSelectedModelIds(new Set());
    setSelectedSections(new Set<ComparisonSection>(["title", "description"]));
    setProgress(null);
    setRunId(null);
    setError(null);
    onOpenChange(false);
  }, [preSelectedProducts, onOpenChange]);

  const isResultsStep = step === "results";

  const stepBack = () => {
    const prev: Partial<Record<WizardStep, WizardStep>> = {
      models:   "products",
      sections: "models",
    };
    const target = prev[step];
    if (target) setStep(target);
  };

  const stepForward = () => {
    const next: Partial<Record<WizardStep, WizardStep>> = {
      products: "models",
      models:   "sections",
    };
    const target = next[step];
    if (target) setStep(target);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={
          isResultsStep
            ? "max-w-7xl w-full h-[90vh] flex flex-col p-0"
            : "max-w-2xl"
        }
      >
        <DialogHeader className={isResultsStep ? "px-6 pt-6 pb-0" : undefined}>
          <DialogTitle className="flex items-center gap-2">
            Comparar modelos de IA
            <Badge variant="outline" className="text-xs font-normal">
              {step === "products" && "1/3 — Produtos"}
              {step === "models"   && "2/3 — Modelos"}
              {step === "sections" && "3/3 — Secções"}
              {step === "running"  && "A comparar..."}
              {step === "results"  && "Resultados"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* ── Step: Products ─────────────────────────────────────────────── */}
        {step === "products" && (
          <div className="space-y-4 px-6 pb-2">
            {preSelectedProducts.length > 0 && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm font-medium mb-2">
                  {preSelectedProducts.length} produto(s) selecionado(s) na página
                </p>
                <Button
                  size="sm"
                  variant={
                    JSON.stringify(selectedProducts.map((p) => p.id).sort()) ===
                    JSON.stringify(preSelectedProducts.map((p) => p.id).sort())
                      ? "default"
                      : "outline"
                  }
                  onClick={() => setSelectedProducts(preSelectedProducts)}
                >
                  Usar selecionados
                </Button>
              </div>
            )}

            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Ou escolhe uma amostra aleatória:
              </p>
              <div className="flex gap-2">
                {SAMPLE_SIZES.map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={selectedProducts.length === n ? "default" : "outline"}
                    disabled={allProducts.length < n}
                    onClick={() => setSelectedProducts(allProducts.slice(0, n))}
                  >
                    {n} produtos
                  </Button>
                ))}
              </div>
            </div>

            {selectedProducts.length > 0 && (
              <ScrollArea className="h-40 rounded border p-2">
                {selectedProducts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                    <span className="truncate">
                      {(p as any).optimized_title || (p as any).original_title || "Sem título"}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">
                      {(p as any).sku ?? ""}
                    </span>
                  </div>
                ))}
              </ScrollArea>
            )}
          </div>
        )}

        {/* ── Step: Models ───────────────────────────────────────────────── */}
        {step === "models" && (
          <ScrollArea className="h-80 px-6">
            <div className="space-y-2 pr-2">
              {availableModels.map((model) => {
                const meta = ((model as any).metadata ?? {}) as Record<string, string>;
                const checked = selectedModelIds.has(model.model_id);
                return (
                  <label
                    key={model.model_id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setSelectedModelIds((prev) => {
                          const next = new Set(prev);
                          v ? next.add(model.model_id) : next.delete(model.model_id);
                          return next;
                        });
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{model.display_name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 capitalize">
                          {model.provider_id}
                        </Badge>
                      </div>
                      {meta.best_for && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {meta.best_for}
                        </p>
                      )}
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {meta.speed_tier && (
                          <span
                            className={`text-[10px] font-medium ${
                              tierColors.speed[meta.speed_tier] ?? ""
                            }`}
                          >
                            {tierLabels.speed[meta.speed_tier] ?? meta.speed_tier}
                          </span>
                        )}
                        {meta.quality_tier && (
                          <span
                            className={`text-[10px] font-medium ${
                              tierColors.quality[meta.quality_tier] ?? ""
                            }`}
                          >
                            {tierLabels.quality[meta.quality_tier] ?? meta.quality_tier}
                          </span>
                        )}
                        {meta.cost_tier && (
                          <span
                            className={`text-[10px] font-medium ${
                              tierColors.cost[meta.cost_tier] ?? ""
                            }`}
                          >
                            {tierLabels.cost[meta.cost_tier] ?? meta.cost_tier} — $
                            {Number(model.input_cost_per_1m).toFixed(2)}/1M in
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* ── Step: Sections ─────────────────────────────────────────────── */}
        {step === "sections" && (
          <div className="space-y-2 px-6 pb-2">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}
            {COMPARISON_SECTIONS.map((section) => {
              const checked = selectedSections.has(section.id);
              return (
                <label
                  key={section.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      setSelectedSections((prev) => {
                        const next = new Set(prev);
                        v ? next.add(section.id) : next.delete(section.id);
                        return next;
                      });
                    }}
                  />
                  <span className="text-sm font-medium">{section.label}</span>
                </label>
              );
            })}
            <div className="mt-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
              <span className="font-semibold">Estimativa:</span> {totalCalls} chamadas de IA (
              {selectedProducts.length} produto(s) × {selectedModelIds.size} modelo(s))
            </div>
          </div>
        )}

        {/* ── Step: Running ──────────────────────────────────────────────── */}
        {step === "running" && progress && (
          <div className="space-y-4 px-6 pb-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="text-sm">
                A comparar... {progress.completed} / {progress.total}
              </span>
            </div>
            <Progress value={(progress.completed / progress.total) * 100} />
            <p className="text-xs text-muted-foreground">
              Processando em lotes de 3 em paralelo. Não feches esta janela.
            </p>
          </div>
        )}

        {/* ── Step: Results ──────────────────────────────────────────────── */}
        {step === "results" && runId && (
          <div className="flex-1 overflow-hidden px-6 pb-6">
            <AiComparisonResults
              runId={runId}
              products={selectedProducts}
              modelIds={Array.from(selectedModelIds)}
              sections={Array.from(selectedSections)}
            />
          </div>
        )}

        {/* ── Footer navigation ──────────────────────────────────────────── */}
        {step !== "running" && step !== "results" && (
          <DialogFooter className="px-6 pb-6 gap-2">
            {step !== "products" && (
              <Button variant="outline" onClick={stepBack}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
              </Button>
            )}

            {step === "sections" ? (
              <Button
                disabled={
                  selectedProducts.length === 0 ||
                  selectedModelIds.size === 0 ||
                  selectedSections.size === 0 ||
                  createRun.isPending
                }
                onClick={handleStart}
              >
                <Play className="w-4 h-4 mr-1" /> Iniciar comparação
              </Button>
            ) : (
              <Button
                disabled={
                  (step === "products" && selectedProducts.length === 0) ||
                  (step === "models" && selectedModelIds.size === 0)
                }
                onClick={stepForward}
              >
                Próximo <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
