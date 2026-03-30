import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2, Wand2, Play, CheckCircle, XCircle, Clock, Sparkles, ArrowRight, Merge, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCategories, type Category } from "@/hooks/useCategories";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";
import { getStorageItem, setStorageItem } from "@/lib/safeStorage";
import {
  useArchitectRules,
  useSaveRule,
  useDeleteRule,
  useCreateWooAttribute,
  useMigrateProducts,
  useDeleteWooCategory,
  type ArchitectRule,
} from "@/hooks/useCategoryArchitect";

// ── Types ──
interface AiSuggestion {
  categoryName: string;
  categoryId: string | null;
  action: "keep" | "convert" | "merge";
  attributeSlug: string | null;
  attributeValues: string[] | null;
  mergeIntoName: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  productCount: number;
}

interface DuplicateGroup {
  groupName: string;
  categories: Array<{
    id: string;
    name: string;
    path: string;
    productCount: number;
    suggestedAction: "keep" | "merge_into" | "move_products";
    mergeTarget: string | null;
  }>;
  confidence: "high" | "medium" | "low";
  reason: string;
}

// ── Local draft state for new rules not yet saved ──
interface DraftRule {
  localId: string;
  source_category_id: string;
  source_category_name: string;
  action: "keep" | "convert_to_attribute" | "merge_into";
  target_category_id: string;
  attribute_slug: string;
  attribute_name: string;
  attribute_values: string;
}

function newDraft(): DraftRule {
  return {
    localId: crypto.randomUUID(),
    source_category_id: "",
    source_category_name: "",
    action: "keep",
    target_category_id: "",
    attribute_slug: "",
    attribute_name: "",
    attribute_values: "",
  };
}

// ── Status badges ──
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>;
    case "attribute_created":
      return <Badge variant="default"><CheckCircle className="w-3 h-3 mr-1" />Criado</Badge>;
    case "migrating":
      return <Badge variant="outline"><Loader2 className="w-3 h-3 mr-1 animate-spin" />A migrar</Badge>;
    case "migrated":
      return <Badge variant="default"><CheckCircle className="w-3 h-3 mr-1" />Concluído</Badge>;
    case "error":
      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Erro</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ── Confidence badge ──
function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  switch (level) {
    case "high":
      return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">Alta</Badge>;
    case "medium":
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">Média</Badge>;
    case "low":
      return <Badge variant="outline" className="text-muted-foreground text-[10px]">Baixa</Badge>;
  }
}

// ── Action icon ──
function ActionIcon({ action }: { action: "keep" | "convert" | "merge" }) {
  switch (action) {
    case "keep":
      return <ShieldCheck className="w-4 h-4 text-emerald-600" />;
    case "convert":
      return <ArrowRight className="w-4 h-4 text-primary" />;
    case "merge":
      return <Merge className="w-4 h-4 text-amber-600" />;
  }
}

