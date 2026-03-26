import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Save, RotateCcw, MapPin } from "lucide-react";
import { toast } from "sonner";

const FIELD_OPTIONS = [
  { value: "product_name", label: "Nome do Produto" },
  { value: "sku", label: "SKU" },
  { value: "supplier_reference", label: "Ref. Fornecedor" },
  { value: "price", label: "Preço" },
  { value: "description", label: "Descrição" },
  { value: "short_description", label: "Descrição Curta" },
  { value: "technical_specs", label: "Especificações" },
  { value: "category", label: "Categoria" },
  { value: "attribute", label: "Atributo" },
  { value: "dimension", label: "Dimensão" },
  { value: "weight", label: "Peso" },
  { value: "power", label: "Potência" },
  { value: "material", label: "Material" },
  { value: "image", label: "Imagem" },
  { value: "ignore", label: "Ignorar" },
];

interface ColumnMapping {
  header: string;
  mappedTo: string;
  confidence: number;
  sampleValues: string[];
}

interface Props {
  columns: ColumnMapping[];
  onMappingChange: (header: string, mappedTo: string) => void;
  onSave: () => void;
  onReset: () => void;
  isSaving?: boolean;
}

export function MappingEditor({ columns, onMappingChange, onSave, onReset, isSaving }: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Mapeamento de Campos
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onReset}>
              <RotateCcw className="h-3 w-3 mr-1" /> Reset
            </Button>
            <Button size="sm" onClick={onSave} disabled={isSaving}>
              <Save className="h-3 w-3 mr-1" /> Guardar Regras
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-72">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Coluna Detetada</TableHead>
                <TableHead className="text-xs">Mapeado Para</TableHead>
                <TableHead className="text-xs">Confiança</TableHead>
                <TableHead className="text-xs">Exemplos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {columns.map((col) => (
                <TableRow key={col.header}>
                  <TableCell className="text-xs font-medium">{col.header}</TableCell>
                  <TableCell>
                    <Select value={col.mappedTo} onValueChange={(v) => onMappingChange(col.header, v)}>
                      <SelectTrigger className="h-7 text-xs w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_OPTIONS.map((f) => (
                          <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={col.confidence >= 80 ? "default" : col.confidence >= 50 ? "secondary" : "outline"} className="text-[10px]">
                      {col.confidence}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-40 truncate">
                    {col.sampleValues.slice(0, 3).join(", ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
