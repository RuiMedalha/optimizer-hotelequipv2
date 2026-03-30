import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { GitCompare, ArrowUp, ArrowDown, Plus, Minus, Equal } from "lucide-react";

interface Extraction {
  id: string;
  created_at: string;
  status: string;
  detected_products?: any[];
  total_pages?: number;
  uploaded_files?: { file_name?: string };
}

interface DiffItem {
  sku: string;
  title: string;
  type: "added" | "removed" | "changed" | "unchanged";
  changes?: { field: string; oldVal: string; newVal: string }[];
}

function normalizeProducts(products: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const p of products) {
    const key = p.sku || p.ref || p.title || `unnamed-${Math.random()}`;
    map.set(key, p);
  }
  return map;
}

function compareProducts(oldProducts: any[], newProducts: any[]): { diffs: DiffItem[]; stats: { added: number; removed: number; changed: number; unchanged: number; priceChanges: number } } {
  const oldMap = normalizeProducts(oldProducts);
  const newMap = normalizeProducts(newProducts);
  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);
  const diffs: DiffItem[] = [];
  let added = 0, removed = 0, changed = 0, unchanged = 0, priceChanges = 0;

  const compareFields = ["title", "price", "description", "category", "material", "dimensions", "weight"];

  for (const key of allKeys) {
    const oldP = oldMap.get(key);
    const newP = newMap.get(key);

    if (!oldP) {
      diffs.push({ sku: key, title: newP?.title || key, type: "added" });
      added++;
    } else if (!newP) {
      diffs.push({ sku: key, title: oldP?.title || key, type: "removed" });
      removed++;
    } else {
      const changes: { field: string; oldVal: string; newVal: string }[] = [];
      for (const field of compareFields) {
        const ov = String(oldP[field] ?? "");
        const nv = String(newP[field] ?? "");
        if (ov !== nv && (ov || nv)) {
          changes.push({ field, oldVal: ov, newVal: nv });
          if (field === "price") priceChanges++;
        }
      }
      // Compare pricing object
      const oldPricing = oldP.pricing || {};
      const newPricing = newP.pricing || {};
      for (const pf of ["unit_price", "rrp", "bulk_price", "pack_price", "margin_pct"]) {
        const ov = String(oldPricing[pf] ?? "");
        const nv = String(newPricing[pf] ?? "");
        if (ov !== nv && (ov || nv)) {
          changes.push({ field: `pricing.${pf}`, oldVal: ov, newVal: nv });
          priceChanges++;
        }
      }

      if (changes.length > 0) {
        diffs.push({ sku: key, title: newP?.title || key, type: "changed", changes });
        changed++;
      } else {
        diffs.push({ sku: key, title: newP?.title || key, type: "unchanged" });
        unchanged++;
      }
    }
  }

  // Sort: changes first, then added, removed, unchanged
  const order = { changed: 0, added: 1, removed: 2, unchanged: 3 };
  diffs.sort((a, b) => order[a.type] - order[b.type]);

  return { diffs, stats: { added, removed, changed, unchanged, priceChanges } };
}

const typeIcons = {
  added: <Plus className="h-3 w-3" />,
  removed: <Minus className="h-3 w-3" />,
  changed: <GitCompare className="h-3 w-3" />,
  unchanged: <Equal className="h-3 w-3" />,
};

const typeBadges: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  added: { label: "Novo", variant: "default" },
  removed: { label: "Removido", variant: "destructive" },
  changed: { label: "Alterado", variant: "secondary" },
  unchanged: { label: "Igual", variant: "outline" },
};

interface Props {
  extractions: Extraction[];
}

