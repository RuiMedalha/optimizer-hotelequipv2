import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2, Loader2, Radio, Link2, ArrowRightLeft, BarChart3, Settings2, Shield, Rss, AlertTriangle, Lightbulb, Eye, Check } from "lucide-react";
import {
  useChannels, useCreateChannel, useDeleteChannel,
  useChannelConnections, useCreateConnection,
  useFieldMappings, useUpsertFieldMapping, useDeleteFieldMapping,
  useCategoryMappings, useUpsertCategoryMapping,
  useChannelPublishJobs,
  CHANNEL_TYPES, CANONICAL_FIELDS,
} from "@/hooks/useChannels";
import {
  useChannelRules, useCreateChannelRule, useUpdateChannelRule, useDeleteChannelRule,
  useFeedProfiles, useCreateFeedProfile, useDeleteFeedProfile,
  useChannelRejections, useResolveRejection,
  useRuleLearning, useAcceptSuggestedRule,
  useEvaluateChannelRules,
  RULE_TYPES, FEED_TYPES,
} from "@/hooks/useChannelRules";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export default function ChannelManagerPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const { data: channels, isLoading } = useChannels();
  const createChannel = useCreateChannel();
  const deleteChannel = useDeleteChannel();
  const { data: jobs } = useChannelPublishJobs();

  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannel, setNewChannel] = useState({ channel_name: "", channel_type: "woocommerce" });
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("channels");

  const handleCreateChannel = () => {
    if (!activeWorkspace || !newChannel.channel_name.trim()) return;
    createChannel.mutate({ ...newChannel, workspace_id: activeWorkspace.id, channel_type: newChannel.channel_type as any });
    setShowNewChannel(false);
    setNewChannel({ channel_name: "", channel_type: "woocommerce" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Radio className="w-6 h-6" /> Canais de Publicação</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerir canais, regras, feeds e rejeições</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{channels?.length ?? 0}</div><p className="text-xs text-muted-foreground">Canais</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{channels?.filter((c: any) => c.status === "active").length ?? 0}</div><p className="text-xs text-muted-foreground">Ativos</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{jobs?.length ?? 0}</div><p className="text-xs text-muted-foreground">Jobs</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{jobs?.filter((j: any) => j.job_status === "completed").length ?? 0}</div><p className="text-xs text-muted-foreground">Concluídos</p></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="channels"><Radio className="w-4 h-4 mr-1" /> Canais</TabsTrigger>
          <TabsTrigger value="mappings" disabled={!selectedChannelId}><ArrowRightLeft className="w-4 h-4 mr-1" /> Mappings</TabsTrigger>
          <TabsTrigger value="rules" disabled={!selectedChannelId}><Shield className="w-4 h-4 mr-1" /> Regras</TabsTrigger>
          <TabsTrigger value="feeds" disabled={!selectedChannelId}><Rss className="w-4 h-4 mr-1" /> Feeds</TabsTrigger>
          <TabsTrigger value="connections" disabled={!selectedChannelId}><Link2 className="w-4 h-4 mr-1" /> Conexões</TabsTrigger>
          <TabsTrigger value="rejections"><AlertTriangle className="w-4 h-4 mr-1" /> Rejeições</TabsTrigger>
          <TabsTrigger value="intelligence"><Lightbulb className="w-4 h-4 mr-1" /> Inteligência</TabsTrigger>
          <TabsTrigger value="jobs"><BarChart3 className="w-4 h-4 mr-1" /> Jobs</TabsTrigger>
        </TabsList>

        {/* CHANNELS */}
        <TabsContent value="channels" className="space-y-4">
          <div className="flex justify-end"><Button size="sm" onClick={() => setShowNewChannel(true)}><Plus className="w-4 h-4 mr-1" /> Novo Canal</Button></div>
          {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(channels || []).map((ch: any) => {
                const ct = CHANNEL_TYPES.find(t => t.value === ch.channel_type);
                return (
                  <Card key={ch.id} className={`cursor-pointer transition-colors ${selectedChannelId === ch.id ? "border-primary" : "hover:border-primary/50"}`}
                    onClick={() => { setSelectedChannelId(ch.id); setActiveTab("mappings"); }}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span className="flex items-center gap-2">{ct?.icon} {ch.channel_name}</span>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteChannel.mutate(ch.id); }}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{ch.channel_type}</Badge>
                        <Badge className={ch.status === "active" ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}>{ch.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Criado: {new Date(ch.created_at).toLocaleDateString("pt-PT")}</p>
                    </CardContent>
                  </Card>
                );
              })}
              {(!channels || channels.length === 0) && <p className="text-sm text-muted-foreground col-span-3 text-center py-8">Nenhum canal configurado</p>}
            </div>
          )}
        </TabsContent>

        {/* MAPPINGS */}
        <TabsContent value="mappings">
          {selectedChannelId && <ChannelMappingEditor channelId={selectedChannelId} workspaceId={activeWorkspace?.id || ""} />}
        </TabsContent>

        {/* RULES */}
        <TabsContent value="rules">
          {selectedChannelId && <ChannelRulesManager channelId={selectedChannelId} workspaceId={activeWorkspace?.id || ""} />}
        </TabsContent>

        {/* FEEDS */}
        <TabsContent value="feeds">
          {selectedChannelId && <FeedProfileManager channelId={selectedChannelId} workspaceId={activeWorkspace?.id || ""} />}
        </TabsContent>

        {/* CONNECTIONS */}
        <TabsContent value="connections">
          {selectedChannelId && <ChannelConnectionsPanel channelId={selectedChannelId} workspaceId={activeWorkspace?.id || ""} />}
        </TabsContent>

        {/* REJECTIONS */}
        <TabsContent value="rejections">
          <ChannelRejectionsPanel channelId={selectedChannelId} />
        </TabsContent>

        {/* INTELLIGENCE */}
        <TabsContent value="intelligence">
          <FeedIntelligencePanel channelId={selectedChannelId} />
        </TabsContent>

        {/* JOBS */}
        <TabsContent value="jobs" className="space-y-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Canal</TableHead><TableHead>Status</TableHead>
                <TableHead>Progresso</TableHead><TableHead>Falhas</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(jobs || []).map((j: any) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-sm">{new Date(j.created_at).toLocaleDateString("pt-PT")}</TableCell>
                    <TableCell><Badge variant="outline">{j.channels?.channel_name || "—"}</Badge></TableCell>
                    <TableCell><Badge className={j.job_status === "completed" ? "bg-green-500/10 text-green-600" : j.job_status === "failed" ? "bg-red-500/10 text-red-600" : "bg-yellow-500/10 text-yellow-600"}>{j.job_status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={j.total_products > 0 ? (j.processed_products / j.total_products) * 100 : 0} className="h-2 w-20" />
                        <span className="text-xs">{j.processed_products}/{j.total_products}</span>
                      </div>
                    </TableCell>
                    <TableCell>{j.failed_products > 0 ? <Badge variant="destructive">{j.failed_products}</Badge> : "0"}</TableCell>
                  </TableRow>
                ))}
                {(!jobs || jobs.length === 0) && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem jobs</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* New Channel Dialog */}
      <Dialog open={showNewChannel} onOpenChange={setShowNewChannel}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Canal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input value={newChannel.channel_name} onChange={e => setNewChannel(p => ({ ...p, channel_name: e.target.value }))} placeholder="Ex: WooCommerce PT" /></div>
            <div><Label className="text-xs">Tipo</Label>
              <Select value={newChannel.channel_type} onValueChange={v => setNewChannel(p => ({ ...p, channel_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CHANNEL_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.icon} {t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewChannel(false)}>Cancelar</Button>
            <Button onClick={handleCreateChannel} disabled={!newChannel.channel_name.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Channel Rules Manager ---
function ChannelRulesManager({ channelId, workspaceId }: { channelId: string; workspaceId: string }) {
  const { data: rules, isLoading } = useChannelRules(channelId);
  const createRule = useCreateChannelRule();
  const updateRule = useUpdateChannelRule();
  const deleteRule = useDeleteChannelRule();
  const [showNew, setShowNew] = useState(false);
  const [newRule, setNewRule] = useState({ rule_name: "", rule_type: "validation_rule", priority: 100, conditions: "{}", actions: "{}" });

  const handleCreate = () => {
    try {
      createRule.mutate({
        workspace_id: workspaceId, channel_id: channelId,
        rule_name: newRule.rule_name, rule_type: newRule.rule_type,
        priority: newRule.priority,
        conditions: JSON.parse(newRule.conditions), actions: JSON.parse(newRule.actions),
      });
      setShowNew(false);
      setNewRule({ rule_name: "", rule_type: "validation_rule", priority: 100, conditions: "{}", actions: "{}" });
    } catch { /* invalid JSON */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2"><Shield className="w-4 h-4" /> Regras do Canal</h3>
        <Button size="sm" onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" /> Nova Regra</Button>
      </div>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="space-y-2">
          {(rules || []).map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{r.rule_name}</p>
                    <Badge variant="outline">{RULE_TYPES.find(rt => rt.value === r.rule_type)?.label || r.rule_type}</Badge>
                    <Badge variant="secondary">P{r.priority}</Badge>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Condições: {JSON.stringify(r.conditions).substring(0, 60)}</span>
                    <span>Ações: {JSON.stringify(r.actions).substring(0, 60)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.is_active} onCheckedChange={(v) => updateRule.mutate({ id: r.id, is_active: v })} />
                  <Button variant="ghost" size="icon" onClick={() => deleteRule.mutate(r.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!rules || rules.length === 0) && <p className="text-sm text-muted-foreground text-center py-8">Sem regras configuradas</p>}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Regra</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input value={newRule.rule_name} onChange={e => setNewRule(p => ({ ...p, rule_name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Tipo</Label>
                <Select value={newRule.rule_type} onValueChange={v => setNewRule(p => ({ ...p, rule_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RULE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Prioridade</Label><Input type="number" value={newRule.priority} onChange={e => setNewRule(p => ({ ...p, priority: parseInt(e.target.value) || 100 }))} /></div>
            </div>
            <div><Label className="text-xs">Condições (JSON)</Label><Textarea value={newRule.conditions} onChange={e => setNewRule(p => ({ ...p, conditions: e.target.value }))} rows={3} className="font-mono text-xs" /></div>
            <div><Label className="text-xs">Ações (JSON)</Label><Textarea value={newRule.actions} onChange={e => setNewRule(p => ({ ...p, actions: e.target.value }))} rows={3} className="font-mono text-xs" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newRule.rule_name.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Feed Profile Manager ---
function FeedProfileManager({ channelId, workspaceId }: { channelId: string; workspaceId: string }) {
  const { data: profiles, isLoading } = useFeedProfiles(channelId);
  const createProfile = useCreateFeedProfile();
  const deleteProfile = useDeleteFeedProfile();
  const [showNew, setShowNew] = useState(false);
  const [newProfile, setNewProfile] = useState({ profile_name: "", feed_type: "marketplace", locale: "", currency: "EUR", title_template: "", description_template: "" });

  const handleCreate = () => {
    createProfile.mutate({
      workspace_id: workspaceId, channel_id: channelId,
      profile_name: newProfile.profile_name, feed_type: newProfile.feed_type,
      locale: newProfile.locale || null, currency: newProfile.currency || null,
      title_template: newProfile.title_template || null,
      description_template: newProfile.description_template || null,
    });
    setShowNew(false);
    setNewProfile({ profile_name: "", feed_type: "marketplace", locale: "", currency: "EUR", title_template: "", description_template: "" });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2"><Rss className="w-4 h-4" /> Perfis de Feed</h3>
        <Button size="sm" onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" /> Novo Perfil</Button>
      </div>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(profiles || []).map((p: any) => (
            <Card key={p.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{p.profile_name}</p>
                  <Button variant="ghost" size="icon" onClick={() => deleteProfile.mutate(p.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline">{FEED_TYPES.find(f => f.value === p.feed_type)?.label || p.feed_type}</Badge>
                  {p.locale && <Badge variant="secondary">{p.locale}</Badge>}
                  {p.currency && <Badge variant="secondary">{p.currency}</Badge>}
                  {p.is_default && <Badge className="bg-primary/10 text-primary">Default</Badge>}
                </div>
                {p.title_template && <p className="text-xs text-muted-foreground">Título: {p.title_template}</p>}
              </CardContent>
            </Card>
          ))}
          {(!profiles || profiles.length === 0) && <p className="text-sm text-muted-foreground col-span-2 text-center py-8">Sem perfis configurados</p>}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Perfil de Feed</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input value={newProfile.profile_name} onChange={e => setNewProfile(p => ({ ...p, profile_name: e.target.value }))} placeholder="Google Merchant PT" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Tipo</Label>
                <Select value={newProfile.feed_type} onValueChange={v => setNewProfile(p => ({ ...p, feed_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FEED_TYPES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Locale</Label><Input value={newProfile.locale} onChange={e => setNewProfile(p => ({ ...p, locale: e.target.value }))} placeholder="pt-PT" /></div>
              <div><Label className="text-xs">Moeda</Label><Input value={newProfile.currency} onChange={e => setNewProfile(p => ({ ...p, currency: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Template Título</Label><Input value={newProfile.title_template} onChange={e => setNewProfile(p => ({ ...p, title_template: e.target.value }))} placeholder="{title} - {sku}" /></div>
            <div><Label className="text-xs">Template Descrição</Label><Textarea value={newProfile.description_template} onChange={e => setNewProfile(p => ({ ...p, description_template: e.target.value }))} rows={2} placeholder="{description}" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newProfile.profile_name.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Rejections Panel ---
function ChannelRejectionsPanel({ channelId }: { channelId: string | null }) {
  const { data: rejections, isLoading } = useChannelRejections(channelId);
  const resolve = useResolveRejection();
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Rejeições de Canal</h3>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Produto</TableHead><TableHead>Canal</TableHead><TableHead>Tipo</TableHead>
              <TableHead>Mensagem</TableHead><TableHead>Campo</TableHead><TableHead>Estado</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(rejections || []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{(r as any).products?.sku || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{(r as any).channels?.channel_name || "—"}</Badge></TableCell>
                  <TableCell className="text-sm">{r.rejection_type || "—"}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{r.external_message || "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{r.field_impacted || "—"}</Badge></TableCell>
                  <TableCell>{r.resolved ? <Badge className="bg-green-500/10 text-green-600">Resolvido</Badge> : <Badge variant="destructive">Pendente</Badge>}</TableCell>
                  <TableCell>
                    {!r.resolved && <Button variant="ghost" size="sm" onClick={() => setResolveId(r.id)}>Resolver</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {(!rejections || rejections.length === 0) && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Sem rejeições</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      <Dialog open={!!resolveId} onOpenChange={(o) => !o && setResolveId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resolver Rejeição</DialogTitle></DialogHeader>
          <div><Label className="text-xs">Nota de resolução</Label><Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveId(null)}>Cancelar</Button>
            <Button onClick={() => { resolve.mutate({ id: resolveId!, resolution_note: note }); setResolveId(null); setNote(""); }}>Resolver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Feed Intelligence Panel ---
function FeedIntelligencePanel({ channelId }: { channelId: string | null }) {
  const { data: learnings, isLoading } = useRuleLearning(channelId);
  const { data: rejections } = useChannelRejections(channelId);
  const acceptRule = useAcceptSuggestedRule();
  const { activeWorkspace } = useWorkspaceContext();

  const unresolvedCount = rejections?.filter((r: any) => !r.resolved).length || 0;
  const pendingSuggestions = learnings?.filter((l: any) => !l.accepted_by_user) || [];

  return (
    <div className="space-y-6">
      <h3 className="font-semibold flex items-center gap-2"><Lightbulb className="w-4 h-4" /> Feed Intelligence</h3>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{unresolvedCount}</div><p className="text-xs text-muted-foreground">Rejeições Pendentes</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{pendingSuggestions.length}</div><p className="text-xs text-muted-foreground">Regras Sugeridas</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{learnings?.filter((l: any) => l.accepted_by_user).length || 0}</div><p className="text-xs text-muted-foreground">Regras Aceites</p></CardContent></Card>
      </div>

      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Padrões Detetados & Sugestões</h4>
          {pendingSuggestions.map((l: any) => (
            <Card key={l.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium text-sm">{l.pattern_detected}</p>
                  <div className="flex gap-2">
                    <Badge variant="outline">{l.source_type}</Badge>
                    <Badge variant="secondary">×{l.frequency}</Badge>
                    {l.channels?.channel_name && <Badge variant="outline">{l.channels.channel_name}</Badge>}
                  </div>
                  {l.suggested_rule?.description && <p className="text-xs text-muted-foreground">{l.suggested_rule.description}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => acceptRule.mutate({
                  learningId: l.id,
                  workspace_id: activeWorkspace?.id,
                  channel_id: l.channel_id,
                  suggested_rule: l.suggested_rule,
                })}>
                  <Check className="w-4 h-4 mr-1" /> Aceitar
                </Button>
              </CardContent>
            </Card>
          ))}
          {pendingSuggestions.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sem sugestões pendentes</p>}
        </div>
      )}
    </div>
  );
}

// --- Channel Mapping Editor ---
function ChannelMappingEditor({ channelId, workspaceId }: { channelId: string; workspaceId: string }) {
  const { data: fieldMappings, isLoading } = useFieldMappings(channelId);
  const { data: catMappings } = useCategoryMappings(channelId);
  const upsertField = useUpsertFieldMapping();
  const deleteField = useDeleteFieldMapping();
  const upsertCat = useUpsertCategoryMapping();
  const [newMapping, setNewMapping] = useState({ canonical_field: "", channel_field: "", required: false });
  const [newCat, setNewCat] = useState({ internal_category: "", channel_category: "" });

  const handleAddField = () => {
    if (!newMapping.canonical_field || !newMapping.channel_field) return;
    upsertField.mutate({ ...newMapping, workspace_id: workspaceId, channel_id: channelId });
    setNewMapping({ canonical_field: "", channel_field: "", required: false });
  };

  const handleAddCat = () => {
    if (!newCat.internal_category || !newCat.channel_category) return;
    upsertCat.mutate({ ...newCat, workspace_id: workspaceId, channel_id: channelId });
    setNewCat({ internal_category: "", channel_category: "" });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Mapeamento de Campos</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label className="text-xs">Campo Interno</Label>
              <Select value={newMapping.canonical_field} onValueChange={v => setNewMapping(p => ({ ...p, canonical_field: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>{CANONICAL_FIELDS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex-1"><Label className="text-xs">Campo Canal</Label><Input value={newMapping.channel_field} onChange={e => setNewMapping(p => ({ ...p, channel_field: e.target.value }))} placeholder="body_html" /></div>
            <div className="flex items-center gap-1 pb-1"><Switch checked={newMapping.required} onCheckedChange={v => setNewMapping(p => ({ ...p, required: v }))} /><span className="text-xs">Req</span></div>
            <Button size="sm" onClick={handleAddField}><Plus className="w-4 h-4" /></Button>
          </div>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Interno</TableHead><TableHead>Canal</TableHead><TableHead>Obrigatório</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {(fieldMappings || []).map((fm: any) => (
                  <TableRow key={fm.id}>
                    <TableCell><Badge variant="outline">{fm.canonical_field}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{fm.channel_field}</TableCell>
                    <TableCell>{fm.required ? <Badge className="bg-red-500/10 text-red-600">Sim</Badge> : "—"}</TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => deleteField.mutate(fm.id)}><Trash2 className="w-4 h-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Mapeamento de Categorias</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label className="text-xs">Categoria Interna</Label><Input value={newCat.internal_category} onChange={e => setNewCat(p => ({ ...p, internal_category: e.target.value }))} /></div>
            <div className="flex-1"><Label className="text-xs">Categoria Canal</Label><Input value={newCat.channel_category} onChange={e => setNewCat(p => ({ ...p, channel_category: e.target.value }))} /></div>
            <Button size="sm" onClick={handleAddCat}><Plus className="w-4 h-4" /></Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Interna</TableHead><TableHead>Canal</TableHead><TableHead>Confiança</TableHead></TableRow></TableHeader>
            <TableBody>
              {(catMappings || []).map((cm: any) => (
                <TableRow key={cm.id}>
                  <TableCell>{cm.internal_category}</TableCell>
                  <TableCell className="font-mono text-sm">{cm.channel_category}</TableCell>
                  <TableCell><Badge variant="outline">{cm.confidence}%</Badge></TableCell>
                </TableRow>
              ))}
              {(!catMappings || catMappings.length === 0) && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">Sem mapeamentos</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Channel Connections Panel ---
function ChannelConnectionsPanel({ channelId, workspaceId }: { channelId: string; workspaceId: string }) {
  const { data: connections, isLoading } = useChannelConnections(channelId);
  const createConn = useCreateConnection();
  const [showNew, setShowNew] = useState(false);
  const [newConn, setNewConn] = useState({ connection_name: "", credentials: "{}", settings: "{}" });

  const handleCreate = () => {
    try {
      createConn.mutate({
        workspace_id: workspaceId, channel_id: channelId,
        connection_name: newConn.connection_name,
        credentials: JSON.parse(newConn.credentials),
        settings: JSON.parse(newConn.settings),
      });
      setShowNew(false);
    } catch { /* invalid JSON */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" /> Nova Conexão</Button></div>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
        <div className="space-y-3">
          {(connections || []).map((c: any) => (
            <Card key={c.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{c.connection_name || "Sem nome"}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={c.status === "connected" ? "bg-green-500/10 text-green-600" : "bg-muted"}>{c.status}</Badge>
                    {c.last_sync_at && <span className="text-xs text-muted-foreground">Último sync: {new Date(c.last_sync_at).toLocaleDateString("pt-PT")}</span>}
                  </div>
                </div>
                <Settings2 className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
          {(!connections || connections.length === 0) && <p className="text-sm text-muted-foreground text-center py-8">Sem conexões configuradas</p>}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Conexão</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input value={newConn.connection_name} onChange={e => setNewConn(p => ({ ...p, connection_name: e.target.value }))} /></div>
            <div><Label className="text-xs">Credenciais (JSON)</Label><Textarea value={newConn.credentials} onChange={e => setNewConn(p => ({ ...p, credentials: e.target.value }))} rows={4} className="font-mono text-xs" /></div>
            <div><Label className="text-xs">Settings (JSON)</Label><Textarea value={newConn.settings} onChange={e => setNewConn(p => ({ ...p, settings: e.target.value }))} rows={3} className="font-mono text-xs" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
