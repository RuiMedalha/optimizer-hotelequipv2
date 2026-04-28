import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, AlertTriangle, CheckCircle, Zap } from "lucide-react";

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

      {/* Mapping grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Mapeamento Inteligente
            {inference && (
              <Badge variant="outline" className="text-[10px]">
                {Math.round((inference.confidence || 0) * 100)}% confiança média
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground font-normal ml-auto">
              Colunas não mapeadas serão guardadas como atributos adicionais.
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {headers.map(header => {
              const conf = getConfidence(header);
              const mapped = fieldMappings[header];
              return (
                <div key={header} className="flex items-center gap-2">
                  <div className="flex items-center gap-1 min-w-0 flex-shrink">
                    <span className="text-xs font-mono bg-muted px-2 py-1 rounded truncate" title={header}>
                      {header}
                    </span>
                    {conf && (
                      <span title={`${conf.method} · ${Math.round(conf.confidence * 100)}%`}>
                        {conf.confidence >= 0.8 ? (
                          <CheckCircle className="w-3 h-3 text-green-500" />
                        ) : conf.confidence >= 0.6 ? (
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-destructive" />
                        )}
                      </span>
                    )}
                  </div>
                  <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <Select value={mapped || "__skip__"} onValueChange={v => handleChange(header, v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Ignorar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip__">— Ignorar —</SelectItem>
                      {PRODUCT_FIELDS.map(f => (
                        <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Sample preview */}
      {sampleData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Preview (primeiras 5 linhas)</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-10">#</TableHead>
                    {headers.filter(h => fieldMappings[h] || headers.indexOf(h) < 6).slice(0, 10).map(h => (
                      <TableHead key={h} className="text-xs">
                        {h}
                        {fieldMappings[h] && (
                          <Badge variant="outline" className="ml-1 text-[9px] bg-primary/10">{fieldMappings[h]}</Badge>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sampleData.slice(0, 5).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      {headers.filter(h => fieldMappings[h] || headers.indexOf(h) < 6).slice(0, 10).map(h => {
                        const val = String(row[h] ?? "");
                        const isImage = fieldMappings[h] === "image_urls";
                        return (
                          <TableCell key={h} className="text-xs max-w-[200px] truncate">
                            {isImage && val.startsWith('http') ? (
                              <div className="flex items-center gap-2">
                                <img src={val.split(',')[0]} className="w-6 h-6 object-cover rounded border" alt="preview" />
                                <span className="truncate">{val}</span>
                              </div>
                            ) : val}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