export function PDFVersionCompare({ extractions }: Props) {
  const eligible = extractions.filter(e => ["reviewing", "done"].includes(e.status) && Array.isArray(e.detected_products) && e.detected_products.length > 0);
  const [oldId, setOldId] = useState<string>("");
  const [newId, setNewId] = useState<string>("");
  const [showUnchanged, setShowUnchanged] = useState(false);

  const oldExt = eligible.find(e => e.id === oldId);
  const newExt = eligible.find(e => e.id === newId);

  const result = useMemo(() => {
    if (!oldExt?.detected_products || !newExt?.detected_products) return null;
    return compareProducts(oldExt.detected_products, newExt.detected_products);
  }, [oldExt, newExt]);

  const visibleDiffs = result ? (showUnchanged ? result.diffs : result.diffs.filter(d => d.type !== "unchanged")) : [];

  if (eligible.length < 2) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <GitCompare className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>São necessárias pelo menos 2 extrações concluídas com produtos para comparar versões.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><GitCompare className="h-4 w-4" /> Comparar Versões de PDF</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Versão Anterior</label>
              <Select value={oldId} onValueChange={setOldId}>
                <SelectTrigger><SelectValue placeholder="Selecionar extração..." /></SelectTrigger>
                <SelectContent>
                  {eligible.filter(e => e.id !== newId).map(e => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.uploaded_files?.file_name || "PDF"} — {new Date(e.created_at).toLocaleDateString("pt-PT")} ({(e.detected_products || []).length} produtos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Versão Nova</label>
              <Select value={newId} onValueChange={setNewId}>
                <SelectTrigger><SelectValue placeholder="Selecionar extração..." /></SelectTrigger>
                <SelectContent>
                  {eligible.filter(e => e.id !== oldId).map(e => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.uploaded_files?.file_name || "PDF"} — {new Date(e.created_at).toLocaleDateString("pt-PT")} ({(e.detected_products || []).length} produtos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="grid grid-cols-5 gap-3">
            <Card className="text-center py-3">
              <p className="text-2xl font-bold">{result.stats.added}</p>
              <p className="text-xs text-muted-foreground">Novos</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-2xl font-bold">{result.stats.removed}</p>
              <p className="text-xs text-muted-foreground">Removidos</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-2xl font-bold">{result.stats.changed}</p>
              <p className="text-xs text-muted-foreground">Alterados</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-2xl font-bold">{result.stats.priceChanges}</p>
              <p className="text-xs text-muted-foreground">Preços Alterados</p>
            </Card>
            <Card className="text-center py-3">
              <p className="text-2xl font-bold">{result.stats.unchanged}</p>
              <p className="text-xs text-muted-foreground">Sem Alteração</p>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Diferenças Detetadas ({visibleDiffs.length})</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setShowUnchanged(!showUnchanged)}>
                  {showUnchanged ? "Ocultar Iguais" : "Mostrar Todos"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[50vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">SKU</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="w-[100px]">Estado</TableHead>
                      <TableHead>Alterações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleDiffs.map((diff, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{diff.sku}</TableCell>
                        <TableCell className="text-sm">{diff.title}</TableCell>
                        <TableCell>
                          <Badge variant={typeBadges[diff.type].variant} className="text-xs flex items-center gap-1 w-fit">
                            {typeIcons[diff.type]}
                            {typeBadges[diff.type].label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {diff.changes && diff.changes.length > 0 ? (
                            <div className="space-y-1">
                              {diff.changes.map((c, ci) => (
                                <div key={ci} className="text-xs flex items-center gap-1">
                                  <Badge variant="outline" className="text-[10px]">{c.field}</Badge>
                                  {c.field.includes("price") ? (
                                    <>
                                      <span className="line-through text-muted-foreground">{c.oldVal || "—"}</span>
                                      <span>→</span>
                                      <span className="font-medium">
                                        {c.newVal || "—"}
                                        {c.oldVal && c.newVal && !isNaN(Number(c.oldVal)) && !isNaN(Number(c.newVal)) && (
                                          <span className={`ml-1 ${Number(c.newVal) > Number(c.oldVal) ? "text-destructive" : "text-primary"}`}>
                                            ({Number(c.newVal) > Number(c.oldVal) ? <ArrowUp className="h-3 w-3 inline" /> : <ArrowDown className="h-3 w-3 inline" />}
                                            {Math.abs(((Number(c.newVal) - Number(c.oldVal)) / Number(c.oldVal)) * 100).toFixed(1)}%)
                                          </span>
                                        )}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="line-through text-muted-foreground truncate max-w-[150px]">{c.oldVal || "—"}</span>
                                      <span>→</span>
                                      <span className="truncate max-w-[150px]">{c.newVal || "—"}</span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {visibleDiffs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          Nenhuma diferença encontrada entre as versões selecionadas.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
