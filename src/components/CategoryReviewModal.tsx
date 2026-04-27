import React, { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, ArrowRight, Loader2, CheckCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
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
  const [filterSource, setFilterSource] = useState("all");
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const getEffectiveSuggestion = (p: CategoryProduct) => overrides[p.id] || p.suggested_category;

  // Only products with a suggested_category different from current
  const candidates = useMemo(() =>
    products.filter(p => p.suggested_category && p.suggested_category !== p.category),
    [products]
  );

  const uniqueCurrentCategories = useMemo(() =>
    [...new Set(candidates.map(p => p.category || "—").filter(Boolean))].sort(),
    [candidates]
  );
  const uniqueSources = useMemo(() =>
    [...new Set(candidates.map(p => p.source_file || "").filter(Boolean))].sort(),
    [candidates]
  );

  const filtered = useMemo(() =>
    candidates.filter(p => {
      if (filterCategory !== "all" && (p.category || "—") !== filterCategory) return false;
      if (filterSource !== "all" && (p.source_file || "") !== filterSource) return false;
      return true;
    }),
    [candidates, filterCategory, filterSource]
  );

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

  const batchUpdate = async (ids: string[], approve: boolean) => {
    const batchSize = 200;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const prods = candidates.filter(p => batch.includes(p.id));
      if (approve) {
        // Update each product: category = suggested_category, clear suggested_category
        for (const p of prods) {
          const { error } = await supabase
            .from("products")
            .update({ category: p.suggested_category, suggested_category: null })
            .eq("id", p.id);
          if (error) throw error;
        }
      } else {
        // Just clear suggested_category
        const { error } = await supabase
          .from("products")
          .update({ suggested_category: null })
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
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Revisão de Categorias Sugeridas pela IA
            <Badge variant="secondary" className="text-xs">{candidates.length} pendente(s)</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="h-8 text-xs w-[200px]">
              <SelectValue placeholder="Categoria atual" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {uniqueCurrentCategories.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {uniqueSources.length > 1 && (
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="h-8 text-xs w-[180px]">
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
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} produto(s) filtrado(s) · {selected.size} selecionado(s)
          </span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    disabled={isBusy}
                  />
                </TableHead>
                <TableHead className="text-xs">SKU</TableHead>
                <TableHead className="text-xs">Produto</TableHead>
                <TableHead className="text-xs">Categoria Atual</TableHead>
                <TableHead className="text-xs w-8"></TableHead>
                <TableHead className="text-xs">Sugerida pela IA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhum produto com categorias sugeridas pendentes.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map(p => (
                <TableRow key={p.id} className={cn(selected.has(p.id) && "bg-muted/50")}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleOne(p.id)}
                      disabled={isBusy}
                    />
                  </TableCell>
                  <TableCell className="text-xs font-mono">{p.sku}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate" title={p.original_title}>
                    {p.original_title}
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="text-[10px]">{p.category || "—"}</Badge>
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">{p.suggested_category}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Actions */}
        <DialogFooter className="flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap w-full justify-between">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="text-xs"
                disabled={isBusy || selected.size === 0}
                onClick={() => handleApprove(Array.from(selected))}
              >
                {isApproving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                Aprovar Selecionadas ({selected.size})
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="text-xs"
                disabled={isBusy || selected.size === 0}
                onClick={() => handleReject(Array.from(selected))}
              >
                {isRejecting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <X className="w-3.5 h-3.5 mr-1" />}
                Rejeitar Selecionadas ({selected.size})
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="text-xs"
                disabled={isBusy || filtered.length === 0}
                onClick={() => handleApprove(filtered.map(p => p.id))}
              >
                <CheckCheck className="w-3.5 h-3.5 mr-1" />
                Aprovar Todas ({filtered.length})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                disabled={isBusy || filtered.length === 0}
                onClick={() => handleReject(filtered.map(p => p.id))}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                Rejeitar Todas ({filtered.length})
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
