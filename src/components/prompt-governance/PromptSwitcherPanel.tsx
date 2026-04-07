import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, Power, PowerOff, CheckCircle, ArrowRightLeft } from "lucide-react";
import type { PromptTemplate } from "@/hooks/usePromptGovernance";

const TYPE_LABELS: Record<string, string> = {
  general: "⚙️ Sistema",
  enrichment: "🔧 Enriquecimento",
  description: "📝 Descrição",
  seo: "🔍 SEO",
  categorization: "📁 Categorização",
  validation: "✅ Validação",
  translation: "🌍 Tradução",
  image: "🖼️ Imagem",
  uso_profissional: "📖 Uso Profissional",
};

interface Props {
  templates: PromptTemplate[];
  onSwitch: (params: { promptType: string; templateId: string }) => void;
  switching?: boolean;
  onSelectTemplate?: (id: string) => void;
}

export function PromptSwitcherPanel({ templates, onSwitch, switching, onSelectTemplate }: Props) {
  const [pendingSwitch, setPendingSwitch] = useState<{ type: string; id: string } | null>(null);

  // Group templates by prompt_type
  const grouped = templates.reduce<Record<string, PromptTemplate[]>>((acc, t) => {
    if (!acc[t.prompt_type]) acc[t.prompt_type] = [];
    acc[t.prompt_type].push(t);
    return acc;
  }, {});

  const sortedTypes = Object.keys(grouped).sort((a, b) => {
    const order = ["general", "description", "seo", "enrichment", "categorization", "validation", "translation", "image", "uso_profissional"];
    return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
  });

  const handleSwitch = (promptType: string, templateId: string) => {
    setPendingSwitch({ type: promptType, id: templateId });
    onSwitch({ promptType, templateId });
  };

  return (
    <div className="space-y-4">
      <div className="p-3 bg-muted/50 rounded-lg">
        <p className="text-sm text-muted-foreground">
          <ArrowRightLeft className="w-4 h-4 inline mr-1" />
          <strong>Troca Rápida de Prompts</strong> — Para cada tipo de tarefa, escolha qual prompt deve estar ativo.
          Pode trocar a qualquer momento sem perder os prompts anteriores. Apenas um prompt por tipo pode estar ativo.
        </p>
      </div>

      {sortedTypes.map((type) => {
        const items = grouped[type];
        const activeOne = items.find(t => t.is_active);
        const inactiveOnes = items.filter(t => !t.is_active && !t.archived_at);

        return (
          <Card key={type}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  {TYPE_LABELS[type] || type}
                  <Badge variant="outline" className="text-xs font-normal">
                    {items.length} prompt{items.length !== 1 ? "s" : ""}
                  </Badge>
                </CardTitle>
                {activeOne && (
                  <Badge className="bg-primary/10 text-primary border-primary/20 gap-1">
                    <CheckCircle className="w-3 h-3" />
                    {activeOne.prompt_name}
                  </Badge>
                )}
                {!activeOne && (
                  <Badge variant="destructive" className="gap-1">
                    <PowerOff className="w-3 h-3" />
                    Nenhum ativo
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {items.length === 1 ? (
                <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{items[0].prompt_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{items[0].description || "Sem descrição"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {items[0].is_active ? (
                      <Badge variant="secondary" className="gap-1"><Power className="w-3 h-3" /> Ativo</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSwitch(type, items[0].id)}
                        disabled={switching}
                      >
                        {switching && pendingSwitch?.id === items[0].id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Power className="w-3 h-3 mr-1" />
                        )}
                        Ativar
                      </Button>
                    )}
                    {onSelectTemplate && (
                      <Button size="sm" variant="ghost" onClick={() => onSelectTemplate(items[0].id)}>
                        Ver versões
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <RadioGroup
                  value={activeOne?.id || ""}
                  onValueChange={(id) => handleSwitch(type, id)}
                  className="space-y-2"
                >
                  {items
                    .filter(t => !t.archived_at)
                    .sort((a, b) => (a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1))
                    .map((t) => (
                      <div
                        key={t.id}
                        className={`flex items-center gap-3 p-3 rounded-md border transition-colors ${
                          t.is_active
                            ? "bg-primary/5 border-primary/30"
                            : "bg-background hover:bg-muted/50"
                        }`}
                      >
                        <RadioGroupItem
                          value={t.id}
                          id={`switch-${t.id}`}
                          disabled={switching}
                        />
                        <Label htmlFor={`switch-${t.id}`} className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{t.prompt_name}</span>
                            {t.is_active && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <CheckCircle className="w-3 h-3" /> Ativo
                              </Badge>
                            )}
                            {!t.workspace_id && (
                              <Badge variant="outline" className="text-xs">Global</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t.description || "Sem descrição"}
                          </p>
                        </Label>
                        {switching && pendingSwitch?.id === t.id && (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        )}
                        {onSelectTemplate && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectTemplate(t.id);
                            }}
                          >
                            Versões
                          </Button>
                        )}
                      </div>
                    ))}
                </RadioGroup>
              )}

              {inactiveOnes.length > 0 && activeOne && items.filter(t => !t.archived_at).length > 1 && (
                <p className="text-xs text-muted-foreground mt-3">
                  💡 Troque para outro prompt a qualquer momento — o prompt anterior é mantido intacto e pode ser reativado.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {sortedTypes.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Nenhum prompt criado. Crie prompts primeiro usando o botão "Novo Template" ou "Criar Prompts Padrão".</p>
        </div>
      )}
    </div>
  );
}
