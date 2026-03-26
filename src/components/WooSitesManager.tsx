import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Eye, EyeOff, Globe, ShieldCheck, TestTube, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWooSites, useSaveWooSites, type WooSite } from "@/hooks/useWooSites";

const MASK = "••••••••";

type TestResult =
  | { success: true; productsFound: number; latencyMs: number }
  | { success: false; status: number; error: string };

type TestState = { loading: boolean; result: TestResult | null };

interface WooSitesManagerProps {
  onSitesChange?: (sites: WooSite[], activeSiteId: string | null) => void;
}

export function WooSitesManager({ onSitesChange }: WooSitesManagerProps) {
  const { data } = useWooSites();
  const saveSites = useSaveWooSites();
  const [sites, setSites] = useState<WooSite[]>([]);
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  useEffect(() => {
    if (data) {
      setSites(data.sites.length > 0 ? data.sites : []);
      setActiveSiteId(data.activeSiteId || null);
    }
  }, [data]);

  useEffect(() => {
    onSitesChange?.(sites, activeSiteId);
  }, [sites, activeSiteId]);

  const addSite = () => {
    const newSite: WooSite = {
      id: Date.now().toString(),
      name: "",
      url: "",
      consumerKey: "",
      consumerSecret: "",
      isProduction: false,
    };
    setSites(prev => [...prev, newSite]);
    if (sites.length === 0) setActiveSiteId(newSite.id);
  };

  const removeSite = (id: string) => {
    setSites(prev => prev.filter(s => s.id !== id));
    if (activeSiteId === id) {
      const remaining = sites.filter(s => s.id !== id);
      setActiveSiteId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const updateSite = (id: string, field: keyof WooSite, value: any) => {
    setSites(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const toggleShow = (key: string) => setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSave = () => {
    saveSites.mutate({ sites, activeSiteId: activeSiteId || undefined });
  };

  const handleTest = async (siteId: string) => {
    const site = sites.find(s => s.id === siteId);
    if (!site) return;

    setTestStates(prev => ({ ...prev, [siteId]: { loading: true, result: null } }));

    try {
      const { data, error } = await supabase.functions.invoke("test-woo-connection", {
        body: { siteUrl: site.url, consumerKey: site.consumerKey, consumerSecret: site.consumerSecret },
      });
      if (error) throw error;
      setTestStates(prev => ({ ...prev, [siteId]: { loading: false, result: data as TestResult } }));
    } catch (err) {
      setTestStates(prev => ({
        ...prev,
        [siteId]: {
          loading: false,
          result: { success: false, status: 0, error: err instanceof Error ? err.message : "Erro desconhecido" },
        },
      }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          🛒 Sites WooCommerce
          <Badge variant="secondary" className="text-xs">{sites.length} site(s)</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Configure múltiplos sites WooCommerce (produção, testes, staging). O site ativo é usado por defeito na importação e publicação.
        </p>

        {sites.map((site, index) => (
          <div
            key={site.id}
            className={`border rounded-lg p-4 space-y-3 transition-colors ${
              activeSiteId === site.id ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Site {index + 1}</span>
                {site.isProduction ? (
                  <Badge variant="default" className="text-xs gap-1">
                    <ShieldCheck className="w-3 h-3" /> Produção
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs gap-1">
                    <TestTube className="w-3 h-3" /> Teste
                  </Badge>
                )}
                {activeSiteId === site.id && (
                  <Badge className="text-xs bg-green-500/10 text-green-600 border-green-500/30">Ativo</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeSiteId !== site.id && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setActiveSiteId(site.id)}>
                    Ativar
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeSite(site.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input
                  placeholder="Loja Principal"
                  className="h-8 text-sm"
                  value={site.name}
                  onChange={(e) => updateSite(site.id, "name", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">URL do Site</Label>
                <Input
                  placeholder="https://loja.pt"
                  className="h-8 text-sm"
                  value={site.url}
                  onChange={(e) => updateSite(site.id, "url", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Consumer Key</Label>
                <div className="flex gap-1">
                  <Input
                    type={showKeys[`${site.id}_key`] ? "text" : "password"}
                    placeholder={site.consumerKey === "••••••••" ? "Guardada — novo valor para alterar" : "ck_..."}
                    className="h-8 text-sm flex-1"
                    value={site.consumerKey === "••••••••" ? "" : site.consumerKey}
                    onChange={(e) => updateSite(site.id, "consumerKey", e.target.value)}
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleShow(`${site.id}_key`)}>
                    {showKeys[`${site.id}_key`] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Consumer Secret</Label>
                <div className="flex gap-1">
                  <Input
                    type={showKeys[`${site.id}_secret`] ? "text" : "password"}
                    placeholder={site.consumerSecret === "••••••••" ? "Guardada — novo valor para alterar" : "cs_..."}
                    className="h-8 text-sm flex-1"
                    value={site.consumerSecret === "••••••••" ? "" : site.consumerSecret}
                    onChange={(e) => updateSite(site.id, "consumerSecret", e.target.value)}
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleShow(`${site.id}_secret`)}>
                    {showKeys[`${site.id}_secret`] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={site.isProduction}
                onCheckedChange={(v) => updateSite(site.id, "isProduction", v)}
              />
              <Label className="text-xs text-muted-foreground">Site de produção</Label>
            </div>

            {/* Test connection */}
            {(() => {
              const ts = testStates[site.id];
              const masked = site.consumerKey === MASK || site.consumerSecret === MASK;
              const canTest = !!site.url && !!site.consumerKey && !!site.consumerSecret && !masked;
              return (
                <div className="space-y-2 pt-1 border-t border-border/50">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!canTest || ts?.loading}
                    title={masked ? "Introduza as credenciais reais (não guardadas/mascaradas) para testar" : undefined}
                    onClick={() => handleTest(site.id)}
                  >
                    {ts?.loading ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Globe className="w-3 h-3 mr-1" />
                    )}
                    Testar ligação
                  </Button>

                  {ts?.result && (
                    ts.result.success ? (
                      <div className="flex items-start gap-1.5 text-xs text-green-600 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                        <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium">Ligação válida</div>
                          <div className="text-green-500">
                            Produtos encontrados: {ts.result.productsFound} · Latência: {ts.result.latencyMs} ms
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                        <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium">Erro de ligação</div>
                          <div className="text-red-500">{(ts.result as { success: false; status: number; error: string }).error}</div>
                        </div>
                      </div>
                    )
                  )}
                </div>
              );
            })()}
          </div>
        ))}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addSite}>
            <Plus className="w-4 h-4 mr-1" /> Adicionar Site
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saveSites.isPending}>
            Guardar Sites
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
