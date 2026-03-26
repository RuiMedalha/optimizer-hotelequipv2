import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowRight, Database, Loader2, CheckCircle, ShieldCheck, AlertTriangle } from "lucide-react";
import { useState } from "react";

interface Props {
  productCount: number;
  approvedCount?: number;
  onSendToIngestion: (config: { mergeStrategy: string; dupFields: string }) => void;
  isSending?: boolean;
  alreadySent?: boolean;
  requireApproval?: boolean;
}

export function SendToIngestionPanel({ productCount, approvedCount = 0, onSendToIngestion, isSending, alreadySent, requireApproval = true }: Props) {
  const [mergeStrategy, setMergeStrategy] = useState("merge");
  const allApproved = approvedCount >= productCount && productCount > 0;
  const canSend = !requireApproval || allApproved;

  return (
    <Card className="border-primary/30 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" /> Enviar para Ingestion Hub
        </CardTitle>
        <CardDescription>
          Os produtos extraídos serão enviados para o Ingestion Hub com deteção automática de SKUs existentes.
          Produtos com SKU já presente no catálogo serão atualizados em vez de duplicados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-foreground">{productCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</p>
          </div>
          {requireApproval && (
            <div className={`rounded-lg p-3 text-center ${allApproved ? "bg-primary/10" : "bg-amber-500/10"}`}>
              <p className="text-xl font-bold">{approvedCount}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Aprovados</p>
            </div>
          )}
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-foreground">SKU</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Match Automático</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-primary">AI</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Deteção</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="space-y-1 flex-1">
            <Label className="text-xs font-medium">Estratégia de Importação</Label>
            <Select value={mergeStrategy} onValueChange={setMergeStrategy}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">
                  <span className="flex items-center gap-1.5">🔄 Merge — insere novos, atualiza existentes</span>
                </SelectItem>
                <SelectItem value="insert_only">
                  <span className="flex items-center gap-1.5">➕ Apenas novos — ignora SKUs existentes</span>
                </SelectItem>
                <SelectItem value="update_only">
                  <span className="flex items-center gap-1.5">✏️ Apenas atualizar — ignora novos</span>
                </SelectItem>
                <SelectItem value="replace">
                  <span className="flex items-center gap-1.5">♻️ Substituir — sobrescreve tudo</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Approval warning */}
        {requireApproval && !allApproved && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">
              Aprove todos os {productCount} produtos na tabela acima antes de enviar para ingestão.
              ({productCount - approvedCount} pendentes de aprovação)
            </p>
          </div>
        )}

        {alreadySent ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
            <CheckCircle className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-primary">Enviado para Ingestion Hub com sucesso</p>
          </div>
        ) : (
          <Button
            onClick={() => onSendToIngestion({ mergeStrategy, dupFields: "sku" })}
            disabled={isSending || productCount === 0 || !canSend}
            className="w-full h-11 text-sm font-medium"
            size="lg"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : canSend ? (
              <ShieldCheck className="h-4 w-4 mr-2" />
            ) : (
              <AlertTriangle className="h-4 w-4 mr-2" />
            )}
            {canSend
              ? `Enviar ${productCount} produtos para Ingestion Hub`
              : `Aprove todos os produtos antes de enviar`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
