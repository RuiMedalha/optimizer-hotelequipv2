import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle, Zap } from "lucide-react";
import { PIPELINE_STEPS } from "@/hooks/useDocumentIntelligence";

interface ExtractionPipelineViewerProps {
  providerUsed?: string | null;
  providerModel?: string | null;
  extractionMode?: string | null;
  fallbackUsed?: boolean;
  fallbackProvider?: string | null;
  status?: string;
}

export function ExtractionPipelineViewer({
  providerUsed,
  providerModel,
  extractionMode,
  fallbackUsed,
  fallbackProvider,
  status,
}: ExtractionPipelineViewerProps) {
  const getStepStatus = (stepIdx: number) => {
    if (!status || status === "queued") return "pending";
    if (status === "extracting" && stepIdx === 0) return "running";
    if (status === "extracting" && stepIdx > 0) return "pending";
    if (status === "reviewing" || status === "done") return "done";
    if (status === "error") return stepIdx === 0 ? "error" : "pending";
    return "pending";
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case "done": return <CheckCircle className="h-4 w-4 text-primary" />;
      case "running": return <Zap className="h-4 w-4 text-accent-foreground animate-pulse" />;
      case "error": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Pipeline de Extração</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {PIPELINE_STEPS.map((step, idx) => (
            <div key={step.id} className="flex items-center gap-3">
              {statusIcon(getStepStatus(idx))}
              <div className="flex-1">
                <p className="text-xs font-medium text-foreground">{step.name}</p>
                <p className="text-[10px] text-muted-foreground">{step.id}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t pt-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Provider:</span>
            <span className="font-medium text-foreground">{providerUsed || "Lovable AI Gateway"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Modelo:</span>
            <span className="font-medium text-foreground">{providerModel || "google/gemini-2.5-flash"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Modo:</span>
            <Badge variant="outline" className="text-[10px] h-5">{extractionMode || "auto"}</Badge>
          </div>
          {fallbackUsed && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Fallback:</span>
              <Badge variant="secondary" className="text-[10px] h-5">{fallbackProvider}</Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
