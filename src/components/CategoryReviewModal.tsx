import React, { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, ArrowRight, Loader2, CheckCheck, XCircle, Search, Wand2, RefreshCw, AlertCircle, Sparkles, Info, MousePointer2 } from "lucide-react";
import { CategoryCell } from "./category/CategoryCell";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CategorySuggestion {
  category_name: string;
  confidence_score: number;
  reasoning?: string;
}

interface CategoryProduct {
  id: string;
  sku: string;
  original_title: string;
  category: string | null;
  suggested_category: string | null;
  suggested_categories: CategorySuggestion[] | null;
  source_file: string | null;
  workspace_id: string | null;
  technical_specs?: string;
}

interface CategoryReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: CategoryProduct[];
}

export function CategoryReviewModal({ open, onOpenChange, products }: CategoryReviewModalProps) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSuggestedCategory, setFilterSuggestedCategory] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [classifyingIds, setClassifyingIds] = useState<Set<string>>(new Set());
  const [acceptingIds, setAcceptingIds] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [localSearchQuery, setLocalSearchQuery] = useState("");

  // Debounce search query to avoid re-calculating candidates on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearchQuery]);


  const getEffectiveSuggestion = (p: CategoryProduct) => overrides[p.id] || p.suggested_category;

  const candidates = useMemo(() => {
    if (showAllProducts) return products;
    // Show products needing confirmation: 
    // 1. Has suggested category different from current
    // 2. OR current category is empty
    return products.filter(p => 
      (p.suggested_category && p.suggested_category !== p.category) || 
      (!p.category)
    );
  }, [products, showAllProducts]);

  const uniqueCurrentCategories = useMemo(() =>
    [...new Set(candidates.map(p => p.category || "—").filter(Boolean))].sort(),
    [candidates]
  );
  const uniqueSources = useMemo(() =>
    [...new Set(candidates.map(p => p.source_file || "").filter(Boolean))].sort(),
    [candidates]
  );

  const uniqueSuggestedCategories = useMemo(() =>
    [...new Set(candidates.map(p => p.suggested_category || "—").filter(Boolean))].sort(),
    [candidates]
  );

  const filtered = useMemo(() => {
    // Limit processing to first 500 candidates if no search query to keep UI snappy
    const itemsToFilter = searchQuery ? candidates : candidates.slice(0, 500);
    
    return itemsToFilter.filter(p => {
      if (filterCategory !== "all" && (p.category || "—") !== filterCategory) return false;
      if (!showAllProducts) {
        if (filterSuggestedCategory !== "all" && (p.suggested_category || "—") !== filterSuggestedCategory) return false;
      }
      if (filterSource !== "all" && (p.source_file || "") !== filterSource) return false;
      
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          (p.original_title || "").toLowerCase().includes(query) ||
          (p.sku || "").toLowerCase().includes(query) ||
          (p.suggested_category || "").toLowerCase().includes(query) ||
          (p.category || "").toLowerCase().includes(query)
        );
      }
      
      return true;
    });
  }, [candidates, filterCategory, filterSuggestedCategory, filterSource, searchQuery, showAllProducts]);

  const allSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(p => p.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const handleClassify = async (id: string) => {
    const product = products.find(p => p.id === id);
    if (!product) return;

    setClassifyingIds(prev => new Set(prev).add(id));
    try {
      const { data, error } = await supabase.functions.invoke("classify-product", {
        body: { 
          workspace_id: product.workspace_id,
          product: {
            title: product.original_title,
            original_title: product.original_title,
            technical_specs: product.technical_specs
          }
        }
      });

      if (error) throw error;

      // Update the product in the database with the new suggestion
      const { error: updateError } = await supabase
        .from("products")
        .update({
          suggested_category: data.category_name,
          suggested_categories: [
            { category_name: data.category_name, confidence_score: data.confidence_score, reasoning: data.reasoning },
            ...(data.alternative_categories || [])
          ]
        })
        .eq("id", id);

      if (updateError) throw updateError;

      toast.success("Produto re-classificado pela IA");
      qc.invalidateQueries({ queryKey: ["all-product-ids"] });
    } catch (err: any) {
      toast.error(`Erro ao classificar: ${err.message}`);
    } finally {
      setClassifyingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const batchUpdate = async (ids: string[], approve: boolean) => {
    const batchSize = 200;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const prods = candidates.filter(p => batch.includes(p.id));
      if (approve) {
        const learningEvents: any[] = [];
        for (const p of prods) {
          const finalCategory = getEffectiveSuggestion(p);
          if (!finalCategory) continue;

          const { error } = await supabase
            .from("products")
            .update({ 
              category: finalCategory, 
              suggested_category: null,
              suggested_categories: null,
              status: 'optimized'
            })
            .eq("id", p.id);
          
          if (error) throw error;

          learningEvents.push({
            product_id: p.id,
            field_key: "category",
            raw_value: p.category,
            corrected_value: finalCategory,
            correction_type: "category_fix",
            review_context: { 
              sku: p.sku, 
              original_title: p.original_title,
              was_top_suggestion: finalCategory === p.suggested_category
            }
          });
        }

        if (learningEvents.length > 0) {
          try {
            const { data: userData } = await supabase.auth.getUser();
            await supabase.functions.invoke("learn-from-review", {
              body: {
                workspaceId: prods[0]?.workspace_id || "",
                reviewedBy: userData.user?.id,
                corrections: learningEvents,
                saveAsPatterns: true,
                triggerPatternExtraction: true
              }
            });

          } catch (err) {
            console.warn("Learning function failed:", err);
          }
        }
      } else {
        const { error } = await supabase
          .from("products")
          .update({ suggested_category: null, suggested_categories: null })
          .in("id", batch);
        if (error) throw error;
      }
    }
  };

  const handleApprove = async (ids: string[]) => {
    setIsApproving(true);
    try {
      await batchUpdate(ids, true);
      toast.success(`${ids.length} categoria(s) aprovada(s) com sucesso!`);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["all-product-ids"] });
      qc.invalidateQueries({ queryKey: ["product-filter-options"] });
      setSelected(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    } catch (err: any) {
      toast.error(`Erro ao aprovar: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async (ids: string[]) => {
    setIsRejecting(true);
    try {
      await batchUpdate(ids, false);
      toast.success(`${ids.length} sugestão(ões) rejeitada(s).`);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["all-product-ids"] });
      setSelected(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    } catch (err: any) {
      toast.error(`Erro ao rejeitar: ${err.message}`);
    } finally {
      setIsRejecting(false);
    }
  };

  const isBusy = isApproving || isRejecting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1200px] max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2 border-b">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="flex items-center gap-2 text-xl">
              Revisão de Categorias IA
              <Badge variant="secondary" className="text-xs">{candidates.length} produtos</Badge>
            </DialogTitle>
              <div className="flex items-center gap-3 bg-muted/50 px-4 py-2 rounded-full border">
                <Switch 
                  id="show-all" 
                  checked={showAllProducts} 
                  onCheckedChange={setShowAllProducts} 
                />
                <Label htmlFor="show-all" className="text-xs font-medium cursor-pointer">
                  {showAllProducts ? "Ver Todos os Produtos" : "Ver Apenas Pendentes"}
                </Label>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const highConfidence = filtered.filter(p => {
                    const confidence = (p as any).suggested_category_confidence || (p.suggested_categories?.[0]?.confidence_score ? p.suggested_categories[0].confidence_score * 100 : 0);
                    return confidence >= 80;
                  });
                  setSelected(new Set(highConfidence.map(p => p.id)));
                }}
              >
                Sel. ≥80% ({filtered.filter(p => {
                  const confidence = (p as any).suggested_category_confidence || (p.suggested_categories?.[0]?.confidence_score ? p.suggested_categories[0].confidence_score * 100 : 0);
                  return confidence >= 80;
                }).length})
              </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col p-6 pt-2 overflow-hidden">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative flex-1 min-w-[300px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar por SKU, Título ou Categoria..."
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              className="pl-9 h-10 text-sm bg-background"
            />
          </div>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="h-10 text-sm w-[200px] bg-background">
                <SelectValue placeholder="Categoria atual" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as atuais</SelectItem>
                {uniqueCurrentCategories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!showAllProducts && (
              <Select value={filterSuggestedCategory} onValueChange={setFilterSuggestedCategory}>
                <SelectTrigger className="h-10 text-sm w-[200px] bg-background">
                  <SelectValue placeholder="Categoria sugerida" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as sugeridas</SelectItem>
                  {uniqueSuggestedCategories.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {uniqueSources.length > 1 && (
              <Select value={filterSource} onValueChange={setFilterSource}>
                <SelectTrigger className="h-10 text-sm w-[200px] bg-background">
                  <SelectValue placeholder="Ficheiro fonte" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os ficheiros</SelectItem>
                  {uniqueSources.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-auto border rounded-xl shadow-sm bg-background">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                <TableRow className="hover:bg-transparent border-b-2">
                  <TableHead className="w-12 text-center">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      disabled={isBusy}
                    />
                  </TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground w-32">SKU / Referência</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground w-64">Produto</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Categoria Atual / Sugestões</TableHead>
                  <TableHead className="w-10"></TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground min-w-[200px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-20 bg-muted/5">
                      <div className="flex flex-col items-center gap-3">
                        <div className="bg-muted p-4 rounded-full">
                          <Search className="w-8 h-8 text-muted-foreground opacity-50" />
                        </div>
                        <p className="text-muted-foreground font-medium">Nenhum produto encontrado com estes filtros.</p>
                        {showAllProducts && (
                          <Button variant="outline" size="sm" onClick={() => {setSearchQuery(""); setFilterCategory("all");}}>
                            Limpar Filtros
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(p => {
                    const isClassifying = classifyingIds.has(p.id);
                    const effectiveSuggestion = getEffectiveSuggestion(p);
                    
                    return (
                      <TableRow key={p.id} className={cn(
                        "transition-colors group h-16",
                        selected.has(p.id) && "bg-primary/5",
                        !p.suggested_category && showAllProducts && "opacity-80"
                      )}>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={selected.has(p.id)}
                            onCheckedChange={() => toggleOne(p.id)}
                            disabled={isBusy}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-[11px] font-medium text-muted-foreground">{p.sku}</TableCell>
                        <TableCell className="max-w-[300px]">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-semibold leading-tight group-hover:text-primary transition-colors line-clamp-2" title={p.original_title}>
                              {p.original_title}
                            </span>
                            {p.source_file && (
                              <span className="text-[9px] text-muted-foreground truncate">{p.source_file}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <CategoryCell product={p} />
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary/40 group-hover:translate-x-1 transition-all" />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn("text-xs h-7 px-2", selected.has(p.id) && "text-success")}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleOne(p.id);
                              }}
                            >
                              ✓
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 px-2 text-success hover:bg-success/10"
                              disabled={acceptingIds.has(p.id) || isBusy}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setAcceptingIds(prev => new Set([...prev, p.id]));
                                try {
                                  await batchUpdate([p.id], true);
                                  toast.success("Categoria aprovada!");
                                  qc.invalidateQueries({ queryKey: ["products"] });
                                } catch (err: any) {
                                  toast.error(`Erro: ${err.message}`);
                                } finally {
                                  setAcceptingIds(prev => {
                                    const n = new Set(prev);
                                    n.delete(p.id);
                                    return n;
                                  });
                                }
                              }}
                            >
                              {acceptingIds.has(p.id) ? "..." : "Aceitar"}
                            </Button>
                            {p.suggested_category && !isClassifying && (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-8 text-[10px] gap-2 border-dashed"
                                onClick={() => handleClassify(p.id)}
                              >
                                <RefreshCw className="w-3 h-3" />
                                Recalcular IA
                              </Button>
                            )}
                            {!p.suggested_category && (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-8 text-[10px] gap-2 border-dashed"
                                disabled={isClassifying}
                                onClick={() => handleClassify(p.id)}
                              >
                                {isClassifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                Obter Sugestão IA
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Footer Actions */}
        <DialogFooter className="p-6 border-t bg-muted/10">
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                disabled={isBusy || selected.size === 0}
                onClick={() => handleApprove(Array.from(selected))}
                className="shadow-lg shadow-primary/20"
              >
                {isApproving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCheck className="w-4 h-4 mr-2" />}
                Aprovar Selecionadas ({selected.size})
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/5 hover:text-destructive border-destructive/20"
                disabled={isBusy || selected.size === 0}
                onClick={() => handleReject(Array.from(selected))}
              >
                {isRejecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                Rejeitar Selecionadas
              </Button>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="text-[11px] text-muted-foreground text-right hidden sm:block">
                <p>{filtered.length} produtos filtrados</p>
                <p>{selected.size} selecionados para ação</p>
              </div>
              <div className="w-[1px] h-8 bg-border hidden sm:block mx-2" />
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}