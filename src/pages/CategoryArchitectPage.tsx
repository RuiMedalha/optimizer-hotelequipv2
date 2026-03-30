import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2, Wand2, Play, CheckCircle, XCircle, Clock } from "lucide-react";
import { useCategories } from "@/hooks/useCategories";
import {
  useArchitectRules,
  useSaveRule,
  useDeleteRule,
  useCreateWooAttribute,
  useMigrateProducts,
  useDeleteWooCategory,
  type ArchitectRule,
} from "@/hooks/useCategoryArchitect";

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

// ═══════════════════════════════════════════════════════════════════════
// TAB 1 — MAPEAMENTO
// ═══════════════════════════════════════════════════════════════════════
function MapeamentoTab({ categories }: { categories: { id: string; name: string }[] }) {
  const { data: savedRules = [] } = useArchitectRules();
  const saveRule = useSaveRule();
  const deleteRule = useDeleteRule();
  const [drafts, setDrafts] = useState<DraftRule[]>([]);

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
                    <span className="text-sm text-green-600">{rule.migration_total} produtos</span>
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
          <MapeamentoTab categories={flatCats} />
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