function actionLabel(action: "keep" | "convert" | "merge", slug?: string | null, mergeName?: string | null) {
  if (action === "keep") return "Manter";
  if (action === "convert") return `Converter → ${slug || "pa_..."}`;
  if (action === "merge") return `Fundir em ${mergeName || "..."}`;
  return action;
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 1 — MAPEAMENTO
// ═══════════════════════════════════════════════════════════════════════
function MapeamentoTab({ categories, allCategories }: { categories: { id: string; name: string }[]; allCategories: Category[] }) {
  const { data: savedRules = [] } = useArchitectRules();
  const saveRule = useSaveRule();
  const deleteRule = useDeleteRule();
  const { activeWorkspace } = useWorkspaceContext();
  const [drafts, setDrafts] = useState<DraftRule[]>([]);

  // AI provider state
  const [aiProvider, setAiProvider] = useState<string>(
    () => getStorageItem("category-architect-ai-provider") || "gemini"
  );
  const handleProviderChange = (v: string) => {
    setAiProvider(v);
    setStorageItem("category-architect-ai-provider", v);
  };

  // AI analysis state
  const [selectedRootCat, setSelectedRootCat] = useState<string>("");
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [showCheckboxes, setShowCheckboxes] = useState(false);

  // Duplicate detection state
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateLoading, setDuplicateLoading] = useState(false);

  // Root categories
  const rootCategories = allCategories.filter(c => c.parent_id === null);
  const selectedRoot = allCategories.find(c => c.id === selectedRootCat);
  const childrenOfRoot = selectedRootCat
    ? allCategories.filter(c => c.parent_id === selectedRootCat)
    : [];

  // AI analysis handler
  const runAnalysis = async () => {
    if (!selectedRootCat || !activeWorkspace) return;
    setAnalysisLoading(true);
    setAiSuggestions([]);
    setShowCheckboxes(false);
    setSelectedSuggestions(new Set());

    try {
      const { data, error } = await supabase.functions.invoke("analyse-category-structure", {
        body: {
          workspaceId: activeWorkspace.id,
          parentCategoryId: selectedRootCat,
          aiProvider,
        },
      });

      if (error) throw error;
      if (data?.error === "no_children") {
        toast.info("Esta categoria não tem subcategorias para analisar.");
        return;
      }
      if (data?.error) throw new Error(data.error);

      setAiSuggestions(data.suggestions || []);
      toast.success(`${(data.suggestions || []).length} sugestões geradas pela IA`);
    } catch (err: any) {
      console.error("AI analysis error:", err);
      toast.error(err.message || "Erro na análise com IA");
    } finally {
      setAnalysisLoading(false);
    }
  };

  // Accept suggestions
  const acceptSuggestions = (suggestions: AiSuggestion[]) => {
    let count = 0;
    for (const s of suggestions) {
      if (s.action === "keep") {
        saveRule.mutate({
          source_category_id: s.categoryId,
          source_category_name: s.categoryName,
          action: "keep",
          target_category_id: null,
          attribute_slug: null,
          attribute_name: null,
          attribute_values: [],
        });
        count++;
      } else if (s.action === "convert") {
        saveRule.mutate({
          source_category_id: s.categoryId,
          source_category_name: s.categoryName,
          action: "convert_to_attribute",
          target_category_id: null,
          attribute_slug: s.attributeSlug,
          attribute_name: s.attributeSlug?.replace("pa_", "").replace(/_/g, " ") || null,
          attribute_values: s.attributeValues || [],
        });
        count++;
      } else if (s.action === "merge") {
        const targetCat = allCategories.find(c => c.name === s.mergeIntoName);
        saveRule.mutate({
          source_category_id: s.categoryId,
          source_category_name: s.categoryName,
          action: "merge_into",
          target_category_id: targetCat?.id || null,
          attribute_slug: null,
          attribute_name: null,
          attribute_values: [],
        });
        count++;
      }
    }
    toast.success(`${count} regras adicionadas ao mapeamento`);
    setAiSuggestions([]);
    setShowCheckboxes(false);
    setSelectedSuggestions(new Set());
  };

  const acceptAll = () => acceptSuggestions(aiSuggestions);

  const acceptSelected = () => {
    const selected = aiSuggestions.filter(
      s => s.categoryId && selectedSuggestions.has(s.categoryId)
    );
    if (selected.length === 0) {
      toast.error("Selecione pelo menos uma sugestão");
      return;
    }
    acceptSuggestions(selected);
  };

  const toggleSuggestion = (id: string) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Duplicate detection handler
  const runDuplicateDetection = async () => {
    if (!activeWorkspace) return;
    setDuplicateLoading(true);
    setDuplicateGroups([]);
    try {
      const { data, error } = await supabase.functions.invoke("detect-duplicate-categories", {
        body: { workspaceId: activeWorkspace.id, aiProvider },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDuplicateGroups(data.groups || []);
      toast.success(`${(data.groups || []).length} grupos de duplicados encontrados`);
    } catch (err: any) {
      toast.error(err.message || "Erro na detecção de duplicados");
    } finally {
      setDuplicateLoading(false);
    }
  };

  const addDuplicateToMapping = (group: DuplicateGroup) => {
    let count = 0;
    for (const cat of group.categories) {
      if (cat.suggestedAction === "keep") continue;
      saveRule.mutate({
        source_category_id: cat.id,
        source_category_name: cat.name,
        action: cat.suggestedAction === "merge_into" ? "merge_into" : "merge_into",
        target_category_id: cat.mergeTarget || null,
        attribute_slug: null,
        attribute_name: null,
        attribute_values: [],
      });
      count++;
    }
    toast.success(`${count} regras adicionadas do grupo "${group.groupName}"`);
  };

  // Draft handlers
  const addDraft = () => setDrafts(prev => [...prev, newDraft()]);
  const removeDraft = (localId: string) => setDrafts(prev => prev.filter(d => d.localId !== localId));
  const updateDraft = (localId: string, field: keyof DraftRule, value: string) =>
    setDrafts(prev => prev.map(d => d.localId === localId ? { ...d, [field]: value } : d));

  const saveDraft = (draft: DraftRule) => {
    const cat = categories.find(c => c.id === draft.source_category_id);
    saveRule.mutate({
      source_category_id: draft.source_category_id || null,
      source_category_name: cat?.name || draft.source_category_name || "—",
      action: draft.action,
      target_category_id: draft.action === "merge_into" ? draft.target_category_id : null,
      attribute_slug: draft.action === "convert_to_attribute" ? draft.attribute_slug : null,
      attribute_name: draft.action === "convert_to_attribute" ? draft.attribute_name : null,
      attribute_values: draft.action === "convert_to_attribute"
        ? draft.attribute_values.split(",").map(v => v.trim()).filter(Boolean)
        : [],
    }, {
      onSuccess: () => removeDraft(draft.localId),
    });
  };

  return (
    <div className="space-y-4">
      {/* ── AI Analysis Section ── */}
      <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-sm flex-1">Análise com IA</h3>
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-muted-foreground">IA:</Label>
            <Select value={aiProvider} onValueChange={handleProviderChange}>
              <SelectTrigger className="h-7 text-xs w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini">Gemini (Google)</SelectItem>
                <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                <SelectItem value="openai">GPT (OpenAI)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Step 1 — Category selector */}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Seleciona uma categoria para analisar</label>
          <Select value={selectedRootCat} onValueChange={v => { setSelectedRootCat(v); setAiSuggestions([]); }}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Escolhe a categoria pai..." />
            </SelectTrigger>
            <SelectContent>
              {rootCategories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Show children as badges */}
          {childrenOfRoot.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {childrenOfRoot.map(c => (
                <Badge key={c.id} variant="secondary" className="text-[10px]">{c.name}</Badge>
              ))}
            </div>
          )}
        </div>

        {/* Step 2 — Analyse button */}
        <Button
          size="sm"
          disabled={!selectedRootCat || analysisLoading}
          onClick={runAnalysis}
          className="gap-2"
        >
          {analysisLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          Analisar com IA
        </Button>

        {/* Loading state */}
        {analysisLoading && (
          <div className="flex items-center gap-3 py-4">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">A analisar estrutura de categorias com IA...</span>
          </div>
        )}

        {/* Step 3 — Results */}
        {aiSuggestions.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {aiSuggestions.length} sugestões para <span className="font-medium text-foreground">{selectedRoot?.name}</span>
            </p>

            <div className="grid grid-cols-1 gap-2">
              {aiSuggestions.map((s, idx) => (
                <Card key={s.categoryId || idx} className="p-3">
                  <div className="flex items-start gap-3">
                    {showCheckboxes && s.categoryId && (
                      <Checkbox
                        checked={selectedSuggestions.has(s.categoryId)}
                        onCheckedChange={() => toggleSuggestion(s.categoryId!)}
                        className="mt-1"
                      />
                    )}
                    <ActionIcon action={s.action} />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{s.categoryName}</span>
                        <Badge variant="secondary" className="text-[10px]">{s.productCount} prod.</Badge>
                        <ConfidenceBadge level={s.confidence} />
                      </div>
                      <p className="text-xs font-medium text-primary">
                        {actionLabel(s.action, s.attributeSlug, s.mergeIntoName)}
                      </p>
                      {s.attributeValues && s.attributeValues.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {s.attributeValues.map(v => (
                            <Badge key={v} variant="outline" className="text-[10px]">{v}</Badge>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">{s.reason}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Accept buttons */}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={acceptAll} className="gap-2">
                <CheckCircle className="w-3.5 h-3.5" />
                Aceitar todas as sugestões
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (showCheckboxes) {
                    acceptSelected();
                  } else {
                    setShowCheckboxes(true);
                  }
                }}
                className="gap-2"
              >
                {showCheckboxes ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    Aceitar seleccionadas ({selectedSuggestions.size})
                  </>
                ) : (
                  "Aceitar seleccionadas"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Existing rules table ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5" /> Mapeamento de Categorias
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Saved rules */}
          {savedRules.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria origem</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Detalhes</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {savedRules.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.source_category_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {rule.action === "keep" ? "Manter" : rule.action === "convert_to_attribute" ? "→ Atributo" : "Fundir em..."}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {rule.action === "convert_to_attribute" && (
                        <span>{rule.attribute_slug} = {rule.attribute_values?.join(", ")}</span>
                      )}
                    </TableCell>
                    <TableCell><StatusBadge status={rule.migration_status} /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => deleteRule.mutate(rule.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Draft rules */}
          {drafts.map(draft => (
            <div key={draft.localId} className="grid grid-cols-1 md:grid-cols-6 gap-3 p-4 border rounded-lg bg-muted/30">
              <Select value={draft.source_category_id} onValueChange={v => updateDraft(draft.localId, "source_category_id", v)}>
                <SelectTrigger><SelectValue placeholder="Categoria origem" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={draft.action} onValueChange={v => updateDraft(draft.localId, "action", v as DraftRule["action"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Manter como categoria</SelectItem>
                  <SelectItem value="convert_to_attribute">Converter para atributo</SelectItem>
                  <SelectItem value="merge_into">Fundir em...</SelectItem>
                </SelectContent>
              </Select>

              {draft.action === "merge_into" && (
                <Select value={draft.target_category_id} onValueChange={v => updateDraft(draft.localId, "target_category_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Categoria destino" /></SelectTrigger>
                  <SelectContent>
                    {categories.filter(c => c.id !== draft.source_category_id).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {draft.action === "convert_to_attribute" && (
                <>
                  <Input placeholder="pa_slug (ex: pa_largura_mm)" value={draft.attribute_slug}
                    onChange={e => updateDraft(draft.localId, "attribute_slug", e.target.value)} />
                  <Input placeholder="Nome (ex: Largura)" value={draft.attribute_name}
                    onChange={e => updateDraft(draft.localId, "attribute_name", e.target.value)} />
                  <Input placeholder="Valores (500,600,700)" value={draft.attribute_values}
                    onChange={e => updateDraft(draft.localId, "attribute_values", e.target.value)} />
                </>
              )}

              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveDraft(draft)} disabled={saveRule.isPending}>
                  {saveRule.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => removeDraft(draft.localId)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="outline" onClick={addDraft} className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Adicionar regra
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 2 — CRIAR ATRIBUTOS
// ═══════════════════════════════════════════════════════════════════════
function CriarAtributosTab() {
  const { data: rules = [] } = useArchitectRules();
  const createAttr = useCreateWooAttribute();
  const attrRules = rules.filter(r => r.action === "convert_to_attribute");
  const [runningAll, setRunningAll] = useState(false);

  const createAll = async () => {
    setRunningAll(true);
    for (const rule of attrRules.filter(r => r.migration_status === "pending")) {
      try {
        await createAttr.mutateAsync(rule);
      } catch { /* individual error already toasted */ }
    }
    setRunningAll(false);
  };

  if (attrRules.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma regra de conversão para atributo. Adicione no separador "Mapeamento".
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Criar Atributos no WooCommerce</CardTitle>
        <Button onClick={createAll} disabled={runningAll}>
          {runningAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
          Criar todos
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Atributo</TableHead>
              <TableHead>Valores</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-40">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attrRules.map(rule => (
              <TableRow key={rule.id}>
                <TableCell className="font-mono text-sm">{rule.attribute_slug}</TableCell>
                <TableCell className="text-sm">{rule.attribute_values?.join(", ")}</TableCell>
                <TableCell><StatusBadge status={rule.migration_status === "pending" ? "pending" : "attribute_created"} /></TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    disabled={createAttr.isPending || rule.migration_status !== "pending"}
                    onClick={() => createAttr.mutate(rule)}
                  >
                    {createAttr.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar no WooCommerce"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 3 — MIGRAR PRODUTOS
// ═══════════════════════════════════════════════════════════════════════
function MigrarProdutosTab() {
  const { data: rules = [] } = useArchitectRules();
  const migrate = useMigrateProducts();
  const deleteWooCat = useDeleteWooCategory();
  const attrRules = rules.filter(r => r.action === "convert_to_attribute");
  const [runningAll, setRunningAll] = useState(false);

  const runAll = async () => {
    setRunningAll(true);
    for (const rule of attrRules.filter(r => ["pending", "attribute_created"].includes(r.migration_status))) {
      try {
        await migrate.mutateAsync(rule);
      } catch { /* individual error already toasted */ }
    }
    setRunningAll(false);
  };

  if (attrRules.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma regra de conversão para atributo. Adicione no separador "Mapeamento".
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Migrar Produtos</CardTitle>
        <Button onClick={runAll} disabled={runningAll}>
          {runningAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          Executar todos
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Categoria origem</TableHead>
              <TableHead>Atributo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Progresso</TableHead>
              <TableHead className="w-48">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attrRules.map(rule => (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.source_category_name}</TableCell>
                <TableCell className="font-mono text-sm">{rule.attribute_slug}</TableCell>
                <TableCell><StatusBadge status={rule.migration_status} /></TableCell>
                <TableCell>
                  {rule.migration_status === "migrating" ? (
                    <div className="space-y-1">
                      <Progress value={rule.migration_total > 0 ? (rule.migration_progress / rule.migration_total) * 100 : 0} className="h-2" />
                      <span className="text-xs text-muted-foreground">{rule.migration_progress} / {rule.migration_total}</span>
                    </div>
                  ) : rule.migration_status === "migrated" ? (
                    <span className="text-sm text-primary">{rule.migration_total} produtos</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="space-x-2">
                  {["pending", "attribute_created"].includes(rule.migration_status) && (
                    <Button size="sm" onClick={() => migrate.mutate(rule)} disabled={migrate.isPending}>
                      {migrate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Play className="w-3 h-3 mr-1" />Executar</>}
                    </Button>
                  )}
                  {rule.migration_status === "migrated" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive">
                          <Trash2 className="w-3 h-3 mr-1" />Remover categoria
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remover categoria antiga?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação vai eliminar permanentemente a categoria "{rule.source_category_name}" do WooCommerce.
                            Os produtos já foram migrados para o atributo "{rule.attribute_slug}".
                            Esta ação não pode ser revertida.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteWooCat.mutate(rule)}
                          >
                            {deleteWooCat.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sim, eliminar"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {rule.migration_status === "error" && (
                    <span className="text-xs text-destructive">{rule.error_message}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════
export default function CategoryArchitectPage() {
  const { data: categories = [], isLoading } = useCategories();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const flatCats = categories.map(c => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Category Architect</h1>
        <p className="text-muted-foreground">Reestruture a taxonomia do catálogo: mapeie, crie atributos e migre produtos.</p>
      </div>

      <Tabs defaultValue="mapeamento">
        <TabsList>
          <TabsTrigger value="mapeamento">Mapeamento</TabsTrigger>
          <TabsTrigger value="atributos">Criar Atributos</TabsTrigger>
          <TabsTrigger value="migrar">Migrar Produtos</TabsTrigger>
        </TabsList>
        <TabsContent value="mapeamento">
          <MapeamentoTab categories={flatCats} allCategories={categories} />
        </TabsContent>
        <TabsContent value="atributos">
          <CriarAtributosTab />
        </TabsContent>
        <TabsContent value="migrar">
          <MigrarProdutosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
