import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FolderTree, Plus, Edit, Trash2, ChevronRight, ChevronDown, Loader2, FolderOpen, RefreshCw, BarChart2, Download, ArrowRight, AlertTriangle, Sparkles, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCategoryTree, useCreateCategory, useUpdateCategory, useDeleteCategory, useSyncWooCategories, type CategoryTree, type Category } from "@/hooks/useCategories";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAllProductIds } from "@/hooks/useProducts";
import { getStorageJson, setStorageItem } from "@/lib/safeStorage";


function CategoryTreeItem({
  cat,
  flat,
  onEdit,
  onDelete,
  productCounts,
}: {
  cat: CategoryTree;
  flat: Category[];
  onEdit: (cat: Category) => void;
  onDelete: (id: string) => void;
  productCounts: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = cat.children.length > 0;
  const count = productCounts[cat.name] ?? 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors group",
        )}
        style={{ paddingLeft: `${cat.depth * 24 + 12}px` }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn("w-5 h-5 flex items-center justify-center", !hasChildren && "invisible")}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <FolderOpen className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-medium flex-1">{cat.name}</span>
        {cat.slug && <span className="text-xs text-muted-foreground font-mono">/{cat.slug}</span>}
        {count > 0 && (
          <Badge variant="secondary" className="text-[10px]">{count} produto(s)</Badge>
        )}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onEdit(cat)}>
            <Edit className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => onDelete(cat.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {expanded && hasChildren && (
        <div>
          {cat.children.map(child => (
            <CategoryTreeItem key={child.id} cat={child} flat={flat} onEdit={onEdit} onDelete={onDelete} productCounts={productCounts} />
          ))}
        </div>
      )}
    </div>
  );
}

