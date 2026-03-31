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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Trash2, Wand2, Play, CheckCircle, XCircle, Clock, Sparkles, ArrowRight, Merge, ShieldCheck, AlertTriangle, RotateCcw, Eye, List } from "lucide-react";
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
  usePauseMigration,
  useDeleteWooCategory,
  useResetRuleStatus,
  useRollbackMigration,
  type ArchitectRule,
  type MigrationResult,
  type RollbackResult,
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

interface ExtractedAttribute {
  slug: string;
  label: string;
  value: string;
}

interface DuplicateCategoryEntry {
  id: string;
  name: string;
  path: string;
  productCount: number;
  suggestedAction: "keep" | "merge_into" | "move_products";
  mergeTarget: string | null;
  extractedAttributes: ExtractedAttribute[];
}

interface DuplicateGroup {
  groupName: string;
  categories: DuplicateCategoryEntry[];
  confidence: "high" | "medium" | "low";
  reason: string;
}

// Per-category resolution choice
interface DuplicateResolution {
  catId: string;
  action: "keep" | "merge_into" | "convert_to_attribute";
  targetCategoryId: string | null;
  // Support multiple attributes (e.g. pa_linha + pa_tipo_energia)
  attributes: Array<{ slug: string; name: string; values: string }>;
  // Track if this individual item has been accepted
  accepted: boolean;
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
    case "queued":
      return <Badge variant="outline" className="border-blue-400 text-blue-600"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Em fila</Badge>;
    case "migrating":
      return <Badge variant="outline"><Loader2 className="w-3 h-3 mr-1 animate-spin" />A migrar</Badge>;
    case "paused":
      return <Badge variant="outline" className="border-amber-400 text-amber-600"><Clock className="w-3 h-3 mr-1" />Parado</Badge>;
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
function MapeamentoTab({ categories, allCategories, duplicateGroups, setDuplicateGroups, duplicateLoading, setDuplicateLoading }: {
  categories: { id: string; name: string }[];
  allCategories: Category[];
  duplicateGroups: DuplicateGroup[];
  setDuplicateGroups: (g: DuplicateGroup[]) => void;
  duplicateLoading: boolean;
  setDuplicateLoading: (v: boolean) => void;
}) {
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

  // Duplicate resolution state (per-category choices within groups)
  const [resolutions, setResolutions] = useState<Record<string, DuplicateResolution>>({});

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
    try {
      const { data, error } = await supabase.functions.invoke("detect-duplicate-categories", {
        body: { workspaceId: activeWorkspace.id, aiProvider },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const groups = data.groups || [];
      setDuplicateGroups(groups);
      // Initialize resolutions from AI suggestions
      const newRes: Record<string, DuplicateResolution> = {};
      for (const g of groups) {
        for (const c of g.categories) {
          const attrs = (c.extractedAttributes || []).map((a: ExtractedAttribute) => ({
            slug: a.slug,
            name: a.label || a.slug.replace("pa_", "").replace(/_/g, " "),
            values: a.value || "",
          }));
          newRes[c.id] = {
            catId: c.id,
            action: c.suggestedAction === "keep" ? "keep" : c.suggestedAction === "move_products" ? "convert_to_attribute" : "merge_into",
            targetCategoryId: c.mergeTarget,
            attributes: attrs.length > 0 ? attrs : [{ slug: "", name: "", values: "" }],
            accepted: false,
          };
        }
      }
      setResolutions(prev => ({ ...prev, ...newRes }));
      if (data?.warning) toast.info(data.warning);
      toast.success(`${groups.length} grupos de duplicados encontrados`);
    } catch (err: any) {
      toast.error(err.message || "Erro na detecção de duplicados");
    } finally {
      setDuplicateLoading(false);
    }
  };

  const updateResolution = (catId: string, field: keyof DuplicateResolution, value: any) => {
    setResolutions(prev => ({
      ...prev,
      [catId]: { ...prev[catId], [field]: value },
    }));
  };

  const updateResolutionAttribute = (catId: string, attrIndex: number, field: string, value: string) => {
    setResolutions(prev => {
      const res = { ...prev[catId] };
      const attrs = [...res.attributes];
      attrs[attrIndex] = { ...attrs[attrIndex], [field]: value };
      return { ...prev, [catId]: { ...res, attributes: attrs } };
    });
  };

  const addResolutionAttribute = (catId: string) => {
    setResolutions(prev => {
      const res = { ...prev[catId] };
      return { ...prev, [catId]: { ...res, attributes: [...res.attributes, { slug: "", name: "", values: "" }] } };
    });
  };

  const removeResolutionAttribute = (catId: string, attrIndex: number) => {
    setResolutions(prev => {
      const res = { ...prev[catId] };
      const attrs = res.attributes.filter((_, i) => i !== attrIndex);
      return { ...prev, [catId]: { ...res, attributes: attrs.length > 0 ? attrs : [{ slug: "", name: "", values: "" }] } };
    });
  };

  // Accept a SINGLE category from a group
  const acceptSingleCategory = (cat: DuplicateCategoryEntry) => {
    const res = resolutions[cat.id];
    if (!res) return;

    if (res.action === "keep") {
      saveRule.mutate({
        source_category_id: cat.id,
        source_category_name: cat.name,
        action: "keep",
        target_category_id: null, attribute_slug: null, attribute_name: null, attribute_values: [],
      });
    } else if (res.action === "merge_into") {
      // For merge_into with extracted attributes, create the merge rule
      // AND attribute rules for each extracted attribute
      saveRule.mutate({
        source_category_id: cat.id,
        source_category_name: cat.name,
        action: "merge_into",
        target_category_id: res.targetCategoryId || null,
        attribute_slug: null, attribute_name: null, attribute_values: [],
      });
      // Also create attribute rules if there are extracted attributes
      for (const attr of res.attributes) {
        if (attr.slug && attr.values) {
          saveRule.mutate({
            source_category_id: cat.id,
            source_category_name: `${cat.name} → ${attr.name}`,
            action: "convert_to_attribute",
            target_category_id: null,
            attribute_slug: attr.slug,
            attribute_name: attr.name,
            attribute_values: attr.values.split(",").map(v => v.trim()).filter(Boolean),
          });
        }
      }
    } else if (res.action === "convert_to_attribute") {
      for (const attr of res.attributes) {
        if (attr.slug && attr.values) {
          saveRule.mutate({
            source_category_id: cat.id,
            source_category_name: cat.name,
            action: "convert_to_attribute",
            target_category_id: null,
            attribute_slug: attr.slug,
            attribute_name: attr.name,
            attribute_values: attr.values.split(",").map(v => v.trim()).filter(Boolean),
          });
        }
      }
    }

    // Mark as accepted
    updateResolution(cat.id, "accepted", true);
    toast.success(`"${cat.name}" aceite e adicionado ao mapeamento`);
  };

  const addGroupToMapping = (group: DuplicateGroup) => {
    let count = 0;
    for (const cat of group.categories) {
      const res = resolutions[cat.id];
      if (!res || res.accepted) continue;
      acceptSingleCategory(cat);
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

      {/* ── Duplicate Detection Section ── */}
      <div className="border border-amber-500/20 bg-amber-500/5 rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <h3 className="font-semibold text-sm flex-1">Duplicados detectados em todo o catálogo</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={duplicateLoading}
            onClick={runDuplicateDetection}
            className="gap-2"
          >
            {duplicateLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            Detectar duplicados (catálogo completo)
          </Button>
        </div>

        {duplicateLoading && (
          <div className="flex items-center gap-3 py-4">
            <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
            <span className="text-sm text-muted-foreground">A analisar todo o catálogo para duplicados...</span>
          </div>
        )}

        {duplicateGroups.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{duplicateGroups.length} grupos de categorias duplicadas encontrados</p>
            {duplicateGroups.map((group, idx) => (
              <Card key={idx}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">{group.groupName}</CardTitle>
                     <div className="flex items-center gap-2">
                      <ConfidenceBadge level={group.confidence} />
                      <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => addGroupToMapping(group)}>
                        <Plus className="w-3 h-3" /> Aceitar todo o grupo
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground mb-2">{group.reason}</p>
                  {group.categories.map(c => {
                    const res = resolutions[c.id];
                    const action = res?.action || (c.suggestedAction === "keep" ? "keep" : "merge_into");
                    const isAccepted = res?.accepted || false;
                    return (
                      <div key={c.id} className={`border rounded-lg p-3 space-y-2 ${isAccepted ? "bg-primary/5 border-primary/30 opacity-70" : "bg-muted/30"}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground flex-1 truncate">{c.path || c.name}</span>
                          <Badge variant="secondary" className="text-[10px] shrink-0">{c.productCount} prod.</Badge>
                          {isAccepted && <Badge className="bg-primary/10 text-primary text-[10px]"><CheckCircle className="w-3 h-3 mr-1" />Aceite</Badge>}
                        </div>

                        {/* Extracted attributes preview */}
                        {(c.extractedAttributes || []).length > 0 && !isAccepted && (
                          <div className="flex gap-1.5 flex-wrap">
                            {c.extractedAttributes.map((attr, ai) => (
                              <Badge key={ai} variant="outline" className="text-[10px] gap-1 font-mono">
                                {attr.slug} = {attr.value}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {!isAccepted && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Label className="text-[10px] text-muted-foreground shrink-0">Ação:</Label>
                              <Select value={action} onValueChange={(v) => updateResolution(c.id, "action", v)}>
                                <SelectTrigger className="h-7 text-xs w-[180px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="keep">Manter como categoria</SelectItem>
                                  <SelectItem value="merge_into">Fundir em outra categoria</SelectItem>
                                  <SelectItem value="convert_to_attribute">Converter para atributo/filtro</SelectItem>
                                </SelectContent>
                              </Select>

                              {action === "merge_into" && (
                                <Select
                                  value={res?.targetCategoryId || ""}
                                  onValueChange={(v) => updateResolution(c.id, "targetCategoryId", v)}
                                >
                                  <SelectTrigger className="h-7 text-xs w-[220px]">
                                    <SelectValue placeholder="Categoria destino..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {group.categories.filter(gc => gc.id !== c.id).map(gc => (
                                      <SelectItem key={gc.id} value={gc.id}>{gc.name}</SelectItem>
                                    ))}
                                    {categories.filter(cat => cat.id !== c.id && !group.categories.some(gc => gc.id === cat.id)).map(cat => (
                                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}

                              {/* Accept individual button */}
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs gap-1 ml-auto"
                                onClick={() => acceptSingleCategory(c)}
                              >
                                <CheckCircle className="w-3 h-3" /> Aceitar
                              </Button>
                            </div>

                            {/* Attribute editors for merge_into (with attributes) or convert_to_attribute */}
                            {(action === "convert_to_attribute" || (action === "merge_into" && (res?.attributes || []).some(a => a.slug))) && (
                              <div className="pl-4 border-l-2 border-primary/20 space-y-1.5">
                                <Label className="text-[10px] text-muted-foreground">Atributos a criar:</Label>
                                {(res?.attributes || []).map((attr, ai) => (
                                  <div key={ai} className="flex gap-1.5 items-center flex-wrap">
                                    <Input
                                      className="h-7 text-xs w-[120px] font-mono"
                                      placeholder="pa_slug"
                                      value={attr.slug}
                                      onChange={(e) => updateResolutionAttribute(c.id, ai, "slug", e.target.value)}
                                    />
                                    <Input
                                      className="h-7 text-xs w-[110px]"
                                      placeholder="Nome"
                                      value={attr.name}
                                      onChange={(e) => updateResolutionAttribute(c.id, ai, "name", e.target.value)}
                                    />
                                    <Input
                                      className="h-7 text-xs w-[140px]"
                                      placeholder="Valores"
                                      value={attr.values}
                                      onChange={(e) => updateResolutionAttribute(c.id, ai, "values", e.target.value)}
                                    />
                                    {(res?.attributes || []).length > 1 && (
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeResolutionAttribute(c.id, ai)}>
                                        <Trash2 className="w-3 h-3 text-destructive" />
                                      </Button>
                                    )}
                                  </div>
                                ))}
                                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => addResolutionAttribute(c.id)}>
                                  <Plus className="w-3 h-3" /> Adicionar atributo
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

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
  const resetStatus = useResetRuleStatus();
  const attrRules = rules.filter(r => r.action === "convert_to_attribute");
  const [runningAll, setRunningAll] = useState(false);

  const createAll = async () => {
    setRunningAll(true);
    for (const rule of attrRules.filter(r => r.migration_status === "pending" || r.migration_status === "error")) {
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
            {attrRules.map(rule => {
              const canRetry = rule.migration_status === "pending" || rule.migration_status === "error";
              return (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono text-sm">{rule.attribute_slug}</TableCell>
                  <TableCell className="text-sm">{rule.attribute_values?.join(", ")}</TableCell>
                  <TableCell>
                    <StatusBadge status={rule.migration_status} />
                    {rule.migration_status === "error" && rule.error_message && (
                      <p className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={rule.error_message}>{rule.error_message}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {canRetry ? (
                      <Button
                        size="sm"
                        disabled={createAttr.isPending}
                        onClick={() => createAttr.mutate(rule)}
                      >
                        {createAttr.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : rule.migration_status === "error" ? "Tentar novamente" : "Criar no WooCommerce"}
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-green-600">✓ Criado</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resetStatus.mutate(rule.id)}
                          title="Resetar para recriar"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
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
  const pauseMigration = usePauseMigration();
  const deleteWooCat = useDeleteWooCategory();
  const resetStatus = useResetRuleStatus();
  const rollback = useRollbackMigration();
  const attrRules = rules.filter(r => r.action === "convert_to_attribute");
  const [runningAll, setRunningAll] = useState(false);
  const [migrationResults, setMigrationResults] = useState<Record<string, MigrationResult>>({});
  const [showResultsFor, setShowResultsFor] = useState<string | null>(null);

  const handleMigrate = async (rule: ArchitectRule) => {
    try {
      const result = await migrate.mutateAsync(rule);
      setMigrationResults(prev => ({ ...prev, [rule.id]: result }));
      // Auto-open results dialog
      setShowResultsFor(rule.id);
    } catch { /* error already toasted */ }
  };

  const runAll = async () => {
    setRunningAll(true);
    for (const rule of attrRules.filter(r => ["pending", "attribute_created", "error"].includes(r.migration_status))) {
      try {
        const result = await migrate.mutateAsync(rule);
        setMigrationResults(prev => ({ ...prev, [rule.id]: result }));
      } catch { /* individual error already toasted */ }
    }
    setRunningAll(false);
  };

  const activeResult = showResultsFor ? migrationResults[showResultsFor] : null;
  const activeRule = showResultsFor ? attrRules.find(r => r.id === showResultsFor) : null;

  if (attrRules.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma regra de conversão para atributo. Adicione no separador "Mapeamento".
        </CardContent>
      </Card>
    );
  }

  // Summary stats
  const migrated = attrRules.filter(r => r.migration_status === "migrated");
  const withErrors = attrRules.filter(r => r.migration_status === "error");
  const pending = attrRules.filter(r => ["pending", "attribute_created"].includes(r.migration_status));
  const migrating = attrRules.filter(r => r.migration_status === "migrating");
  // Deduplicate: count unique products across rules that share the same source_category_id
  const uniqueProductCount = (() => {
    const seenSourceIds = new Set<string>();
    let count = 0;
    for (const r of migrated) {
      const key = r.source_category_id || r.id;
      if (!seenSourceIds.has(key)) {
        seenSourceIds.add(key);
        count += r.migration_total || 0;
      }
    }
    return count;
  })();
  const totalProducts = uniqueProductCount;
  const totalErrors = attrRules.reduce((sum, r) => {
    if (r.error_message?.match(/(\d+) erros/)) return sum + parseInt(RegExp.$1);
    return sum;
  }, 0);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{migrated.length}</p>
            <p className="text-xs text-muted-foreground">Regras migradas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{totalProducts}</p>
            <p className="text-xs text-muted-foreground">Produtos únicos migrados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{pending.length + migrating.length}</p>
            <p className="text-xs text-muted-foreground">Pendentes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-destructive">{withErrors.length}</p>
            <p className="text-xs text-muted-foreground">Com erros</p>
          </CardContent>
        </Card>
      </div>

      {/* Overall progress */}
      {attrRules.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Progresso geral</span>
              <span className="text-sm text-muted-foreground">{migrated.length} / {attrRules.length} regras</span>
            </div>
            <Progress value={attrRules.length > 0 ? (migrated.length / attrRules.length) * 100 : 0} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Rules Table */}
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
                <TableHead>Valor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead className="w-48">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attrRules.map(rule => (
                <TableRow key={rule.id} className={rule.migration_status === "error" ? "bg-destructive/5" : rule.migration_status === "migrated" ? "bg-primary/5" : ""}>
                  <TableCell className="font-medium">{rule.source_category_name}</TableCell>
                  <TableCell className="font-mono text-sm">{rule.attribute_slug}</TableCell>
                  <TableCell className="text-sm">{rule.attribute_values?.join(", ") || "—"}</TableCell>
                  <TableCell><StatusBadge status={rule.migration_status} /></TableCell>
                  <TableCell>
                    {rule.migration_status === "migrating" ? (
                      <div className="space-y-1 min-w-[120px]">
                        <Progress value={rule.migration_total > 0 ? (rule.migration_progress / rule.migration_total) * 100 : 0} className="h-2" />
                        <span className="text-xs text-muted-foreground">{rule.migration_progress} / {rule.migration_total}</span>
                      </div>
                    ) : rule.migration_status === "migrated" ? (
                      <div className="flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5 text-primary" />
                        <span className="text-sm font-medium text-primary">{rule.migration_total} produtos</span>
                        {rule.error_message && (
                          <Badge variant="outline" className="text-amber-600 ml-1 text-xs">{rule.error_message}</Badge>
                        )}
                      </div>
                    ) : rule.migration_status === "error" ? (
                      <div className="flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5 text-destructive" />
                        <span className="text-xs text-destructive max-w-[200px] truncate" title={rule.error_message || ""}>{rule.error_message}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {["pending", "attribute_created"].includes(rule.migration_status) && (
                        <Button size="sm" onClick={() => handleMigrate(rule)} disabled={migrate.isPending}>
                          {migrate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Play className="w-3 h-3 mr-1" />Executar</>}
                        </Button>
                      )}
                      {rule.migration_status === "error" && (
                        <Button size="sm" variant="outline" onClick={() => handleMigrate(rule)} disabled={migrate.isPending}>
                          <RotateCcw className="w-3 h-3 mr-1" />Repetir
                        </Button>
                      )}
                      {(rule.migration_status === "migrated" || migrationResults[rule.id]) && (
                        <Button size="sm" variant="outline" onClick={() => setShowResultsFor(rule.id)}>
                          <List className="w-3 h-3 mr-1" />Ver produtos
                        </Button>
                      )}
                      {rule.migration_status === "migrated" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="text-amber-600 border-amber-300 hover:bg-amber-50">
                              <RotateCcw className="w-3 h-3 mr-1" />Rollback
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reverter migração?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Isto vai restaurar as categorias e atributos originais de {rule.migration_total} produtos no WooCommerce,
                                voltando ao estado anterior à migração de "{rule.source_category_name}".
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => rollback.mutate(rule)}>
                                {rollback.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sim, reverter"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
                                Os {rule.migration_total} produtos já foram migrados para o atributo "{rule.attribute_slug}".
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
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Migration Results Dialog */}
      <Dialog open={!!showResultsFor} onOpenChange={(open) => !open && setShowResultsFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Produtos Migrados — {activeRule?.source_category_name} → {activeRule?.attribute_slug}
            </DialogTitle>
          </DialogHeader>
          {activeResult ? (
            <div className="space-y-4">
              <div className="flex gap-4 text-sm">
                <Badge variant="default" className="bg-primary text-primary-foreground">{activeResult.updated} atualizados</Badge>
                {activeResult.errors > 0 && <Badge variant="destructive">{activeResult.errors} erros</Badge>}
                <Badge variant="outline">{activeResult.total} total</Badge>
              </div>

              <ScrollArea className="max-h-[400px]">
                {activeResult.migratedProducts.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-foreground mb-2">✅ Produtos atualizados ({activeResult.migratedProducts.length})</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[80px]">WC ID</TableHead>
                          <TableHead>Nome</TableHead>
                          <TableHead className="w-[100px]">SKU</TableHead>
                          <TableHead className="w-[100px]">Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeResult.migratedProducts.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs">{p.id}</TableCell>
                            <TableCell className="text-sm">{p.name}</TableCell>
                            <TableCell className="font-mono text-xs">{p.sku || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {p.status === "already_had" ? "Já tinha" : "Adicionado"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {activeResult.failedProducts.length > 0 && (
                  <div className="space-y-1 mt-4">
                    <h4 className="text-sm font-semibold text-destructive mb-2">❌ Produtos com erro ({activeResult.failedProducts.length})</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[80px]">WC ID</TableHead>
                          <TableHead>Nome</TableHead>
                          <TableHead>Erro</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeResult.failedProducts.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs">{p.id}</TableCell>
                            <TableCell className="text-sm">{p.name}</TableCell>
                            <TableCell className="text-xs text-destructive max-w-[200px] truncate" title={p.error}>{p.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </ScrollArea>

              <p className="text-xs text-muted-foreground">
                💡 Os atributos foram criados com <strong>visible: true</strong> — aparecem automaticamente como filtros no WooCommerce se o tema suportar filtragem por atributos (ex: widgets de filtro de produto).
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">Execute a migração para ver os resultados aqui.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════
export default function CategoryArchitectPage() {
  const { data: categories = [], isLoading } = useCategories();
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateLoading, setDuplicateLoading] = useState(false);

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
          <MapeamentoTab
            categories={flatCats}
            allCategories={categories}
            duplicateGroups={duplicateGroups}
            setDuplicateGroups={setDuplicateGroups}
            duplicateLoading={duplicateLoading}
            setDuplicateLoading={setDuplicateLoading}
          />
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
