import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, AlertTriangle, Info, ShieldCheck, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";

interface GateFailure {
  field: string;
  rule: string;
  severity: string;
  expected: any;
  actual: any;
  message: string;
}

interface GateResult {
  id: string;
  gate_id: string;
  passed: boolean;
  score: number;
  failures: GateFailure[];
  evaluated_at: string;
}

interface Props {
  results: GateResult[];
  gateName?: string;
  className?: string;
}

const severityConfig: Record<string, { icon: React.ReactNode; className: string }> = {
  error: { icon: <X className="h-3 w-3" />, className: "text-destructive" },
  warning: { icon: <AlertTriangle className="h-3 w-3" />, className: "text-warning" },
  info: { icon: <Info className="h-3 w-3" />, className: "text-muted-foreground" },
};

export function QualityGatePanel({ results, gateName, className }: Props) {
  if (!results || results.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          Nenhuma avaliação de qualidade disponível.
        </CardContent>
      </Card>
    );
  }

  const latestResult = results[0]; // most recent
  const passed = latestResult.passed;
  const failures = (latestResult.failures || []) as GateFailure[];
  const errors = failures.filter(f => f.severity === "error");
  const warnings = failures.filter(f => f.severity === "warning");

  return (
    <Card className={cn(passed ? "border-success/20" : "border-destructive/20", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {passed ? (
              <ShieldCheck className="h-4 w-4 text-success" />
            ) : (
              <ShieldX className="h-4 w-4 text-destructive" />
            )}
            {gateName || "Quality Gate"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                passed
                  ? "bg-success/10 text-success border-success/20"
                  : "bg-destructive/10 text-destructive border-destructive/20"
              )}
            >
              {latestResult.score}%
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                passed
                  ? "bg-success/10 text-success border-success/20"
                  : "bg-destructive/10 text-destructive border-destructive/20"
              )}
            >
              {passed ? "Aprovado" : "Reprovado"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      {failures.length > 0 && (
        <CardContent className="pt-0">
          <div className="space-y-1">
            {failures.map((failure, idx) => {
              const config = severityConfig[failure.severity] || severityConfig.info;
              return (
                <div key={idx} className="flex items-start gap-2 text-xs py-1">
                  <span className={cn("mt-0.5 shrink-0", config.className)}>{config.icon}</span>
                  <span className={config.className}>{failure.message}</span>
                </div>
              );
            })}
          </div>
          {errors.length === 0 && warnings.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Apenas avisos — publicação permitida.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
