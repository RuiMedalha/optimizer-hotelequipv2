import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, AlertTriangle, CheckCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const PRODUCT_FIELDS = [
  { key: "sku", label: "SKU" },
  { key: "ean", label: "EAN / Código de Barras" },
  { key: "supplier_ref", label: "Ref. Fornecedor" },
  { key: "original_title", label: "Título" },
  { key: "original_description", label: "Descrição" },
  { key: "short_description", label: "Desc. Curta" },
  { key: "original_price", label: "Preço" },
  { key: "sale_price", label: "Preço Promo" },
  { key: "category", label: "Categoria" },
  { key: "brand", label: "Marca" },
  { key: "model", label: "Modelo" },
  { key: "image_urls", label: "Imagens" },
  { key: "tags", label: "Tags" },
  { key: "technical_specs", label: "Especificações" },
  { key: "dimensions", label: "Dimensões" },
  { key: "weight", label: "Peso" },
  { key: "material", label: "Material" },
  { key: "color", label: "Cor" },
  { key: "unit", label: "Unidade" },
  { key: "attributes", label: "Atributos (Geral)" },
  { key: "product_type", label: "Tipo Produto" },
  { key: "meta_title", label: "Meta Title" },
  { key: "meta_description", label: "Meta Desc" },
  { key: "seo_slug", label: "SEO Slug" },
];

interface Props {
  inference: any | null;
  headers: string[];
  sampleData: any[];
  fieldMappings: Record<string, string>;
  onMappingChange: (mappings: Record<string, string>) => void;
}

export function SmartColumnInferencePreview({ inference, headers, sampleData, fieldMappings, onMappingChange }: Props) {
  const detailedMapping = inference?.detailed_mapping || {};
  const warnings = inference?.warnings || [];

  const getConfidence = (header: string) => {
    const m = detailedMapping[header];
    if (!m) return null;
    return { confidence: m.confidence || 0, method: m.method || "unknown" };
  };

  const handleChange = (header: string, value: string) => {
    const next = { ...fieldMappings };
    if (value === "__skip__") delete next[header];
    else next[header] = value;
    onMappingChange(next);
  };

  return (
    <div className="space-y-4">
      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="py-3 space-y-1">
            {warnings.map((w: string, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs text-amber-700">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Integrated Mapping & Preview Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Mapeamento de Colunas e Preview
              {inference && (
                <Badge variant="outline" className="text-[10px]">
                  {Math.round((inference.confidence || 0) * 100)}% confiança média
                </Badge>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground font-normal">
              Deslize para o lado para ver todas as colunas ({headers.length}).
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="min-w-max pb-4">
              <Table className="table-auto">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-[10px] font-bold sticky left-0 bg-muted/50 z-30 w-12 border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">#</TableHead>
                    {headers.map(header => {
                      const conf = getConfidence(header);
                      const mapped = fieldMappings[header];
                      return (
                        <TableHead key={header} className="min-w-[220px] max-w-[350px] border-r py-3 px-4 align-top">
                          <div className="space-y-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Campo de Destino</span>
                              <Select value={mapped || "__skip__"} onValueChange={v => handleChange(header, v)}>
                                <SelectTrigger className={cn(
                                  "h-8 text-xs font-semibold w-full",
                                  mapped ? "border-primary bg-primary/5 text-primary" : "border-muted-foreground/20"
                                )}>
                                  <SelectValue placeholder="Ignorar" />
                                </SelectTrigger>
                                <SelectContent className="z-50">
                                  <SelectItem value="__skip__">— Ignorar —</SelectItem>
                                  {PRODUCT_FIELDS.map(f => (
                                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center gap-2 pt-2 border-t border-muted-foreground/10">
                              <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded truncate flex-1 block" title={header}>
                                {header}
                              </span>
                              {conf && (
                                <span title={`${conf.method} · ${Math.round(conf.confidence * 100)}%`}>
                                  {conf.confidence >= 0.8 ? (
                                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                                  ) : conf.confidence >= 0.6 ? (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                  ) : (
                                    <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sampleData.slice(0, 50).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-[10px] text-muted-foreground sticky left-0 bg-background z-20 border-r text-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">{i + 1}</TableCell>
                      {headers.map(h => {
                        const val = String(row[h] ?? "");
                        const isImage = fieldMappings[h] === "image_urls";
                        const isPrice = fieldMappings[h]?.includes('price');
                        const isEan = fieldMappings[h] === "ean";
                        
                        return (
                          <TableCell key={h} className={cn(
                            "text-xs max-w-[350px] border-r px-4",
                            fieldMappings[h] ? "bg-primary/5" : ""
                          )}>
                            {isImage && val.startsWith('http') ? (
                              <div className="flex items-center gap-2 overflow-hidden">
                                <img src={val.split(',')[0]} className="w-8 h-8 object-cover rounded border bg-white shrink-0" alt="preview" />
                                <span className="truncate text-[10px] text-muted-foreground">{val}</span>
                              </div>
                            ) : (
                              <div className={cn(
                                "truncate",
                                isPrice ? "font-mono font-bold text-green-700" : "",
                                isEan ? "font-mono" : ""
                              )}>
                                {val || <span className="text-muted-foreground/30 italic">vazio</span>}
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
