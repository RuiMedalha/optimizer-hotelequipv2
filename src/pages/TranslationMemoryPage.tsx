import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Book, Globe, Plus, Trash2, Loader2, Languages, BarChart3 } from "lucide-react";
import { useTranslationMemories, useTerminologyDictionaries, useLocaleStyleGuides, useTranslationJobs, useAddTerminology, useDeleteTerminology, useUpsertStyleGuide, SUPPORTED_LOCALES } from "@/hooks/useTranslations";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export default function TranslationMemoryPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const { data: memories, isLoading: memLoading } = useTranslationMemories();
  const { data: terms, isLoading: termLoading } = useTerminologyDictionaries();
  const { data: styleGuides, isLoading: sgLoading } = useLocaleStyleGuides();
  const { data: jobs } = useTranslationJobs();
  const addTerm = useAddTerminology();
  const deleteTerm = useDeleteTerminology();
  const upsertGuide = useUpsertStyleGuide();

  const [showAddTerm, setShowAddTerm] = useState(false);
  const [newTerm, setNewTerm] = useState({ source_locale: "pt-PT", target_locale: "en-GB", source_term: "", target_term: "", is_mandatory: false, notes: "" });
  const [showGuideEditor, setShowGuideEditor] = useState(false);
  const [editGuide, setEditGuide] = useState<any>({ locale: "en-GB", tone: "", forbidden_terms: [], preferred_patterns: [], cta_patterns: [] });
  const [filterLocale, setFilterLocale] = useState("all");

  const handleAddTerm = () => {
    if (!activeWorkspace || !newTerm.source_term.trim() || !newTerm.target_term.trim()) return;
    addTerm.mutate({ ...newTerm, workspace_id: activeWorkspace.id });
    setShowAddTerm(false);
    setNewTerm({ source_locale: "pt-PT", target_locale: "en-GB", source_term: "", target_term: "", is_mandatory: false, notes: "" });
  };

  const handleSaveGuide = () => {
    if (!activeWorkspace) return;
    upsertGuide.mutate({
      ...editGuide,
      workspace_id: activeWorkspace.id,
      forbidden_terms: typeof editGuide.forbidden_terms === "string" ? editGuide.forbidden_terms.split(",").map((s: string) => s.trim()).filter(Boolean) : editGuide.forbidden_terms,
      preferred_patterns: typeof editGuide.preferred_patterns === "string" ? editGuide.preferred_patterns.split(",").map((s: string) => s.trim()).filter(Boolean) : editGuide.preferred_patterns,
      cta_patterns: typeof editGuide.cta_patterns === "string" ? editGuide.cta_patterns.split(",").map((s: string) => s.trim()).filter(Boolean) : editGuide.cta_patterns,
    });
    setShowGuideEditor(false);
  };

  const filteredMemories = filterLocale === "all" ? memories : memories?.filter((m: any) => m.target_locale === filterLocale);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Languages className="w-6 h-6" /> Tradução & Localização</h1>
          <p className="text-sm text-muted-foreground mt-1">Memória de tradução, terminologia e style guides</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{memories?.length ?? 0}</div><p className="text-xs text-muted-foreground">Memórias</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{terms?.length ?? 0}</div><p className="text-xs text-muted-foreground">Termos</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{styleGuides?.length ?? 0}</div><p className="text-xs text-muted-foreground">Style Guides</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{jobs?.length ?? 0}</div><p className="text-xs text-muted-foreground">Jobs</p></CardContent></Card>
      </div>

      <Tabs defaultValue="memories">
        <TabsList>
          <TabsTrigger value="memories"><Brain className="w-4 h-4 mr-1" /> Memória</TabsTrigger>
          <TabsTrigger value="terminology"><Book className="w-4 h-4 mr-1" /> Terminologia</TabsTrigger>
          <TabsTrigger value="guides"><Globe className="w-4 h-4 mr-1" /> Style Guides</TabsTrigger>
          <TabsTrigger value="jobs"><BarChart3 className="w-4 h-4 mr-1" /> Jobs</TabsTrigger>
        </TabsList>

        {/* MEMORIES TAB */}
        <TabsContent value="memories" className="space-y-4">
          <div className="flex items-center gap-3">
            <Select value={filterLocale} onValueChange={setFilterLocale}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Filtrar locale" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os locales</SelectItem>
                {SUPPORTED_LOCALES.map(l => <SelectItem key={l.code} value={l.code}>{l.flag} {l.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              {memLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Texto Original</TableHead>
                      <TableHead>Tradução</TableHead>
                      <TableHead>Campo</TableHead>
                      <TableHead>Confiança</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(filteredMemories || []).slice(0, 100).map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell><Badge variant="outline">{m.source_locale}</Badge></TableCell>
                        <TableCell><Badge variant="outline">{m.target_locale}</Badge></TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{m.source_text}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{m.translated_text}</TableCell>
                        <TableCell><Badge variant="secondary">{m.field_type || "—"}</Badge></TableCell>
                        <TableCell><Badge className={m.confidence_score >= 85 ? "bg-green-500/10 text-green-600" : "bg-yellow-500/10 text-yellow-600"}>{m.confidence_score}%</Badge></TableCell>
                      </TableRow>
                    ))}
                    {(!filteredMemories || filteredMemories.length === 0) && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sem memórias de tradução</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TERMINOLOGY TAB */}
        <TabsContent value="terminology" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowAddTerm(true)} size="sm"><Plus className="w-4 h-4 mr-1" /> Adicionar Termo</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {termLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Termo Original</TableHead>
                      <TableHead>Tradução</TableHead>
                      <TableHead>Obrigatório</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(terms || []).map((t: any) => (
                      <TableRow key={t.id}>
                        <TableCell><Badge variant="outline">{t.source_locale}</Badge></TableCell>
                        <TableCell><Badge variant="outline">{t.target_locale}</Badge></TableCell>
                        <TableCell className="font-medium">{t.source_term}</TableCell>
                        <TableCell>{t.target_term}</TableCell>
                        <TableCell>{t.is_mandatory ? <Badge className="bg-red-500/10 text-red-600">Sim</Badge> : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{t.notes || "—"}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => deleteTerm.mutate(t.id)}><Trash2 className="w-4 h-4" /></Button></TableCell>
                      </TableRow>
                    ))}
                    {(!terms || terms.length === 0) && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sem termos no dicionário</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* STYLE GUIDES TAB */}
        <TabsContent value="guides" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditGuide({ locale: "en-GB", tone: "", forbidden_terms: "", preferred_patterns: "", cta_patterns: "" }); setShowGuideEditor(true); }} size="sm"><Plus className="w-4 h-4 mr-1" /> Novo Style Guide</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(styleGuides || []).map((sg: any) => {
              const loc = SUPPORTED_LOCALES.find(l => l.code === sg.locale);
              return (
                <Card key={sg.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setEditGuide({ ...sg, forbidden_terms: (sg.forbidden_terms || []).join(", "), preferred_patterns: (sg.preferred_patterns || []).join(", "), cta_patterns: (sg.cta_patterns || []).join(", ") }); setShowGuideEditor(true); }}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">{loc?.flag || "🌐"} {sg.locale}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Tom:</span> {sg.tone || "—"}</p>
                    <p><span className="text-muted-foreground">Termos proibidos:</span> {(sg.forbidden_terms || []).length}</p>
                    <p><span className="text-muted-foreground">Padrões preferidos:</span> {(sg.preferred_patterns || []).length}</p>
                  </CardContent>
                </Card>
              );
            })}
            {(!styleGuides || styleGuides.length === 0) && (
              <p className="text-sm text-muted-foreground col-span-2 text-center py-8">Nenhum style guide configurado</p>
            )}
          </div>
        </TabsContent>

        {/* JOBS TAB */}
        <TabsContent value="jobs" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Produtos</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Processados</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(jobs || []).map((j: any) => (
                    <TableRow key={j.id}>
                      <TableCell className="text-sm">{new Date(j.created_at).toLocaleDateString("pt-PT")}</TableCell>
                      <TableCell><Badge variant="outline">{j.source_locale}</Badge></TableCell>
                      <TableCell>{(j.target_locales || []).map((l: string) => <Badge key={l} variant="outline" className="mr-1">{l}</Badge>)}</TableCell>
                      <TableCell>{(j.product_ids || []).length}</TableCell>
                      <TableCell><Badge className={j.status === "completed" ? "bg-green-500/10 text-green-600" : "bg-yellow-500/10 text-yellow-600"}>{j.status}</Badge></TableCell>
                      <TableCell>{j.processed_products} / {(j.product_ids || []).length}</TableCell>
                    </TableRow>
                  ))}
                  {(!jobs || jobs.length === 0) && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sem jobs de tradução</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Term Dialog */}
      <Dialog open={showAddTerm} onOpenChange={setShowAddTerm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar Termo ao Dicionário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Locale Origem</Label><Select value={newTerm.source_locale} onValueChange={v => setNewTerm(p => ({ ...p, source_locale: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LOCALES.map(l => <SelectItem key={l.code} value={l.code}>{l.flag} {l.code}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-xs">Locale Destino</Label><Select value={newTerm.target_locale} onValueChange={v => setNewTerm(p => ({ ...p, target_locale: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LOCALES.map(l => <SelectItem key={l.code} value={l.code}>{l.flag} {l.code}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label className="text-xs">Termo Original</Label><Input value={newTerm.source_term} onChange={e => setNewTerm(p => ({ ...p, source_term: e.target.value }))} /></div>
            <div><Label className="text-xs">Tradução</Label><Input value={newTerm.target_term} onChange={e => setNewTerm(p => ({ ...p, target_term: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={newTerm.is_mandatory} onCheckedChange={v => setNewTerm(p => ({ ...p, is_mandatory: v }))} /><Label className="text-xs">Obrigatório (substituição forçada)</Label></div>
            <div><Label className="text-xs">Notas</Label><Input value={newTerm.notes} onChange={e => setNewTerm(p => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTerm(false)}>Cancelar</Button>
            <Button onClick={handleAddTerm} disabled={!newTerm.source_term.trim() || !newTerm.target_term.trim()}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Style Guide Editor */}
      <Dialog open={showGuideEditor} onOpenChange={setShowGuideEditor}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Style Guide — {editGuide.locale}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Locale</Label><Select value={editGuide.locale} onValueChange={v => setEditGuide((p: any) => ({ ...p, locale: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LOCALES.map(l => <SelectItem key={l.code} value={l.code}>{l.flag} {l.code}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-xs">Tom</Label><Input value={editGuide.tone || ""} onChange={e => setEditGuide((p: any) => ({ ...p, tone: e.target.value }))} placeholder="Ex: professional, commercial, technical" /></div>
            <div><Label className="text-xs">Termos Proibidos (vírgula)</Label><Textarea value={editGuide.forbidden_terms || ""} onChange={e => setEditGuide((p: any) => ({ ...p, forbidden_terms: e.target.value }))} rows={2} /></div>
            <div><Label className="text-xs">Padrões Preferidos (vírgula)</Label><Textarea value={editGuide.preferred_patterns || ""} onChange={e => setEditGuide((p: any) => ({ ...p, preferred_patterns: e.target.value }))} rows={2} /></div>
            <div><Label className="text-xs">Padrões CTA (vírgula)</Label><Textarea value={editGuide.cta_patterns || ""} onChange={e => setEditGuide((p: any) => ({ ...p, cta_patterns: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGuideEditor(false)}>Cancelar</Button>
            <Button onClick={handleSaveGuide}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
