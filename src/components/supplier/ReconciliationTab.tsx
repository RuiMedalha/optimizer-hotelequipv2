import { useState, useMemo } from "react";
import { usePendingStagingItems, useProcessStagingItem, type SyncStagingItem } from "@/hooks/useIngestion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { AlertCircle, Check, X, Eye, Image as ImageIcon, ArrowRight, Save, History, Search, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function ReconciliationTab() {
  const { data: items, isLoading, refetch } = usePendingStagingItems();
  const processItem = useProcessStagingItem();
  const [selectedItem, setSelectedItem] = useState<(SyncStagingItem & { supplier: { supplier_name: string } | null }) | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});

  const sortedItems = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) => {
      // Flagged items first
      if (a.status === 'flagged' && b.status !== 'flagged') return -1;
      if (a.status !== 'flagged' && b.status === 'flagged') return 1;
      // Then by confidence score ascending (lowest first as they need more attention)
      return a.confidence_score - b.confidence_score;
    });
  }, [items]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Check className="h-12 w-12 mb-4 opacity-20" />
          <p>Não existem registos pendentes de reconciliação.</p>
        </CardContent>
      </Card>
    );
  }

  const handleOpenDetail = (item: SyncStagingItem & { supplier: { supplier_name: string } | null }) => {
    setSelectedItem(item);
    const initialChanges: Record<string, boolean> = {};
    if (item.proposed_changes) {
      Object.keys(item.proposed_changes).forEach(key => {
        initialChanges[key] = true;
      });
    }
    setPendingChanges(initialChanges);
  };

  const handleApprove = async () => {
    if (!selectedItem) return;
    
    const approvedData: any = {};
    Object.keys(pendingChanges).forEach(key => {
      if (pendingChanges[key] && selectedItem.proposed_changes[key] !== undefined) {
        approvedData[key] = selectedItem.proposed_changes[key];
      }
    });

    try {
      await processItem.mutateAsync({
        id: selectedItem.id,
        action: 'approve',
        data: approvedData
      });
      setSelectedItem(null);
      refetch();
    } catch (e) {}
  };

  const handleReject = async () => {
    if (!selectedItem) return;
    try {
      await processItem.mutateAsync({
        id: selectedItem.id,
        action: 'reject'
      });
      setSelectedItem(null);
      refetch();
    } catch (e) {}
  };

  const matchMethodLabels: Record<string, string> = {
    exact: "Exato",
    normalized: "Normalizado",
    fuzzy: "Aproximado",
    ean: "EAN/GTIN",
    manual: "Manual",
    none: "Sem Match"
  };

  return (
    <div className="space-y-4 mt-4 animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            Reconciliação de Dados
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {items.length} Pendentes
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground">Analise e aprove as alterações propostas pelos fornecedores.</p>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado</TableHead>
              <TableHead>SKU Fornecedor</TableHead>
              <TableHead>SKU Site</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Confiança</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.map((item) => (
              <TableRow key={item.id} className={cn(item.status === 'flagged' ? "bg-amber-500/5" : "")}>
                <TableCell>
                  {item.status === 'flagged' ? (
                    <Badge variant="outline" className="border-amber-500 text-amber-600 bg-amber-50 gap-1">
                      <AlertTriangle className="w-3 h-3" /> Prioritário
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-primary/30 text-primary">Normal</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-mono text-xs">{item.sku_supplier || '—'}</div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{item.sku_site_target || 'Novo Produto'}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">{item.supplier?.supplier_name || 'Desconhecido'}</Badge>
                </TableCell>
                <TableCell>
                  <span className="text-xs font-medium">{matchMethodLabels[item.match_method] || item.match_method}</span>
                </TableCell>
                <TableCell>
                  <ConfidenceIndicator score={item.confidence_score} />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenDetail(item)}>
                    <Eye className="h-4 w-4 mr-1" /> Analisar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-6 border-b pb-4">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Reconciliação de Produto</span>
                <span className="flex items-center gap-2">
                  {selectedItem?.sku_site_target || "Novo Produto"}
                  {selectedItem?.status === 'flagged' && (
                    <Badge variant="outline" className="border-amber-500 text-amber-600 bg-amber-50">Atenção Prioritária</Badge>
                  )}
                </span>
              </DialogTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleReject} className="text-destructive hover:bg-destructive/10 border-destructive/20">
                  <X className="h-4 w-4 mr-1" /> Rejeitar
                </Button>
                <Button size="sm" onClick={handleApprove}>
                  <Check className="h-4 w-4 mr-1" /> Aprovar Seleção
                </Button>
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 p-6 overflow-y-auto">
            <div className="space-y-6">
              {/* Context Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg border">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">SKU Fornecedor</Label>
                  <div className="font-mono text-sm">{selectedItem?.sku_supplier || '—'}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Identificação</Label>
                  <div className="text-sm font-medium">
                    {matchMethodLabels[selectedItem?.match_method || ''] || selectedItem?.match_method} ({selectedItem?.confidence_score}%)
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Fornecedor</Label>
                  <div className="text-sm">{selectedItem?.supplier?.supplier_name || 'Desconhecido'}</div>
                </div>
              </div>

              {/* Image comparison */}
              {selectedItem?.proposed_changes?.image_urls && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" /> Revisão de Imagens
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 border rounded-lg p-3 bg-muted/10">
                      <Label className="text-[10px] text-muted-foreground uppercase font-bold">Imagem no Site</Label>
                      <div className="aspect-square rounded-md border bg-white flex items-center justify-center overflow-hidden">
                        {selectedItem.site_data?.image_urls?.[0] ? (
                          <img src={selectedItem.site_data.image_urls[0]} alt="Atual" className="object-contain w-full h-full" />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <ImageIcon className="w-8 h-8 opacity-20" />
                            <span className="text-[10px]">Sem imagem atual</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={cn(
                      "space-y-2 border rounded-lg p-3 relative",
                      pendingChanges['image_urls'] ? "border-primary bg-primary/5" : "border-muted"
                    )}>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-[10px] text-primary font-bold uppercase">Proposta Fornecedor</Label>
                        <Checkbox 
                          checked={pendingChanges['image_urls']} 
                          onCheckedChange={(val) => setPendingChanges(prev => ({ ...prev, image_urls: !!val }))} 
                        />
                      </div>
                      <div className="aspect-square rounded-md border bg-white flex items-center justify-center overflow-hidden">
                        {selectedItem.proposed_changes.image_urls?.[0] ? (
                          <img src={selectedItem.proposed_changes.image_urls[0]} alt="Proposta" className="object-contain w-full h-full" />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <ImageIcon className="w-8 h-8 opacity-20" />
                            <span className="text-[10px]">Sem imagem na proposta</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Attributes comparison */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Search className="h-4 w-4" /> Atributos e Metadados
                </h4>
                <div className="border rounded-lg divide-y bg-background">
                  {Object.entries(selectedItem?.proposed_changes || {}).map(([key, newVal]: [string, any]) => {
                    if (key === 'image_urls' || key === 'sku') return null;
                    const oldVal = selectedItem.site_data?.[key];
                    const isNewField = oldVal === null || oldVal === undefined || oldVal === '';
                    
                    return (
                      <div key={key} className={cn(
                        "p-4 flex gap-6 items-start transition-colors",
                        pendingChanges[key] ? "bg-primary/5" : ""
                      )}>
                        <div className="w-6 pt-1">
                          <Checkbox 
                            checked={pendingChanges[key]} 
                            onCheckedChange={(val) => setPendingChanges(prev => ({ ...prev, [key]: !!val }))} 
                          />
                        </div>
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Campo</Label>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm capitalize">{key.replace(/_/g, ' ')}</span>
                              {isNewField && (
                                <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600 bg-amber-50 px-1 py-0 h-4">
                                  Novo
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Valor no Site</Label>
                            <div className="text-sm line-through opacity-50 truncate italic">
                              {String(oldVal || '—')}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-primary uppercase font-bold tracking-wider">Novo Valor</Label>
                            <div className="text-sm font-medium text-primary bg-primary/10 px-2 py-1 rounded inline-block">
                              {String(newVal || '—')}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 bg-primary/5 rounded-lg flex gap-3 text-[11px] text-muted-foreground border border-primary/10">
                <AlertCircle className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <p>
                  As alterações selecionadas serão aplicadas na base de dados do Supabase. 
                  A sincronização com o WooCommerce é gerida de forma independente pela pipeline de exportação.
                </p>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="p-6 border-t bg-muted/10">
            <Button variant="outline" onClick={() => setSelectedItem(null)}>Fechar</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleReject} className="text-destructive border-destructive/20 hover:bg-destructive/10">
                <X className="h-4 w-4 mr-1" /> Rejeitar Tudo
              </Button>
              <Button onClick={handleApprove}>
                <Check className="h-4 w-4 mr-1" /> Aplicar {Object.values(pendingChanges).filter(Boolean).length} Alterações
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
