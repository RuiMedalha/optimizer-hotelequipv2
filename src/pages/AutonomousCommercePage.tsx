import { useState } from "react";
import { useAutonomousCommerce } from "@/hooks/useAutonomousCommerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play, Calendar, Shield, CheckCircle, XCircle, Zap, TrendingUp, Clock } from "lucide-react";

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-primary/10 text-primary",
  scheduled: "bg-yellow-500/10 text-yellow-600",
  executing: "bg-orange-500/10 text-orange-600",
  completed: "bg-green-500/10 text-green-600",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const actionLabels: Record<string, string> = {
  create_bundle: "Criar Bundle",
  update_price: "Atualizar Preço",
  create_promotion: "Criar Promoção",
  add_cross_sell: "Cross-sell",
  add_upsell: "Upsell",
  create_product_pack: "Pack Produto",
  expand_category: "Expandir Categoria",
  optimize_listing: "Otimizar Listing",
};

const modeLabels: Record<string, string> = {
  manual: "Manual",
  semi_autonomous: "Semi-autónomo",
  fully_autonomous: "Totalmente Autónomo",
};

export default function AutonomousCommercePage() {
  const {
    actions, logs, guardrails,
    executeAction, scheduleActions, approveAction, cancelAction,
    addGuardrail, toggleGuardrail,
  } = useAutonomousCommerce();

  const [newGuardrailType, setNewGuardrailType] = useState("max_discount");
  const [newGuardrailValue, setNewGuardrailValue] = useState("");

  const completedActions = (actions.data || []).filter(a => a.status === "completed");
  const totalRevenue = completedActions.reduce((s, a) => s + (a.expected_revenue || 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Autonomous Commerce</h1>
          <p className="text-muted-foreground text-sm">Execução automática de estratégias comerciais</p>
        </div>
        <Button onClick={() => scheduleActions.mutate()} disabled={scheduleActions.isPending}>
          {scheduleActions.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calendar className="w-4 h-4 mr-2" />}
          Agendar Ações
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Zap className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold">{actions.data?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Total Ações</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><CheckCircle className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-2xl font-bold">{completedActions.length}</p>
                <p className="text-xs text-muted-foreground">Executadas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><TrendingUp className="w-5 h-5 text-blue-600" /></div>
              <div>
                <p className="text-2xl font-bold">€{totalRevenue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Revenue Gerado</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10"><Shield className="w-5 h-5 text-yellow-600" /></div>
              <div>
                <p className="text-2xl font-bold">{guardrails.data?.filter(g => g.is_active).length || 0}</p>
                <p className="text-xs text-muted-foreground">Guardrails Ativos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="actions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="actions">Ações</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="space-y-3">
          {actions.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (actions.data || []).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma ação autónoma.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {(actions.data || []).map((action) => (
                <Card key={action.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Badge variant="outline">{actionLabels[action.action_type] || action.action_type}</Badge>
                        <Badge variant="outline" className={statusColors[action.status] || ""}>{action.status}</Badge>
                        <Badge variant="secondary" className="text-xs">{modeLabels[action.execution_mode] || action.execution_mode}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm shrink-0">
                        <span className="text-muted-foreground">€{(action.expected_revenue || 0).toLocaleString()}</span>
                        <span className="text-muted-foreground">{(action.confidence || 0)}%</span>
                        {action.status === "pending" && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => approveAction.mutate(action.id)}>
                              <CheckCircle className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => cancelAction.mutate(action.id)}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                        {(action.status === "approved" || action.status === "scheduled") && (
                          <Button size="sm" onClick={() => executeAction.mutate(action.id)} disabled={executeAction.isPending}>
                            <Play className="w-3 h-3 mr-1" /> Executar
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="space-y-3">
          {(logs.data || []).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum registo de execução.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {(logs.data || []).map((log) => (
                <Card key={log.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-mono">{log.duration_ms}ms</span>
                        <span className="text-sm text-muted-foreground">
                          {new Date(log.executed_at).toLocaleString("pt-PT")}
                        </span>
                      </div>
                      <div className="text-sm">
                        {log.error_payload ? (
                          <Badge variant="destructive">Erro</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-green-500/10 text-green-600">OK</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="guardrails" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Adicionar Guardrail</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <Select value={newGuardrailType} onValueChange={setNewGuardrailType}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="max_discount">Max Desconto %</SelectItem>
                    <SelectItem value="min_margin">Min Margem %</SelectItem>
                    <SelectItem value="price_floor">Preço Mínimo €</SelectItem>
                    <SelectItem value="max_price_change">Max Alteração Preço %</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="Valor"
                  value={newGuardrailValue}
                  onChange={(e) => setNewGuardrailValue(e.target.value)}
                  className="w-32"
                />
                <Button
                  onClick={() => {
                    if (newGuardrailValue) {
                      const key = newGuardrailType.startsWith("min") ? "min_value" : "max_value";
                      addGuardrail.mutate({
                        guardrail_type: newGuardrailType,
                        rule_payload: { [key]: Number(newGuardrailValue) },
                      });
                      setNewGuardrailValue("");
                    }
                  }}
                  disabled={!newGuardrailValue || addGuardrail.isPending}
                >
                  Adicionar
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {(guardrails.data || []).map((g) => (
              <Card key={g.id}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shield className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{g.guardrail_type.replace(/_/g, " ")}</span>
                      <Badge variant="secondary">
                        {JSON.stringify(g.rule_payload)}
                      </Badge>
                    </div>
                    <Switch
                      checked={g.is_active}
                      onCheckedChange={(checked) => toggleGuardrail.mutate({ id: g.id, is_active: checked })}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
