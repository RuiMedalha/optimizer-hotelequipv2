import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Eye, Image, Package, PencilLine, Search, ShieldCheck, ThumbsUp, FileText, Layers,
} from "lucide-react";

interface DetectedProduct {
  [key: string]: any;
  _confidence?: number;
  _warnings?: string[];
  _approved?: boolean;
  _sources?: string[];
  _pages?: number[];
}

interface Props {
  products: DetectedProduct[];
  columns?: string[];
  editable?: boolean;
  onProductsChange?: (products: DetectedProduct[]) => void;
  showApproval?: boolean;
}

const DISPLAY_LABELS: Record<string, string> = {
  sku: "SKU", original_title: "Título", original_description: "Descrição",
  original_price: "Preço", category: "Categoria", dimensions: "Dimensões",
  weight: "Peso", material: "Material", title: "Título", description: "Descrição",
  price: "Preço", color_options: "Cores", technical_specs: "Especificações Técnicas",
  short_description: "Descrição Curta", brand: "Marca", model: "Modelo",
  quantity: "Quantidade", unit: "Unidade", reference: "Referência",
  image_url: "Imagem URL", image_urls: "Imagens", image_description: "Desc. Imagem",
};

const PAGE_SIZES = [25, 50, 100, 200];

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) || typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function getConfidence(product: DetectedProduct): number | null {
  const confidence = Number(product._confidence ?? product.confidence);
  return Number.isFinite(confidence) ? confidence : null;
}

