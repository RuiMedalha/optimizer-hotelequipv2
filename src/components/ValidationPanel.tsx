import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Info, XCircle, RefreshCw, Loader2 } from "lucide-react";
import { useValidationResults, useValidateProduct } from "@/hooks/useValidation";
import { cn } from "@/lib/utils";

interface Props {
  productId: string;
  className?: string;
}

const severityConfig = {
  error: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", label: "Erro" },
  warning: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10", label: "Aviso" },
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-500/10", label: "Info" },
};

export function ValidationPanel({ productId, className }: Props) {
  const { data: results, isLoading } = useValidationResults(productId);
  const validate = useValidateProduct();

  const errors = results?.filter(r => !r.passed && r.severity === "error") ?? [];
  const warnings = results?.filter(r => !r.passed && r.severity === "warning") ?? [];
  const infos = results?.filter(r => !r.passed && r.severity === "info") ?? [];
  const passed = results?.filter(r => r.passed) ?? [];

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Validação</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => validate.mutate({ productId })}
            disabled={validate.isPending}
          >
            {validate.isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
            )}
            Validar
          </Button>
        </div>
        {results && results.length > 0 && (
          <div className="flex gap-2 mt-2">
            {errors.length > 0 && (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                {errors.length} erro{errors.length !== 1 ? "s" : ""}
              </Badge>
            )}
            {warnings.length > 0 && (
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs">
                {warnings.length} aviso{warnings.length !== 1 ? "s" : ""}
              </Badge>
            )}
            {passed.length > 0 && (
              <Badge variant="outline" className="bg-success/10 text-success border-success/20 text-xs">
                {passed.length} OK
              </Badge>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-xs text-muted-foreground">A carregar...</p>}
        {!isLoading && (!results || results.length === 0) && (
          <p className="text-xs text-muted-foreground">Nenhuma validação executada. Clique em "Validar" para verificar.</p>
        )}
        {[...errors, ...warnings, ...infos].map((result, i) => {
          const config = severityConfig[result.severity as keyof typeof severityConfig] || severityConfig.info;
          const Icon = config.icon;
          const details = result.details as any;
          return (
            <div key={result.id || i} className={cn("flex items-start gap-2 p-2 rounded-md text-xs", config.bg)}>
              <Icon className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", config.color)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">{details?.field || result.actual_value || "—"}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">{config.label}</Badge>
                </div>
                <p className={cn("mt-0.5", config.color)}>{details?.message || "Falhou"}</p>
                {result.expected && (
                  <p className="text-muted-foreground mt-0.5">
                    Esperado: <span className="font-mono">{result.expected}</span>
                    {result.actual_value && <> · Atual: <span className="font-mono">{result.actual_value}</span></>}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
