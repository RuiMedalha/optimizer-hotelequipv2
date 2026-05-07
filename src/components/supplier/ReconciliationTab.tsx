import { useState, useMemo, useEffect } from "react";
import { 
  usePendingStagingItems, 
  useProcessStagingItem, 
  useStagingCounts, 
  useBatchProcessStaging,
  type SyncStagingItem 
} from "@/hooks/useIngestion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { 
  AlertCircle, Check, X, Eye, Image as ImageIcon, Search, AlertTriangle, 
  Tag, ArrowUpCircle, RefreshCw, Layers, Trash2, LayoutDashboard, ChevronDown, DollarSign,
  CheckSquare, Square, Loader2
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { formatAttributeValue } from "@/lib/supplierConnector";

const ITEMS_PER_PAGE = 50;

export function ReconciliationTab() {
  const { activeWorkspace } = useWorkspaceContext();
  const [filterType, setFilterType] = useState<string | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [allItems, setAllItems] = useState<(SyncStagingItem & { job: { config: any } | null })[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: stagingData, isLoading, isFetching, error: fetchError } = usePendingStagingItems({ 
    changeType: filterType, 
    limit: ITEMS_PER_PAGE, 
    offset 
  });
  
  const { data: counts, isLoading: isLoadingCounts, refetch: refetchCounts } = useStagingCounts();
  const processItem = useProcessStagingItem();
  const batchProcess = useBatchProcessStaging();
  
  const [selectedItem, setSelectedItem] = useState<(SyncStagingItem & { job: { config: any } | null }) | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});

  // Append items when loading more
  useEffect(() => {
    if (stagingData?.items) {
      if (offset === 0) {
        setAllItems(stagingData.items);
      } else {
        setAllItems(prev => [...prev, ...stagingData.items]);
      }
    }
  }, [stagingData?.items, offset]);

  // Reset offset when filter changes
  const handleSetFilter = (type: string | undefined) => {
    setFilterType(type);
    setOffset(0);
    setAllItems([]);
    setSelectedIds([]);
  };

  const handleLoadMore = () => {
    setOffset(prev => prev + ITEMS_PER_PAGE);
  };

  const handleToggleSelection = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.length === allItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allItems.map(i => i.id));
    }
  };

  const handleOpenDetail = (item: SyncStagingItem & { job: { config: any } | null }) => {
    setSelectedItem(item);
    const initialChanges: Record<string, any> = {};
    if (item.proposed_changes) {
      Object.keys(item.proposed_changes).forEach(key => {
        initialChanges[key] = item.proposed_changes[key];
      });
    }
    
    // Default image reordering logic: Delta first, Site second
    const deltaImgs = Array.isArray(item.proposed_changes?.image_urls) ? item.proposed_changes.image_urls : (item.proposed_changes?.image_urls ? [item.proposed_changes.image_urls] : []);
    const siteImgs = Array.isArray(item.site_data?.image_urls) ? item.site_data.image_urls : (item.site_data?.image_urls ? [item.site_data.image_urls] : []);
    
    if (deltaImgs.length > 0) {
      initialChanges['image_urls'] = [...new Set([...deltaImgs, ...siteImgs])];
    } else if (siteImgs.length > 0) {
      initialChanges['image_urls'] = siteImgs;
    }
    
    setPendingChanges(initialChanges);
  };

  const handleApprove = async () => {
    if (!selectedItem) return;
    
    const approvedData: any = {};
    Object.keys(pendingChanges).forEach(key => {
      if (pendingChanges[key] !== undefined && pendingChanges[key] !== false) {
        approvedData[key] = pendingChanges[key];
      }
    });

    try {
      await processItem.mutateAsync({
        id: selectedItem.id,
        action: 'approve',
        data: approvedData
      });
      setSelectedItem(null);
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
    } catch (e) {}
  };

  const handleBatchAction = async (type: string | undefined, action: string, label: string, useSelection = false) => {
    if (!activeWorkspace?.id) return;
    
    const itemsToProcess = useSelection ? selectedIds : [];
    const targetLabel = useSelection ? `${selectedIds.length} selecionados` : `todos do tipo "${changeTypeLabels[type || '']}"`;

    if (!confirm(`Tem a certeza que deseja ${label} para ${targetLabel}?`)) {
      return;
    }

    try {
      await batchProcess.mutateAsync({
        changeType: type,
        action,
        workspaceId: activeWorkspace.id,
        selectedIds: useSelection ? selectedIds : undefined
      });
      if (useSelection) setSelectedIds([]);
    } catch (e) {}
  };

  const changeTypeLabels: Record<string, string> = {
    discontinued: "Descontinuados",
    new_product: "Novos",
    price_change: "Preços",
    field_update: "Atualizações",
    multiple_changes: "Múltiplos"
  };

  const changeTypeColors: Record<string, string> = {
    discontinued: "border-red-500 text-red-600 bg-red-50",
    new_product: "border-green-500 text-green-600 bg-green-50",
    price_change: "border-amber-500 text-amber-600 bg-amber-50",
    field_update: "border-blue-500 text-blue-600 bg-blue-50",
    multiple_changes: "border-purple-500 text-purple-600 bg-purple-50"
  };

  const changeTypeIcons: Record<string, any> = {
    discontinued: Trash2,
    new_product: Tag,
    price_change: ArrowUpCircle,
    field_update: RefreshCw,
    multiple_changes: Layers
  };

  const matchMethodLabels: Record<string, string> = {
    exact: "Exato",
    normalized: "Normalizado",
    fuzzy: "Aproximado",
    ean: "EAN/GTIN",
    manual: "Manual",
    none: "Sem Match"
  };

  if (isLoading && offset === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const noRecords = !isLoading && (!allItems || allItems.length === 0) && (!counts || counts.total === 0);
  const filteredButEmpty = !isLoading && allItems.length === 0 && counts && counts.total > 0;

  const handleRefresh = () => {
    handleSetFilter(undefined);
    refetchCounts();
  };

  if (noRecords && !filterType && !isLoading) {
    return (
      <Card className="mt-4">
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Check className="h-12 w-12 mb-4 opacity-20" />
          <p>Não existem registos pendentes de reconciliação.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" /> Atualizar Dados
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (fetchError) {
    return (
      <Card className="mt-4 border-destructive/50">
        <CardContent className="flex flex-col items-center justify-center py-12 text-destructive">
          <AlertCircle className="h-12 w-12 mb-4 opacity-50" />
          <p>Erro ao carregar dados de reconciliação.</p>
          <pre className="mt-2 text-[10px] bg-muted p-2 rounded max-w-full overflow-auto">
            {(fetchError as any)?.message || "Erro desconhecido"}
          </pre>
          <Button variant="outline" size="sm" className="mt-4" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" /> Tentar Novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 mt-4 animate-fade-in pb-20">
      {/* Summary Panel */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(changeTypeLabels).map(([type, label]) => {
          const count = counts?.[type] || 0;
          const Icon = changeTypeIcons[type];
          const isActive = filterType === type;
          const isDisabled = count === 0;
          
          return (
            <Card 
              key={type} 
              className={cn(
                "transition-all border-2",
                !isDisabled && "cursor-pointer hover:shadow-md",
                isActive ? "border-primary" : "border-transparent",
                isDisabled ? "opacity-40 grayscale" : ""
              )}
              onClick={() => !isDisabled && handleSetFilter(isActive ? undefined : type)}
              style={isDisabled ? { pointerEvents: 'none' } : {}}
            >
              <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                <div className={cn("p-2 rounded-full", changeTypeColors[type].split(' ')[2])}>
                  <Icon className={cn("w-4 h-4", changeTypeColors[type].split(' ')[1])} />
                </div>
                <div>
                  <div className="text-xl font-bold">{count}</div>
                  <div className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">{label}</div>
                </div>
                
                {!isDisabled && (
                  <div className="mt-1 pt-2 border-t w-full flex flex-col gap-1 justify-center">
                  <div className="mt-1 pt-2 border-t w-full flex flex-col gap-1 justify-center">
                    {type === 'discontinued' && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 text-[9px] px-2 hover:bg-red-100 text-red-600"
                        onClick={(e) => { e.stopPropagation(); handleBatchAction(type, 'draft_discontinued', 'marcar como rascunho'); }}
                      >
                        Descontinuar Tudo
                      </Button>
                    )}
                    {type === 'new_product' && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 text-[9px] px-2 hover:bg-green-100 text-green-600"
                        onClick={(e) => { e.stopPropagation(); handleBatchAction(type, 'create_drafts', 'criar como rascunho'); }}
                      >
                        Criar Tudo
                      </Button>
                    )}
                    {type === 'price_change' && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 text-[9px] px-2 hover:bg-amber-100 text-amber-600"
                        onClick={(e) => { e.stopPropagation(); handleBatchAction(type, 'approve_prices', 'aprovar preços'); }}
                      >
                        Aprovar Tudo
                      </Button>
                    )}
                    {type === 'field_update' && (
                      <>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 text-[9px] px-2 hover:bg-blue-100 text-blue-600"
                          onClick={(e) => { e.stopPropagation(); handleBatchAction(type, 'review_visual', 'enviar para revisão visual'); }}
                        >
                          Revisão Visual
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 text-[9px] px-2 hover:bg-green-100 text-green-600"
                          onClick={(e) => { e.stopPropagation(); handleBatchAction(type, 'approve_all', 'aprovar tudo (conteúdo + preço)'); }}
                        >
                          Aprovar Tudo
                        </Button>
                      </>
                    )}
                    {type === 'multiple_changes' && (
                      <>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 text-[9px] px-2 hover:bg-purple-100 text-purple-600"
                          onClick={(e) => { e.stopPropagation(); handleBatchAction(type, 'review_visual', 'enviar para revisão visual'); }}
                        >
                          Revisão Visual
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 text-[9px] px-2 hover:bg-green-100 text-green-600"
                          onClick={(e) => { e.stopPropagation(); handleBatchAction(type, 'approve_all', 'aprovar tudo (conteúdo + preço)'); }}
                        >
                          Aprovar Tudo
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 text-[9px] px-2 hover:bg-amber-100 text-amber-600"
                          onClick={(e) => { e.stopPropagation(); handleBatchAction(type, 'approve_prices_only', 'aprovar apenas os preços'); }}
                        >
                          Aprovar só preços
                        </Button>
                      </>
                    )}
                  </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-between p-3 bg-blue-50/50 rounded-lg border border-blue-100">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-blue-700">
            <DollarSign className="w-4 h-4" />
            <span className="text-sm font-medium">Produtos com alteração de preço:</span>
            <Badge variant="secondary" className="bg-blue-200/50 text-blue-800 border-blue-300">
              {counts?.price_alerts || 0}
            </Badge>
          </div>
        </div>
        <p className="text-[11px] text-blue-600 italic">
          Contagem inclui "Preços" e "Múltiplos"
        </p>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            Lista de Reconciliação
            {filterType && (
              <Badge variant="outline" className={cn(changeTypeColors[filterType])}>
                Filtrado: {changeTypeLabels[filterType]}
              </Badge>
            )}
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {stagingData?.totalCount || 0} Total
            </Badge>
          </h3>
        </div>
        {filterType && (
          <Button variant="ghost" size="sm" onClick={handleRefresh}>
            Limpar Filtros
          </Button>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo / Estado</TableHead>
              <TableHead>SKU Fornecedor</TableHead>
              <TableHead>SKU Site</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Confiança</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allItems.length > 0 ? (
              allItems.map((item) => {
                const Icon = item.change_type ? changeTypeIcons[item.change_type] : LayoutDashboard;
                return (
                  <TableRow key={item.id} className={cn(item.status === 'flagged' ? "bg-amber-500/5" : "")}>
                    <TableCell>
                      <Badge variant="outline" className={cn("gap-1 px-2 py-0.5", item.change_type ? changeTypeColors[item.change_type] : "")}>
                        <Icon className="w-3 h-3" />
                        {item.change_type ? changeTypeLabels[item.change_type] : "Normal"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{item.sku_supplier || '—'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{item.sku_site_target || 'Novo Produto'}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {(item as any).supplier?.supplier_name || (item as any).job?.config?.defaultBrand || 'Desconhecido'}
                      </Badge>
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
                );
              })
            ) : !isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {filterType 
                    ? `Sem registos do tipo "${changeTypeLabels[filterType]}" encontrados.`
                    : "A carregar lista de produtos..."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        
        {allItems.length < (stagingData?.totalCount || 0) && (
          <div className="p-4 flex justify-center border-t">
            <Button variant="outline" onClick={handleLoadMore} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ChevronDown className="w-4 h-4 mr-2" />
              )}
              Carregar mais (Exibindo {allItems.length} de {stagingData?.totalCount})
            </Button>
          </div>
        )}

        {noRecords && (
          <div className="p-8 text-center text-muted-foreground italic">
            Nenhum produto encontrado com este filtro.
          </div>
        )}
      </Card>

      {/* Detail Dialog - Keep existing structure but improve content */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-6 border-b pb-4">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Reconciliação de Produto</span>
                <span className="flex items-center gap-2">
                  {selectedItem?.sku_site_target || "Novo Produto"}
                  {selectedItem?.change_type && (
                    <Badge variant="outline" className={cn(changeTypeColors[selectedItem.change_type])}>
                      {changeTypeLabels[selectedItem.change_type]}
                    </Badge>
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
                  <div className="text-sm">{(selectedItem as any)?.supplier?.supplier_name || (selectedItem as any)?.job?.config?.defaultBrand || 'Desconhecido'}</div>
                </div>
              </div>

              {/* Attributes comparison - same as before but better labels */}
              {selectedItem?.change_type === 'discontinued' ? (
                <div className="p-8 border-2 border-dashed border-red-200 bg-red-50/30 rounded-xl text-center flex flex-col items-center gap-4">
                  <Trash2 className="w-12 h-12 text-red-400" />
                  <div>
                    <h4 className="text-lg font-bold text-red-700">Produto Descontinuado</h4>
                    <p className="text-sm text-red-600 max-w-md mx-auto">
                      Este produto existe no site mas não foi encontrado no novo ficheiro do fornecedor. 
                      Ao aprovar, o stock será marcado como 0 e o estado passará para "Revisão".
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Image comparison */}
                  {(selectedItem?.proposed_changes?.image_urls || selectedItem?.site_data?.image_urls || (selectedItem as any)?.product?.image_urls) && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <ImageIcon className="h-4 w-4" /> Revisão de Imagens
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        {/* Site Image (Galleria/Secondary) */}
                        <div className="space-y-2 border rounded-lg p-3 bg-muted/10 relative">
                          <Label className="text-[10px] text-muted-foreground uppercase font-bold">Imagem no Site</Label>
                          <div className="aspect-square rounded-md border bg-white flex items-center justify-center overflow-hidden">
                            {(() => {
                              const siteImgs = (selectedItem as any)?.product?.image_urls || selectedItem?.site_data?.image_urls;
                              const imgUrl = Array.isArray(siteImgs) ? siteImgs[0] : siteImgs;
                              return imgUrl ? (
                                <img src={imgUrl} alt="Atual" className="object-contain w-full h-full" />
                              ) : (
                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                  <ImageIcon className="w-8 h-8 opacity-20" />
                                  <span className="text-[10px]">Sem imagem atual</span>
                                </div>
                              );
                            })()}
                          </div>
                          {(() => {
                            const siteImgs = (selectedItem as any)?.product?.image_urls || selectedItem?.site_data?.image_urls || [];
                            const deltaImgs = selectedItem.proposed_changes?.image_urls || [];
                            const currentList = Array.isArray(pendingChanges['image_urls']) ? pendingChanges['image_urls'] : [];
                            const firstImg = currentList[0];
                            const isSiteMain = siteImgs.length > 0 && firstImg === (Array.isArray(siteImgs) ? siteImgs[0] : siteImgs);
                            
                            return (
                              <Button 
                                variant={isSiteMain ? "default" : "outline"} 
                                size="sm" 
                                className="w-full mt-2 h-7 text-[10px]"
                                onClick={() => {
                                  const sImgs = Array.isArray(siteImgs) ? siteImgs : [siteImgs];
                                  const dImgs = Array.isArray(deltaImgs) ? deltaImgs : (deltaImgs ? [deltaImgs] : []);
                                  setPendingChanges(prev => ({
                                    ...prev,
                                    image_urls: [...new Set([...sImgs, ...dImgs])]
                                  }));
                                }}
                              >
                                {isSiteMain ? "Principal (Site)" : "Definir como Principal"}
                              </Button>
                            );
                          })()}
                        </div>

                        {/* Delta Image (New Main) */}
                        <div className={cn(
                          "space-y-2 border rounded-lg p-3 relative",
                          "border-primary bg-primary/5"
                        )}>
                          <Label className="text-[10px] text-primary font-bold uppercase">Imagem Delta (Fornecedor)</Label>
                          <div className="aspect-square rounded-md border bg-white flex items-center justify-center overflow-hidden">
                            {(() => {
                              const proposedImgs = selectedItem.proposed_changes?.image_urls;
                              const imgUrl = Array.isArray(proposedImgs) ? proposedImgs[0] : proposedImgs;
                              return imgUrl ? (
                                <img src={imgUrl} alt="Proposta" className="object-contain w-full h-full" />
                              ) : (
                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                  <ImageIcon className="w-8 h-8 opacity-20" />
                                  <span className="text-[10px]">Sem imagem na proposta</span>
                                </div>
                              );
                            })()}
                          </div>
                          {(() => {
                            const siteImgs = (selectedItem as any)?.product?.image_urls || selectedItem?.site_data?.image_urls || [];
                            const deltaImgs = selectedItem.proposed_changes?.image_urls || [];
                            const currentList = Array.isArray(pendingChanges['image_urls']) ? pendingChanges['image_urls'] : [];
                            const firstImg = currentList[0];
                            const isDeltaMain = deltaImgs.length > 0 && firstImg === (Array.isArray(deltaImgs) ? deltaImgs[0] : deltaImgs);
                            
                            return (
                              <Button 
                                variant={isDeltaMain ? "default" : "outline"} 
                                size="sm" 
                                className="w-full mt-2 h-7 text-[10px]"
                                disabled={!deltaImgs || deltaImgs.length === 0}
                                onClick={() => {
                                  const sImgs = Array.isArray(siteImgs) ? siteImgs : (siteImgs ? [siteImgs] : []);
                                  const dImgs = Array.isArray(deltaImgs) ? deltaImgs : [deltaImgs];
                                  setPendingChanges(prev => ({
                                    ...prev,
                                    image_urls: [...new Set([...dImgs, ...sImgs])]
                                  }));
                                }}
                              >
                                {isDeltaMain ? "Principal (Delta)" : "Definir como Principal"}
                              </Button>
                            );
                          })()}
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground italic text-center">
                        As imagens existentes não serão apagadas. A imagem escolhida como "Principal" ficará no topo, e as restantes formarão a galeria.
                      </p>
                    </div>
                  )}

                  {/* Reference Fields (Supplier Text that was preserved) */}
                  {(selectedItem?.proposed_changes?.supplier_title || selectedItem?.proposed_changes?.supplier_description) && (
                    <div className="space-y-3 p-4 bg-amber-50/50 border border-amber-200 rounded-lg">
                      <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-2">
                        <AlertTriangle className="h-3 w-3" /> Texto do Fornecedor (Preservado)
                      </h4>
                      <p className="text-[10px] text-amber-700 italic">
                        Os campos abaixo foram preservados no site (Português). O texto do fornecedor (Delta) está aqui apenas para consulta.
                      </p>
                      <div className="space-y-3 mt-2">
                        {selectedItem.proposed_changes.supplier_title && (
                          <div className="space-y-1">
                            <Label className="text-[9px] uppercase text-muted-foreground">Título Original (Supplier)</Label>
                            <div className="text-xs p-2 bg-white border rounded">{selectedItem.proposed_changes.supplier_title}</div>
                          </div>
                        )}
                        {selectedItem.proposed_changes.supplier_description && (
                          <div className="space-y-1">
                            <Label className="text-[9px] uppercase text-muted-foreground">Descrição Original (Supplier)</Label>
                            <div className="text-xs p-2 bg-white border rounded max-h-32 overflow-y-auto whitespace-pre-wrap">
                              {selectedItem.proposed_changes.supplier_description}
                            </div>
                          </div>
                        )}
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
                        // Skip internal and image fields
                        if (['image_urls', 'sku', 'is_discontinued', 'supplier_title', 'supplier_description', 'supplier_short_description'].includes(key)) return null;
                        
                        const oldVal = (selectedItem as any)?.product?.[key] !== undefined ? (selectedItem as any)?.product[key] : selectedItem?.site_data?.[key];
                        // If values are the same, still show descriptions and categories for context as requested
                        const isContextField = ['original_description', 'short_description', 'category', 'brand', 'original_title'].includes(key);
                        if (oldVal === newVal && oldVal !== undefined && !isContextField) return null;

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
                                  {key === 'attributes' && typeof oldVal === 'object' && oldVal !== null
                                    ? <div className="space-y-1">
                                        {Object.entries(oldVal).map(([attrK, attrV]) => (
                                          <div key={attrK} className="flex gap-1 whitespace-nowrap">
                                            <span className="opacity-70">{attrK}:</span>
                                            <span>{formatAttributeValue(attrV)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    : (typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal || '—'))}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-primary uppercase font-bold tracking-wider">Novo Valor</Label>
                                <div className={cn(
                                  "text-sm font-medium px-2 py-1 rounded inline-block",
                                  ['price', 'original_price', 'sale_price'].includes(key) ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"
                                )}>
                                  {key === 'attributes' && typeof newVal === 'object' && newVal !== null
                                    ? <div className="space-y-1">
                                        {Object.entries(newVal).map(([attrK, attrV]) => (
                                          <div key={attrK} className="flex gap-1 whitespace-nowrap">
                                            <span className="opacity-70">{attrK}:</span>
                                            <span>{formatAttributeValue(attrV)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    : formatAttributeValue(newVal) || '—'}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

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