const CategoriesPage = () => {
  const { data: tree, flat, isLoading } = useCategoryTree();
  const { data: products } = useAllProductIds();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const syncWooCategories = useSyncWooCategories();
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceContext();

  const [showForm, setShowForm] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", description: "", meta_title: "", meta_description: "", parent_id: "" });
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [fixingCorrupted, setFixingCorrupted] = useState(false);
  const [ignoredCorrupted, setIgnoredCorrupted] = useState<Set<string>>(
    () => new Set(getStorageJson<string[]>("ignored-corrupted-cats", []))
  );

  // Count products per category name
  const productCounts: Record<string, number> = {};
  (products ?? []).forEach(p => {
    if (p.category) {
      const parts = p.category.split(">").map((s: string) => s.trim());
      parts.forEach((part: string) => {
        productCounts[part] = (productCounts[part] ?? 0) + 1;
      });
    }
  });

  // Analysis computations
  const analysis = useMemo(() => {
    const maxDepth = flat.reduce((max, c) => Math.max(max, (c as any).depth ?? 0), 0);
    const deepCats = flat.filter(c => ((c as any).depth ?? 0) > 2);

    const lowCount = flat
      .filter(c => c.parent_id !== null && (productCounts[c.name] ?? 0) < 10)
      .sort((a, b) => (productCounts[a.name] ?? 0) - (productCounts[b.name] ?? 0));

    const suggestions: Array<{ cat: Category; action: string; attribute: string }> = [];
    const widthPattern = /\b[Ll]?(500|600|700|800)\b/;
    const posPattern = /\b(Central|Mural|Parede|Bancada)\b/i;
    const energyPattern = /\b(El[eé]tric[oa]|G[aá]s)\b/i;

    flat.forEach(c => {
      if (widthPattern.test(c.name)) {
        suggestions.push({ cat: c, action: "Converter para atributo", attribute: "pa_largura_mm" });
      } else if (posPattern.test(c.name)) {
        suggestions.push({ cat: c, action: "Converter para atributo", attribute: "pa_posicao" });
      } else if (energyPattern.test(c.name)) {
        suggestions.push({ cat: c, action: "Converter para atributo", attribute: "pa_energia" });
      }
    });

    const rootCats = flat.filter(c => c.parent_id === null).length;
    const avgDepth = flat.length > 0
      ? (flat.reduce((s, c) => s + ((c as any).depth ?? 0), 0) / flat.length).toFixed(1)
      : "0";

    return { maxDepth, deepCats, lowCount, suggestions, rootCats, avgDepth };
  }, [flat, productCounts]);

  // Corrupted categories detection
  const corruptedCats = useMemo(() => {
    type CorruptedCat = { cat: Category; problem: "hierarchy_path" | "multi_category" | "duplicate" };
    const results: CorruptedCat[] = [];
    const nameCount = new Map<string, Category[]>();

    flat.forEach(c => {
      if (ignoredCorrupted.has(c.id)) return;
      if (c.name.includes(">")) {
        results.push({ cat: c, problem: "hierarchy_path" });
      } else if (c.name.includes("|")) {
        results.push({ cat: c, problem: "multi_category" });
      }
      const lower = c.name.toLowerCase().trim();
      if (!nameCount.has(lower)) nameCount.set(lower, []);
      nameCount.get(lower)!.push(c);
    });

    nameCount.forEach((cats) => {
      if (cats.length > 1) {
        cats.forEach(c => {
          if (!ignoredCorrupted.has(c.id) && !results.some(r => r.cat.id === c.id)) {
            results.push({ cat: c, problem: "duplicate" });
          }
        });
      }
    });

    return results;
  }, [flat, ignoredCorrupted]);

  const ignoreCorrupted = (catId: string) => {
    setIgnoredCorrupted(prev => {
      const next = new Set(prev);
      next.add(catId);
      setStorageItem("ignored-corrupted-cats", JSON.stringify([...next]));
      return next;
    });
  };

  const fixCorruptedWithAI = async () => {
    if (!activeWorkspace) return;
    const toFix = corruptedCats.filter(c => c.problem !== "duplicate").map(c => c.cat.id);
    if (toFix.length === 0) { toast.info("Nenhuma categoria para corrigir"); return; }

    setFixingCorrupted(true);
    try {
      const { data, error } = await supabase.functions.invoke("fix-corrupted-categories", {
        body: { workspaceId: activeWorkspace.id, categoryIds: toFix },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${data.fixed} categorias corrigidas, ${data.skipped} ignoradas`);
      if (data.errors?.length > 0) {
        data.errors.forEach((e: string) => toast.error(e));
      }
      // Refresh categories
      window.location.reload();
    } catch (err: any) {
      toast.error(err.message || "Erro ao corrigir categorias");
    } finally {
      setFixingCorrupted(false);
    }
  };

  const exportAnalysisCSV = () => {
    const rows = [
      ["categoria", "slug", "profundidade", "nº_produtos", "sugestao"],
      ...flat.map(c => {
        const sugg = analysis.suggestions.find(s => s.cat.id === c.id);
        return [
          c.name,
          c.slug ?? "",
          String((c as any).depth ?? 0),
          String(productCounts[c.name] ?? 0),
          sugg ? `${sugg.action}: ${sugg.attribute}` : "",
        ];
      }),
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "analise-categorias.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const openCreate = (parentId?: string) => {
    setEditingCat(null);
    setForm({ name: "", slug: "", description: "", meta_title: "", meta_description: "", parent_id: parentId ?? "" });
    setShowForm(true);
  };

  const openEdit = (cat: Category) => {
    setEditingCat(cat);
    setForm({
      name: cat.name,
      slug: cat.slug ?? "",
      description: cat.description ?? "",
      meta_title: cat.meta_title ?? "",
      meta_description: cat.meta_description ?? "",
      parent_id: cat.parent_id ?? "",
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editingCat) {
      updateCategory.mutate({
        id: editingCat.id,
        updates: {
          name: form.name,
          slug: form.slug || null,
          description: form.description || null,
          meta_title: form.meta_title || null,
          meta_description: form.meta_description || null,
          parent_id: form.parent_id || null,
        },
      });
    } else {
      createCategory.mutate({
        name: form.name,
        slug: form.slug || undefined,
        description: form.description || undefined,
        meta_title: form.meta_title || undefined,
        meta_description: form.meta_description || undefined,
        parent_id: form.parent_id || null,
      });
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    const cat = flat.find(c => c.id === id);
    const hasChildren = flat.some(c => c.parent_id === id);
    if (hasChildren) {
      if (!confirm("Esta categoria tem subcategorias. As subcategorias ficarão sem pai. Continuar?")) return;
    } else {
      if (!confirm(`Eliminar "${cat?.name}"?`)) return;
    }
    deleteCategory.mutate(id);
  };

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderTree className="w-6 h-6" /> Categorias
          </h1>
          <p className="text-muted-foreground mt-1">{flat.length} categoria(s) — partilhadas entre todos os workspaces</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => syncWooCategories.mutate()} disabled={syncWooCategories.isPending}>
            {syncWooCategories.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Sincronizar WooCommerce
          </Button>
          <Button onClick={() => openCreate()}>
            <Plus className="w-4 h-4 mr-1" /> Nova Categoria
          </Button>
        </div>
      </div>

      {/* Pre-migration analysis panel */}
      <Collapsible open={analysisOpen} onOpenChange={setAnalysisOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <BarChart2 className="w-4 h-4" />
              Analisar estrutura
              {analysisOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </Button>
          </CollapsibleTrigger>
          {analysisOpen && (
            <Button variant="ghost" size="sm" className="gap-2" onClick={exportAnalysisCSV}>
              <Download className="w-3.5 h-3.5" /> Exportar CSV
            </Button>
          )}
        </div>

        <CollapsibleContent className="mt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Card 1 — Profundidade */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Profundidade da árvore</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className={cn("text-3xl font-bold",
                  analysis.maxDepth <= 2 ? "text-emerald-600" :
                  analysis.maxDepth === 3 ? "text-amber-600" : "text-destructive"
                )}>
                  {analysis.maxDepth}
                </div>
                {analysis.deepCats.length === 0 ? (
                  <p className="text-xs text-emerald-600">Estrutura plana — ótima!</p>
                ) : (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {analysis.deepCats.map(c => (
                      <div key={c.id} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate">{c.name}</span>
                        <Badge variant="outline" className="text-[10px] ml-1 shrink-0">
                          nível {(c as any).depth}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card 2 — Baixo nº produtos */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Candidatas a filtro</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-xs text-muted-foreground mb-2">Subcategorias com menos de 10 produtos</p>
                {analysis.lowCount.length === 0 ? (
                  <p className="text-xs text-emerald-600">Todas têm produtos suficientes</p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {analysis.lowCount.slice(0, 12).map(c => (
                      <div key={c.id} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate">{c.name}</span>
                        <Badge variant="secondary" className="text-[10px] ml-1 shrink-0">
                          {productCounts[c.name] ?? 0}
                        </Badge>
                      </div>
                    ))}
                    {analysis.lowCount.length > 12 && (
                      <p className="text-xs text-muted-foreground pt-1">
                        +{analysis.lowCount.length - 12} mais...
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card 3 — Sugestões automáticas */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Sugestões automáticas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {analysis.suggestions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum padrão detectado</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {analysis.suggestions.slice(0, 10).map(s => (
                      <div key={s.cat.id} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px] shrink-0 max-w-[120px] truncate">
                          {s.cat.name}
                        </Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">
                          {s.attribute}
                        </span>
                      </div>
                    ))}
                    {analysis.suggestions.length > 10 && (
                      <p className="text-xs text-muted-foreground pt-1">
                        +{analysis.suggestions.length - 10} mais sugestões
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card 4 — Resumo + CTA */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Resumo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center">
                    <div className="text-xl font-bold">{flat.length}</div>
                    <div className="text-[10px] text-muted-foreground">Total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold">{analysis.rootCats}</div>
                    <div className="text-[10px] text-muted-foreground">Raiz</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold">{analysis.avgDepth}</div>
                    <div className="text-[10px] text-muted-foreground">Profund. média</div>
                  </div>
                </div>
                <Button 
                  size="sm" 
                  className="w-full gap-2 mt-2" 
                  onClick={() => navigate("/category-architect")}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  Ir para Category Architect
                </Button>
              </CardContent>
            </Card>

          </div>
        </CollapsibleContent>
      </Collapsible>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : tree.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FolderTree className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Nenhuma categoria criada.</p>
              <p className="text-xs mt-1">Crie categorias para organizar os seus produtos.</p>
              <Button variant="outline" className="mt-4" onClick={() => openCreate()}>
                <Plus className="w-4 h-4 mr-1" /> Criar Primeira Categoria
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {tree.map(cat => (
                <CategoryTreeItem key={cat.id} cat={cat} flat={flat} onEdit={openEdit} onDelete={handleDelete} productCounts={productCounts} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCat ? "Editar Categoria" : "Nova Categoria"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Equipamento de Cozinha" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Slug</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="equipamento-de-cozinha" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Categoria Pai</Label>
              <Select value={form.parent_id || "none"} onValueChange={v => setForm(f => ({ ...f, parent_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Nenhuma (raiz)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma (raiz)</SelectItem>
                  {flat.filter(c => c.id !== editingCat?.id).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição SEO</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Descrição da categoria para SEO..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Meta Title</Label>
                <Input value={form.meta_title} onChange={e => setForm(f => ({ ...f, meta_title: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Meta Description</Label>
                <Input value={form.meta_description} onChange={e => setForm(f => ({ ...f, meta_description: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || createCategory.isPending || updateCategory.isPending}>
              {editingCat ? "Guardar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CategoriesPage;
