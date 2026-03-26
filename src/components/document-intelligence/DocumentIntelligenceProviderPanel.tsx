import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Trash2, TestTube, CheckCircle, XCircle, Settings2 } from "lucide-react";
import {
  useDocumentAIProviders,
  useSaveDocumentAIProvider,
  useDeleteDocumentAIProvider,
  useTestDocumentProvider,
  PROVIDER_TYPES,
  type DocumentAIProvider,
} from "@/hooks/useDocumentIntelligence";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export function DocumentIntelligenceProviderPanel() {
  const { activeWorkspace } = useWorkspaceContext();
  const { data: providers, isLoading } = useDocumentAIProviders();
  const saveProvider = useSaveDocumentAIProvider();
  const deleteProvider = useDeleteDocumentAIProvider();
  const testProvider = useTestDocumentProvider();
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newProvider, setNewProvider] = useState({
    provider_name: "",
    provider_type: "lovable_gateway",
    default_model: "google/gemini-2.5-flash",
    priority_order: 10,
    is_active: true,
    supports_vision: true,
    supports_tables: true,
    supports_json_schema: false,
    max_pages: 50,
    timeout_seconds: 120,
    estimated_cost_per_page: 0,
    config: {} as Record<string, any>,
  });

  const handleTest = async (providerId: string) => {
    try {
      const result = await testProvider.mutateAsync({
        providerId,
        workspaceId: activeWorkspace!.id,
      });
      setTestResults(prev => ({ ...prev, [providerId]: result }));
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [providerId]: { status: "failed", error: e.message } }));
    }
  };

  const handleAdd = () => {
    if (!newProvider.provider_name) return;
    saveProvider.mutate(newProvider as any);
    setShowAdd(false);
    setNewProvider(prev => ({ ...prev, provider_name: "", config: {} }));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" /> Document Intelligence Providers
            </CardTitle>
            <CardDescription>Configurar providers de extração documental com fallback chain</CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar Provider
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add form */}
        {showAdd && (
          <Card className="border-primary/30">
            <CardContent className="pt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Nome</Label>
                  <Input
                    placeholder="Nome do provider"
                    value={newProvider.provider_name}
                    onChange={e => setNewProvider(p => ({ ...p, provider_name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select
                    value={newProvider.provider_type}
                    onValueChange={v => setNewProvider(p => ({ ...p, provider_type: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROVIDER_TYPES.map(pt => (
                        <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Modelo Default</Label>
                  <Input
                    placeholder="google/gemini-2.5-flash"
                    value={newProvider.default_model}
                    onChange={e => setNewProvider(p => ({ ...p, default_model: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Prioridade</Label>
                  <Input
                    type="number"
                    value={newProvider.priority_order}
                    onChange={e => setNewProvider(p => ({ ...p, priority_order: parseInt(e.target.value) || 10 }))}
                  />
                </div>
              </div>
              {(newProvider.provider_type === "gemini_direct" || newProvider.provider_type === "openai_direct") && (
                <div>
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    placeholder="API Key do provider"
                    value={newProvider.config?.api_key || ""}
                    onChange={e => setNewProvider(p => ({ ...p, config: { ...p.config, api_key: e.target.value } }))}
                  />
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={saveProvider.isPending}>
                  {saveProvider.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancelar</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Provider list */}
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (providers || []).length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground mb-2">Nenhum provider configurado</p>
            <p className="text-xs text-muted-foreground">O sistema usará o Lovable AI Gateway por defeito</p>
            <Badge variant="outline" className="mt-2">Default: Lovable AI Gateway → google/gemini-2.5-flash</Badge>
          </div>
        ) : (
          <div className="space-y-3">
            {(providers || []).map(provider => {
              const testResult = testResults[provider.id];
              return (
                <div key={provider.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={provider.is_active ? "default" : "secondary"}>
                        #{provider.priority_order}
                      </Badge>
                      <span className="font-medium text-sm text-foreground">{provider.provider_name}</span>
                      <Badge variant="outline" className="text-[10px]">{provider.provider_type}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={provider.is_active}
                        onCheckedChange={(checked) => saveProvider.mutate({ ...provider, is_active: checked })}
                      />
                      <Button size="sm" variant="outline" onClick={() => handleTest(provider.id)} disabled={testProvider.isPending}>
                        <TestTube className="h-3 w-3 mr-1" /> Testar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteProvider.mutate(provider.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Modelo: {provider.default_model || "—"}</span>
                    <span>Max: {provider.max_pages} pág</span>
                    <span>Timeout: {provider.timeout_seconds}s</span>
                    {provider.supports_vision && <Badge variant="outline" className="text-[10px] h-4">Vision</Badge>}
                    {provider.supports_tables && <Badge variant="outline" className="text-[10px] h-4">Tables</Badge>}
                  </div>
                  {testResult && (
                    <div className={`flex items-center gap-2 text-xs p-2 rounded ${testResult.status === "ok" ? "bg-primary/10" : "bg-destructive/10"}`}>
                      {testResult.status === "ok" ? (
                        <CheckCircle className="h-3 w-3 text-primary" />
                      ) : (
                        <XCircle className="h-3 w-3 text-destructive" />
                      )}
                      <span className="text-foreground">
                        {testResult.status === "ok"
                          ? `OK — ${testResult.responseTimeMs}ms — ${testResult.model}`
                          : `Falha — ${testResult.error}`}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Separator />

        {/* Default provider test */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Testar Provider Default</p>
            <p className="text-xs text-muted-foreground">Lovable AI Gateway com google/gemini-2.5-flash</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleTest("default")}
            disabled={testProvider.isPending}
          >
            {testProvider.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><TestTube className="h-4 w-4 mr-1" /> Testar</>}
          </Button>
        </div>
        {testResults["default"] && (
          <div className={`flex items-center gap-2 text-xs p-2 rounded ${testResults["default"].status === "ok" ? "bg-primary/10" : "bg-destructive/10"}`}>
            {testResults["default"].status === "ok" ? (
              <CheckCircle className="h-3 w-3 text-primary" />
            ) : (
              <XCircle className="h-3 w-3 text-destructive" />
            )}
            <span className="text-foreground">
              {testResults["default"].status === "ok"
                ? `OK — ${testResults["default"].responseTimeMs}ms — ${testResults["default"].model}`
                : `Falha — ${testResults["default"].error}`}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
