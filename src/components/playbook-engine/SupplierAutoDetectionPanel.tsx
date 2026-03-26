import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, CheckCircle, AlertTriangle } from "lucide-react";

interface Props {
  detection: any | null;
  isDetecting: boolean;
  onConfirmSupplier?: () => void;
}

export function SupplierAutoDetectionPanel({ detection, isDetecting, onConfirmSupplier }: Props) {
  if (isDetecting) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-center gap-3 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-sm">A detetar fornecedor automaticamente...</span>
        </CardContent>
      </Card>
    );
  }

  if (!detection) return null;

  const isMatched = detection.status === "matched";
  const confidence = Math.round((detection.confidence || 0) * 100);

  return (
    <Card className={isMatched ? "border-green-500/20 bg-green-500/5" : "border-amber-500/20 bg-amber-500/5"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {isMatched ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Search className="w-4 h-4 text-amber-600" />}
          Fornecedor Detetado
          <Badge variant={isMatched ? "default" : "secondary"} className="text-[10px]">
            {confidence}% confiança
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {detection.detected_supplier_name && (
            <div>
              <p className="text-[10px] text-muted-foreground">Nome</p>
              <p className="font-medium">{detection.detected_supplier_name}</p>
            </div>
          )}
          {detection.detected_domain && (
            <div>
              <p className="text-[10px] text-muted-foreground">Domínio</p>
              <p className="font-mono text-xs">{detection.detected_domain}</p>
            </div>
          )}
          {detection.detected_brand && (
            <div>
              <p className="text-[10px] text-muted-foreground">Marca</p>
              <p>{detection.detected_brand}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-muted-foreground">Estado</p>
            <Badge variant={isMatched ? "default" : "outline"} className="text-[10px]">
              {isMatched ? "Associado" : "Não confirmado"}
            </Badge>
          </div>
        </div>

        {detection.detection_signals && Object.keys(detection.detection_signals).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(detection.detection_signals).map(([key]) => (
              <Badge key={key} variant="outline" className="text-[10px]">{key}</Badge>
            ))}
          </div>
        )}

        {!isMatched && onConfirmSupplier && (
          <div className="flex items-center gap-2 pt-2">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            <span className="text-xs text-muted-foreground">Fornecedor criado como draft. Confirme para associar.</span>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={onConfirmSupplier}>
              Confirmar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
