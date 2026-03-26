import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface QualityMetric {
  supplier_name: string;
  supplier_id: string;
  missing_fields_rate: number;
  conflict_rate: number;
  parse_error_rate: number;
  matching_accuracy: number;
  overall_score: number;
}

interface SupplierDataQualityPanelProps {
  metrics: QualityMetric[];
}

function MetricBar({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const pct = Math.round((invert ? 1 - value : value) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

export function SupplierDataQualityPanel({ metrics }: SupplierDataQualityPanelProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Qualidade de Dados por Fornecedor</CardTitle></CardHeader>
      <CardContent>
        {metrics.length ? (
          <div className="space-y-4">
            {metrics.map((m) => (
              <div key={m.supplier_id} className="border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{m.supplier_name}</span>
                  <span className="text-xs font-bold">{Math.round(m.overall_score * 100)}%</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <MetricBar label="Matching" value={m.matching_accuracy} />
                  <MetricBar label="Campos completos" value={m.missing_fields_rate} invert />
                  <MetricBar label="Sem conflitos" value={m.conflict_rate} invert />
                  <MetricBar label="Sem erros parse" value={m.parse_error_rate} invert />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">Sem dados de qualidade. Execute "Calcular Qualidade" num fornecedor.</p>
        )}
      </CardContent>
    </Card>
  );
}
