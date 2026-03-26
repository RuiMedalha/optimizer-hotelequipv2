import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertTriangle, Play, Edit, Eye, Save, RefreshCw } from "lucide-react";

interface Props {
  detection: any | null;
  inference: any | null;
  draft: any | null;
  parsedData: any[] | null;
  fieldMappings: Record<string, string>;
  onConfirmImport: () => void;
  onCorrectMapping: () => void;
  onSaveDraft: () => void;
  onReprocess: () => void;
  isImporting: boolean;
}

export function ImportPreviewBeforeRun({
  detection, inference, draft, parsedData, fieldMappings,
  onConfirmImport, onCorrectMapping, onSaveDraft, onReprocess, isImporting,
}: Props) {
  if (!parsedData) return null;

  const totalRows = parsedData.length;
  const mappedFields = Object.keys(fieldMappings).length;
  const lowConfFields = (inference?.warnings || []).length;
  const confidence = Math.round((inference?.confidence || 0) * 100);

  // Estimate valid/doubtful rows
  const hasSku = Object.values(fieldMappings).includes("sku") || Object.values(fieldMappings).includes("supplier_ref");
  const hasTitle = Object.values(fieldMappings).includes("original_title");
  const skuKey = Object.entries(fieldMappings).find(([_, v]) => v === "sku" || v === "supplier_ref")?.[0];

  let validRows = 0;
  let doubtfulRows = 0;
  if (parsedData && skuKey) {
    for (const row of parsedData) {
      if (row[skuKey] && String(row[skuKey]).trim()) validRows++;
      else doubtfulRows++;
    }
  } else {
    validRows = totalRows;
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          Revisão Antes de Importar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{totalRows}</p>
            <p className="text-[10px] text-muted-foreground">Total Linhas</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-green-600">{validRows}</p>
            <p className="text-[10px] text-muted-foreground">Válidas</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-amber-600">{doubtfulRows}</p>
            <p className="text-[10px] text-muted-foreground">Duvidosas</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{mappedFields}</p>
            <p className="text-[10px] text-muted-foreground">Colunas Mapeadas</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{confidence}%</p>
            <p className="text-[10px] text-muted-foreground">Confiança</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-amber-600">{lowConfFields}</p>
            <p className="text-[10px] text-muted-foreground">Avisos</p>
          </div>
        </div>

        {/* Checks */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            {detection?.matched_supplier_id ? (
              <CheckCircle className="w-3 h-3 text-green-500" />
            ) : (
              <AlertTriangle className="w-3 h-3 text-amber-500" />
            )}
            <span>Fornecedor: {detection?.detected_supplier_name || "Não detetado"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {hasSku ? <CheckCircle className="w-3 h-3 text-green-500" /> : <AlertTriangle className="w-3 h-3 text-destructive" />}
            <span>Coluna SKU/Ref: {hasSku ? "Mapeada" : "Em falta"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {hasTitle ? <CheckCircle className="w-3 h-3 text-green-500" /> : <AlertTriangle className="w-3 h-3 text-amber-500" />}
            <span>Coluna Nome: {hasTitle ? "Mapeada" : "Em falta"}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={onConfirmImport} disabled={isImporting} className="gap-1">
            <Play className="w-4 h-4" /> Confirmar e Importar
          </Button>
          <Button variant="outline" onClick={onCorrectMapping} className="gap-1">
            <Edit className="w-4 h-4" /> Corrigir Mapping
          </Button>
          <Button variant="outline" onClick={onSaveDraft} className="gap-1">
            <Save className="w-4 h-4" /> Guardar Draft
          </Button>
          <Button variant="ghost" onClick={onReprocess} className="gap-1">
            <RefreshCw className="w-4 h-4" /> Reprocessar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