function getAllColumns(products: DetectedProduct[]): string[] {
  const keys = new Set<string>();
  products.forEach((product) => {
    Object.keys(product).forEach((key) => {
      if (!key.startsWith("_") && key !== "confidence" && key !== "currency") keys.add(key);
    });
  });
  const priority = [
    "sku", "reference", "title", "original_title", "description", "original_description",
    "short_description", "original_price", "price", "category", "brand", "model",
    "material", "dimensions", "weight", "color_options", "technical_specs",
    "image_url", "image_urls", "image_description",
  ];
  return [...keys].sort((a, b) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

const SUMMARY_COLUMNS = ["sku", "reference", "title", "original_title", "price", "original_price", "category", "brand", "image_url"];

export function DataPreviewTable({ products: rawProducts, columns: columnsProp, editable = false, onProductsChange, showApproval = false }: Props) {
  const flattenedProducts = useMemo(() => {
    if (!Array.isArray(rawProducts)) return [];
    const flat: DetectedProduct[] = [];
    const walk = (item: any, parentSection?: string) => {
      if (item == null) return;
      if (Array.isArray(item)) { item.forEach((entry) => walk(entry, parentSection)); return; }
      if (typeof item !== "object") return;
      if (Array.isArray(item.products)) {
        const section = typeof item.section_title === "string" ? item.section_title : parentSection;
        item.products.forEach((entry: any) => walk(entry, section));
        return;
      }
      flat.push({ ...item, category: item.category || parentSection });
    };
    walk(rawProducts);
    return flat;
  }, [rawProducts]);

  const [tableProducts, setTableProducts] = useState<DetectedProduct[]>(flattenedProducts);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedProductIndex, setSelectedProductIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => { setTableProducts(flattenedProducts); }, [flattenedProducts]);
  useEffect(() => { setPage(1); }, [tableProducts.length, pageSize, searchTerm]);

  const allColumns = useMemo(() => columnsProp || getAllColumns(tableProducts), [columnsProp, tableProducts]);
  const tableColumns = useMemo(() => {
    const available = allColumns.filter((c) => SUMMARY_COLUMNS.includes(c));
    return available.length > 0 ? available : allColumns.slice(0, 5);
  }, [allColumns]);

  const filteredProducts = useMemo(() => {
    if (!searchTerm.trim()) return tableProducts;
    const lower = searchTerm.toLowerCase();
    return tableProducts.filter((p) => {
      const sku = formatCellValue(p.sku || p.reference).toLowerCase();
      const title = formatCellValue(p.title || p.original_title).toLowerCase();
      return sku.includes(lower) || title.includes(lower);
    });
  }, [tableProducts, searchTerm]);

  if (!tableProducts.length) return null;

  const approvedCount = tableProducts.filter((p) => p._approved).length;
  const allApproved = approvedCount === tableProducts.length;
  const lowConfidenceCount = tableProducts.filter((p) => { const c = getConfidence(p); return c !== null && c < 60; }).length;
  const hasImages = tableProducts.some((p) => p.image_url || p.image_urls || p.image_description);
  const mergedCount = tableProducts.filter((p) => p._sources && p._sources.length > 1).length;

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const visibleProducts = filteredProducts.slice(startIndex, startIndex + pageSize);

  const handleCellChange = (absoluteIndex: number, column: string, value: string) => {
    const realProduct = filteredProducts[absoluteIndex];
    const realIndex = tableProducts.indexOf(realProduct);
    if (realIndex === -1) return;
    setTableProducts((prev) => {
      const next = [...prev];
      next[realIndex] = { ...next[realIndex], [column]: value };
      onProductsChange?.(next);
      return next;
    });
  };

  const handleApprove = (absoluteIndex: number) => {
    const realProduct = filteredProducts[absoluteIndex];
    const realIndex = tableProducts.indexOf(realProduct);
    if (realIndex === -1) return;
    setTableProducts((prev) => {
      const next = [...prev];
      next[realIndex] = { ...next[realIndex], _approved: !next[realIndex]._approved };
      onProductsChange?.(next);
      return next;
    });
  };

  const handleApproveAll = () => {
    setTableProducts((prev) => {
      const next = prev.map((p) => ({ ...p, _approved: !allApproved }));
      onProductsChange?.(next);
      return next;
    });
  };

  const selectedProduct = selectedProductIndex !== null ? filteredProducts[selectedProductIndex] : null;

  // Navigate products inside modal
  const navigateProduct = (direction: "prev" | "next") => {
    if (selectedProductIndex === null) return;
    const newIndex = direction === "prev" ? selectedProductIndex - 1 : selectedProductIndex + 1;
    if (newIndex >= 0 && newIndex < filteredProducts.length) setSelectedProductIndex(newIndex);
  };

  return (
    <>
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" /> Catálogo Extraído
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {editable && (
                <Badge variant="outline" className="flex items-center gap-1 text-xs">
                  <PencilLine className="h-3 w-3" /> Edição ativa
                </Badge>
              )}
              <Badge variant="default" className="text-xs">{tableProducts.length} produtos</Badge>
              {mergedCount > 0 && (
                <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                  <Layers className="h-3 w-3" /> {mergedCount} unificados por SKU
                </Badge>
              )}
              {hasImages && (
                <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                  <Image className="h-3 w-3" /> Imagens detetadas
                </Badge>
              )}
              {lowConfidenceCount > 0 && (
                <Badge variant="destructive" className="flex items-center gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" /> {lowConfidenceCount} baixa confiança
                </Badge>
              )}
              {showApproval && (
                <Badge variant={allApproved ? "default" : "secondary"} className="flex items-center gap-1 text-xs">
                  <ShieldCheck className="h-3 w-3" /> {approvedCount}/{tableProducts.length} aprovados
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Search + Approve All */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Pesquisar por SKU ou título..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 text-xs pl-8"
              />
            </div>
            {showApproval && (
              <Button size="sm" variant={allApproved ? "default" : "outline"} onClick={handleApproveAll} className="h-8 text-xs gap-1">
                <ThumbsUp className="h-3 w-3" />
                {allApproved ? "Todos Aprovados ✓" : "Aprovar Todos"}
              </Button>
            )}
          </div>

          <ScrollArea className="max-h-[520px]">
            <div className="overflow-auto">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs w-10 font-semibold">#</TableHead>
                    {showApproval && <TableHead className="text-xs w-10">✓</TableHead>}
                    {tableColumns.map((column) => (
                      <TableHead key={column} className="text-xs whitespace-nowrap font-semibold">
                        {DISPLAY_LABELS[column] || column}
                      </TableHead>
                    ))}
                    <TableHead className="text-xs whitespace-nowrap font-semibold">Confiança</TableHead>
                    <TableHead className="text-xs whitespace-nowrap font-semibold">Fontes</TableHead>
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {visibleProducts.map((product, rowIndex) => {
                    const absoluteIndex = startIndex + rowIndex;
                    const confidence = getConfidence(product);
                    const isApproved = product._approved;
                    const sourceCount = product._sources?.length || 1;

                    return (
                      <TableRow
                        key={`${absoluteIndex}-${product.sku || "row"}`}
                        className={`cursor-pointer transition-colors hover:bg-muted/50
                          ${confidence !== null && confidence < 60 ? "bg-destructive/5" : ""}
                          ${isApproved ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                        onClick={() => setSelectedProductIndex(absoluteIndex)}
                      >
                        <TableCell className="text-xs text-muted-foreground font-mono">{absoluteIndex + 1}</TableCell>
                        {showApproval && (
                          <TableCell>
                            <Button
                              size="icon"
                              variant={isApproved ? "default" : "ghost"}
                              className="h-6 w-6"
                              onClick={(e) => { e.stopPropagation(); handleApprove(absoluteIndex); }}
                            >
                              <ThumbsUp className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        )}
                        {tableColumns.map((column) => {
                          const cellText = formatCellValue(product[column]);
                          return (
                            <TableCell key={`${absoluteIndex}-${column}`} className="text-xs align-top max-w-[250px]">
                              <span className="block truncate" title={cellText || "—"}>
                                {cellText || <span className="text-muted-foreground italic">—</span>}
                              </span>
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {confidence !== null && confidence >= 80 ? (
                              <CheckCircle className="h-3 w-3 text-primary" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            )}
                            <span className="text-xs font-mono">{confidence !== null ? `${confidence}%` : "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {sourceCount > 1 ? (
                            <Badge variant="secondary" className="text-[10px]">{sourceCount} fontes</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">1</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setSelectedProductIndex(absoluteIndex); }}>
                            <Eye className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>

          {/* Pagination */}
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {startIndex + 1}–{Math.min(startIndex + pageSize, filteredProducts.length)} de {filteredProducts.length}
                {searchTerm && ` (filtrados de ${tableProducts.length})`}
              </p>
              <select
                className="text-xs border rounded px-1.5 py-1 bg-background text-foreground"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s} /página</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setPage(1)} disabled={safePage === 1} className="h-7 w-7 p-0">
                <ChevronsLeft className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="h-7 w-7 p-0">
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <span className="text-xs text-muted-foreground px-2 font-medium">{safePage} / {totalPages}</span>
              <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="h-7 w-7 p-0">
                <ChevronRight className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPage(totalPages)} disabled={safePage === totalPages} className="h-7 w-7 p-0">
                <ChevronsRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Product Detail Dialog */}
      <Dialog open={selectedProductIndex !== null} onOpenChange={(open) => { if (!open) setSelectedProductIndex(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4 text-primary" />
                Produto #{selectedProductIndex !== null ? selectedProductIndex + 1 : ""} de {filteredProducts.length}
              </DialogTitle>
              <div className="flex items-center gap-2">
                {showApproval && selectedProductIndex !== null && (
                  <Button
                    size="sm"
                    variant={selectedProduct?._approved ? "default" : "outline"}
                    onClick={() => handleApprove(selectedProductIndex!)}
                    className="gap-1"
                  >
                    <ThumbsUp className="h-3 w-3" />
                    {selectedProduct?._approved ? "Aprovado ✓" : "Aprovar"}
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-2">
            {selectedProduct && (
              <div className="space-y-3 pb-4">
                {/* Title highlight */}
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm font-semibold">
                    {formatCellValue(selectedProduct.title || selectedProduct.original_title || selectedProduct.sku || "Sem título")}
                  </p>
                  {selectedProduct.sku && <p className="text-xs text-muted-foreground font-mono mt-0.5">SKU: {selectedProduct.sku}</p>}
                  {/* Source info */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedProduct._sources?.map((s: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        <FileText className="h-2.5 w-2.5 mr-0.5" /> {s}
                      </Badge>
                    ))}
                    {selectedProduct._pages?.map((p: number, i: number) => (
                      <Badge key={`p${i}`} variant="secondary" className="text-[10px]">
                        Pág. {p}
                      </Badge>
                    ))}
                    {selectedProduct._confidence != null && (
                      <Badge variant={selectedProduct._confidence >= 80 ? "default" : "secondary"} className="text-[10px]">
                        {selectedProduct._confidence}% confiança
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Image preview */}
                {(selectedProduct.image_url || selectedProduct.image_urls?.length > 0) && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Image className="h-3 w-3" /> Imagens Extraídas
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {[...(selectedProduct.image_urls || []), selectedProduct.image_url].filter(Boolean).map((url: string, i: number) => (
                        <div key={i} className="relative group">
                          <img
                            src={url}
                            alt={`Produto imagem ${i + 1}`}
                            className="h-16 w-16 object-cover rounded border border-border"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <p className="text-[9px] text-muted-foreground truncate max-w-[64px]">{url.split("/").pop()}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {allColumns.map((column) => {
                  if (column === "title" || column === "original_title" || column === "sku") return null;
                  if (column === "image_url" || column === "image_urls") return null; // shown above
                  const value = formatCellValue(selectedProduct[column]);
                  if (!value && !editable) return null;
                  const isLong = value.length > 80;
                  return (
                    <div key={column} className="space-y-1">
                      <Label className="text-xs font-semibold text-muted-foreground">
                        {DISPLAY_LABELS[column] || column}
                      </Label>
                      {editable ? (
                        isLong ? (
                          <Textarea
                            value={value}
                            onChange={(e) => handleCellChange(selectedProductIndex!, column, e.target.value)}
                            className="text-xs min-h-[60px]"
                          />
                        ) : (
                          <Input
                            value={value}
                            onChange={(e) => handleCellChange(selectedProductIndex!, column, e.target.value)}
                            className="h-8 text-xs"
                          />
                        )
                      ) : (
                        <p className="text-sm bg-muted/30 rounded px-2 py-1.5 whitespace-pre-wrap">{value || "—"}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Navigation at bottom of modal */}
          <Separator />
          <div className="flex items-center justify-between pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateProduct("prev")}
              disabled={selectedProductIndex === null || selectedProductIndex === 0}
              className="gap-1"
            >
              <ChevronLeft className="h-3 w-3" /> Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              {selectedProductIndex !== null ? selectedProductIndex + 1 : 0} / {filteredProducts.length}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigateProduct("next")}
              disabled={selectedProductIndex === null || selectedProductIndex >= filteredProducts.length - 1}
              className="gap-1"
            >
              Próximo <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
