import { useState } from "react";
import { useCanonicalProducts, useCanonicalDetail } from "@/hooks/useCanonicalProducts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Layers, ArrowLeft, Clock, Link2, FileText, Image, GitBranch, Shield } from "lucide-react";
import { toast } from "sonner";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  assembled: "default",
  queued: "secondary",
  assembling: "outline",
  partially_assembled: "outline",
  error: "destructive",
};

function CanonicalDetail({ product, onBack }: { product: any; onBack: () => void }) {
  const { fields, sources, candidates, relationships, assets, logs } = useCanonicalDetail(product.id);

  // Completeness score
  const minFields = ["title", "sku", "category", "original_price"];
  const resolvedFields = fields.data?.map((f: any) => f.field_name) || [];
  const completeness = Math.round((minFields.filter(f => resolvedFields.includes(f)).length / minFields.length) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
        <h2 className="text-xl font-bold">{product.canonical_key || "Sem chave"}</h2>
        <Badge variant={STATUS_VARIANT[product.assembly_status] || "secondary"}>{product.assembly_status}</Badge>
        <Badge variant="outline">{product.product_identity_status}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{((product.assembly_confidence_score || 0) * 100).toFixed(0)}%</p><p className="text-xs text-muted-foreground">Confiança</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{completeness}%</p><p className="text-xs text-muted-foreground">Completude</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{fields.data?.length || 0}</p><p className="text-xs text-muted-foreground">Campos</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{sources.data?.length || 0}</p><p className="text-xs text-muted-foreground">Fontes</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{relationships.data?.length || 0}</p><p className="text-xs text-muted-foreground">Relações</p></CardContent></Card>
      </div>

      <Tabs defaultValue="fields">
        <TabsList className="flex-wrap">
          <TabsTrigger value="fields"><FileText className="h-3 w-3 mr-1" />Campos</TabsTrigger>
          <TabsTrigger value="sources"><Link2 className="h-3 w-3 mr-1" />Fontes</TabsTrigger>
          <TabsTrigger value="candidates"><Layers className="h-3 w-3 mr-1" />Candidatos</TabsTrigger>
          <TabsTrigger value="relationships"><GitBranch className="h-3 w-3 mr-1" />Relações</TabsTrigger>
          <TabsTrigger value="assets"><Image className="h-3 w-3 mr-1" />Assets</TabsTrigger>
          <TabsTrigger value="logs"><Clock className="h-3 w-3 mr-1" />Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="fields">
          <Card><CardHeader><CardTitle className="text-sm">Field Resolution</CardTitle></CardHeader><CardContent>
            {fields.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Campo</TableHead><TableHead>Valor</TableHead><TableHead>Tipo</TableHead><TableHead>Fonte</TableHead><TableHead>Confiança</TableHead><TableHead>Razão</TableHead><TableHead>Validação</TableHead></TableRow></TableHeader>
                <TableBody>{fields.data.map((f: any) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.field_name}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs">{JSON.stringify(f.normalized_value?.v ?? f.field_value?.v ?? f.field_value)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{f.field_type}</Badge></TableCell>
                    <TableCell className="text-xs">{f.selected_source_type || "—"}</TableCell>
                    <TableCell>{((f.confidence_score || 0) * 100).toFixed(0)}%</TableCell>
                    <TableCell><Badge variant="secondary" className="text-xs">{f.selection_reason}</Badge></TableCell>
                    <TableCell><Badge variant={f.validation_status === "valid" ? "default" : "outline"} className="text-xs">{f.validation_status}</Badge></TableCell>
                  </TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem campos resolvidos.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="sources">
          <Card><CardHeader><CardTitle className="text-sm">Fontes do Produto</CardTitle></CardHeader><CardContent>
            {sources.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Prioridade</TableHead><TableHead>Confiança</TableHead><TableHead>Primária</TableHead></TableRow></TableHeader>
                <TableBody>{sources.data.map((s: any) => (
                  <TableRow key={s.id}><TableCell>{s.source_name || "—"}</TableCell><TableCell><Badge variant="outline">{s.source_type}</Badge></TableCell><TableCell>{s.source_priority}</TableCell><TableCell>{((s.source_confidence || 0) * 100).toFixed(0)}%</TableCell><TableCell>{s.is_primary ? <Shield className="h-4 w-4 text-primary" /> : "—"}</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem fontes.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="candidates">
          <Card><CardHeader><CardTitle className="text-sm">Candidatos</CardTitle></CardHeader><CardContent>
            {candidates.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Grupo</TableHead><TableHead>Tipo</TableHead><TableHead>Confiança</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{candidates.data.map((c: any) => (
                  <TableRow key={c.id}><TableCell className="text-xs">{c.candidate_group_key || "—"}</TableCell><TableCell><Badge variant="outline">{c.source_type}</Badge></TableCell><TableCell>{((c.match_confidence || 0) * 100).toFixed(0)}%</TableCell><TableCell>{c.match_status}</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem candidatos.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="relationships">
          <Card><CardHeader><CardTitle className="text-sm">Relações</CardTitle></CardHeader><CardContent>
            {relationships.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Produto Relacionado</TableHead><TableHead>Razão</TableHead><TableHead>Confiança</TableHead></TableRow></TableHeader>
                <TableBody>{relationships.data.map((r: any) => (
                  <TableRow key={r.id}><TableCell><Badge variant="outline">{r.relationship_type}</Badge></TableCell><TableCell className="text-xs font-mono">{r.related_canonical_product_id?.slice(0, 8)}...</TableCell><TableCell>{r.relationship_reason || "—"}</TableCell><TableCell>{((r.confidence_score || 0) * 100).toFixed(0)}%</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem relações.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="assets">
          <Card><CardHeader><CardTitle className="text-sm">Assets</CardTitle></CardHeader><CardContent>
            {assets.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Contexto</TableHead><TableHead>Ordem</TableHead><TableHead>Primária</TableHead><TableHead>Fonte</TableHead><TableHead>Confiança</TableHead></TableRow></TableHeader>
                <TableBody>{assets.data.map((a: any) => (
                  <TableRow key={a.id}><TableCell>{a.usage_context}</TableCell><TableCell>{a.sort_order}</TableCell><TableCell>{a.is_primary ? "✓" : "—"}</TableCell><TableCell>{a.source_type}</TableCell><TableCell>{((a.confidence_score || 0) * 100).toFixed(0)}%</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem assets.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card><CardHeader><CardTitle className="text-sm">Assembly Timeline</CardTitle></CardHeader><CardContent>
            {logs.data?.length ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {logs.data.map((l: any) => (
                  <div key={l.id} className="flex items-start gap-3 p-2 rounded border">
                    <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{l.assembly_step}</span>
                        <Badge variant={l.status === "completed" ? "default" : "secondary"} className="text-xs">{l.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-PT")}</p>
                      {l.confidence_after != null && <p className="text-xs">Confiança: {((l.confidence_after || 0) * 100).toFixed(0)}%</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Sem logs.</p>}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function CanonicalAssemblyPage() {
  const { canonicalProducts, createCanonical } = useCanonicalProducts();
  const [selected, setSelected] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState("");

  const handleCreate = () => {
    if (!newKey.trim()) return toast.error("Canonical key obrigatório");
    createCanonical.mutate({ canonical_key: newKey }, { onSuccess: () => { setShowCreate(false); setNewKey(""); } });
  };

  if (selected) {
    return <div className="p-6"><CanonicalDetail product={selected} onBack={() => setSelected(null)} /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="h-6 w-6" />Canonical Assembly</h1>
          <p className="text-sm text-muted-foreground">Motor de montagem de produto canónico multi-fonte</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Novo Canónico</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Produto Canónico</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Canonical Key *</Label><Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Ex: SKU-001 ou família-modelo" /></div>
              <Button onClick={handleCreate} disabled={createCanonical.isPending} className="w-full">{createCanonical.isPending ? "A criar..." : "Criar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {canonicalProducts.data?.length ? (
          <Table>
            <TableHeader><TableRow><TableHead>Chave</TableHead><TableHead>Identidade</TableHead><TableHead>Montagem</TableHead><TableHead>Qualidade</TableHead><TableHead>Review</TableHead><TableHead>Confiança</TableHead><TableHead>Tipo</TableHead><TableHead>Atualizado</TableHead></TableRow></TableHeader>
            <TableBody>
              {canonicalProducts.data.map((cp: any) => (
                <TableRow key={cp.id} className="cursor-pointer" onClick={() => setSelected(cp)}>
                  <TableCell className="font-medium">{cp.canonical_key || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{cp.product_identity_status}</Badge></TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[cp.assembly_status] || "secondary"} className="text-xs">{cp.assembly_status}</Badge></TableCell>
                  <TableCell><Badge variant={cp.quality_status === "valid" ? "default" : "outline"} className="text-xs">{cp.quality_status}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{cp.review_status}</Badge></TableCell>
                  <TableCell>{((cp.assembly_confidence_score || 0) * 100).toFixed(0)}%</TableCell>
                  <TableCell>{cp.product_type || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(cp.updated_at).toLocaleDateString("pt-PT")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum produto canónico. Crie o primeiro ou aguarde ingestão automática.</p>
        )}
      </div>
    </div>
  );
}
