import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Save, RotateCcw, Loader2, Eye, EyeOff, Plus, Monitor } from "lucide-react";
import { useSettings, useSaveSettings } from "@/hooks/useSettings";
import { ProductDescriptionPreview } from "@/components/ProductDescriptionPreview";
import { toast } from "sonner";

const SETTING_KEY = "description_template";

/** Available template variables grouped by category with colors */
const VARIABLE_GROUPS = [
  {
    label: "Produto",
    color: "hsl(220 90% 56%)",
    bgColor: "hsl(220 90% 95%)",
    variables: [
      { key: "titulo", label: "Título", description: "Título otimizado do produto" },
      { key: "titulo_original", label: "Título Original", description: "Título original antes da otimização" },
      { key: "descricao_curta", label: "Descrição Curta", description: "Resumo conciso do produto" },
      { key: "categoria", label: "Categoria", description: "Categoria do produto" },
      { key: "marca", label: "Marca", description: "Marca/linha do produto (se disponível)" },
      { key: "sku", label: "SKU", description: "Código SKU do produto" },
    ],
  },
  {
    label: "Specs Técnicas",
    color: "hsl(150 70% 40%)",
    bgColor: "hsl(150 70% 93%)",
    variables: [
      { key: "tabela_specs", label: "Tabela Specs", description: "Tabela HTML com todas as características técnicas" },
      { key: "specs_texto", label: "Specs (Texto)", description: "Specs técnicas em texto simples" },
      { key: "dimensoes", label: "Dimensões", description: "Dimensões do produto" },
      { key: "peso", label: "Peso", description: "Peso do produto" },
      { key: "potencia", label: "Potência", description: "Potência/voltagem" },
    ],
  },
  {
    label: "Comercial",
    color: "hsl(25 95% 53%)",
    bgColor: "hsl(25 95% 93%)",
    variables: [
      { key: "preco", label: "Preço", description: "Preço do produto" },
      { key: "beneficios", label: "Benefícios", description: "Lista de benefícios principais" },
      { key: "aplicacoes", label: "Aplicações", description: "Aplicações práticas (restaurante, hotel...)" },
      { key: "diferenciais", label: "Diferenciais", description: "Pontos diferenciadores do produto" },
    ],
  },
  {
    label: "SEO & FAQ",
    color: "hsl(280 70% 55%)",
    bgColor: "hsl(280 70% 93%)",
    variables: [
      { key: "faq", label: "FAQ", description: "Secção de perguntas frequentes em HTML" },
      { key: "keywords", label: "Keywords", description: "Keywords SEO principais" },
      { key: "tags", label: "Tags", description: "Tags do produto" },
    ],
  },
];

const ALL_VARIABLES = VARIABLE_GROUPS.flatMap((g) =>
  g.variables.map((v) => ({ ...v, color: g.color, bgColor: g.bgColor, group: g.label }))
);

const DEFAULT_TEMPLATE = `<div class="product-description">

<p>{{beneficios}}</p>

<p>{{aplicacoes}}</p>

{{tabela_specs}}

{{faq}}

</div>`;

// Sample data for realistic product preview
const SAMPLE_DATA: Record<string, string> = {
  titulo: "Fritadeira a Gás 8L Linha 700 — Alto Rendimento",
  titulo_original: "Fritadeira Gas 8L",
  descricao_curta: "Fritadeira profissional a gás de 8 litros com termóstato regulável, ideal para restaurantes com alto volume de serviço.",
  categoria: "Cozinha > Fritadeiras",
  marca: "Linha 700",
  sku: "FRIT-G8L-700",
  tabela_specs: `<table><tr><th>Característica</th><th>Valor</th></tr><tr><td>Capacidade</td><td>8 litros</td></tr><tr><td>Combustível</td><td>Gás Natural / GPL</td></tr><tr><td>Potência</td><td>6.9 kW</td></tr><tr><td>Dimensões (LxPxA)</td><td>400 x 730 x 290 mm</td></tr><tr><td>Peso</td><td>22 kg</td></tr><tr><td>Material</td><td>Aço Inox AISI 304</td></tr><tr><td>Certificações</td><td>CE, HACCP</td></tr></table>`,
  specs_texto: "Capacidade: 8L | Gás: 6.9 kW | Dimensões: 400x730x290mm | Peso: 22kg | Inox AISI 304",
  dimensoes: "400 x 730 x 290 mm",
  peso: "22 kg",
  potencia: "6.9 kW",
  preco: "1.245,00",
  beneficios: `<ul><li><strong>Aquecimento rápido</strong> — atinge 180°C em menos de 5 minutos, reduzindo tempo de espera</li><li><strong>Termóstato de precisão</strong> — controlo de temperatura de 100°C a 190°C para resultados consistentes</li><li><strong>Cuba em aço inox AISI 304</strong> — resistente à corrosão, fácil limpeza e longa durabilidade</li><li><strong>Zona fria inferior</strong> — recolhe resíduos e prolonga a vida útil do óleo</li><li><strong>Design modular Linha 700</strong> — integra-se com outros equipamentos da mesma série</li></ul>`,
  aplicacoes: "Equipamento dimensionado para restaurantes, hotéis e cantinas com serviço de 80 a 150 refeições/dia. Ideal para fritura de batatas, panados, peixe e snacks em estabelecimentos com cozinha profissional de alto débito.",
  diferenciais: "Zona fria patenteada que reduz o consumo de óleo em até 30%. Sistema de drenagem frontal para manutenção rápida sem desmontar a cuba.",
  faq: `<details><summary>Que tipo de gás é compatível?</summary><p>Compatível com gás natural e GPL. Kit de conversão incluído para ambos os tipos.</p></details><details><summary>Qual a frequência recomendada de troca de óleo?</summary><p>Com a zona fria, o óleo mantém-se até 40% mais tempo. Recomenda-se troca a cada 3-5 dias em utilização intensiva.</p></details><details><summary>Precisa de instalação especial?</summary><p>Requer ligação de gás por técnico certificado. Ponto de gás ½" com torneira de segurança.</p></details>`,
  keywords: "fritadeira profissional, fritadeira gás 8 litros, equipamento HORECA",
  tags: "fritadeira, gás, profissional, linha 700, HORECA",
};

function getVariableStyle(varKey: string): { color: string; bgColor: string } {
  const v = ALL_VARIABLES.find((v) => v.key === varKey);
  return v ? { color: v.color, bgColor: v.bgColor } : { color: "hsl(0 0% 50%)", bgColor: "hsl(0 0% 93%)" };
}

/** Renders template text with colored variable badges inline */
function TemplatePreview({ template }: { template: string }) {
  const parts = template.split(/({{[^}]+}})/g);

  return (
    <div className="p-4 border rounded-lg bg-muted/20 font-mono text-xs whitespace-pre-wrap leading-relaxed min-h-[120px]">
      {parts.map((part, i) => {
        const match = part.match(/^{{(.+)}}$/);
        if (match) {
          const varKey = match[1];
          const style = getVariableStyle(varKey);
          const varInfo = ALL_VARIABLES.find((v) => v.key === varKey);
          return (
            <span
              key={i}
              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold mx-0.5 cursor-help"
              style={{ backgroundColor: style.bgColor, color: style.color, border: `1px solid ${style.color}40` }}
              title={varInfo?.description || varKey}
            >
              {varInfo?.label || varKey}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

/** Replaces {{variable}} with sample data to generate realistic HTML */
function renderTemplateWithSampleData(template: string): string {
  return template.replace(/{{(\w+)}}/g, (_, key) => SAMPLE_DATA[key] || `[${key}]`);
}

export function DescriptionTemplateEditor() {
  const { data: settings, isLoading } = useSettings();
  const saveSettings = useSaveSettings();
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [showPreview, setShowPreview] = useState(true);
  const [showProductPreview, setShowProductPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (settings?.[SETTING_KEY]) {
      setTemplate(settings[SETTING_KEY]);
    }
  }, [settings]);

  const insertVariable = useCallback(
    (varKey: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        setTemplate((prev) => prev + `{{${varKey}}}`);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = `{{${varKey}}}`;
      const newVal = template.substring(0, start) + text + template.substring(end);
      setTemplate(newVal);
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + text.length;
      });
    },
    [template]
  );

  const handleSave = () => {
    saveSettings.mutate({ [SETTING_KEY]: template });
  };

  const handleReset = () => {
    setTemplate(DEFAULT_TEMPLATE);
    toast.info("Template reposto para o padrão. Guarde para aplicar.");
  };

  const isModified = template !== (settings?.[SETTING_KEY] || DEFAULT_TEMPLATE);

  if (isLoading) return null;

  const renderedHtml = renderTemplateWithSampleData(template);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">🎨 Template de Descrição</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Define a estrutura da descrição gerada pela IA. Use variáveis coloridas para montar o layout.
                <strong> Não afeta a velocidade</strong> — o template é passado diretamente à IA como instrução de formato.
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowProductPreview(true)}
                className="gap-1"
              >
                <Monitor className="w-4 h-4" /> Preview Produto
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview((p) => !p)}
                className="gap-1"
              >
                {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showPreview ? "Esconder" : "Preview"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Variable palette */}
          <div className="space-y-3">
            {VARIABLE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-medium mb-1.5" style={{ color: group.color }}>
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.variables.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => insertVariable(v.key)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all hover:scale-105 hover:shadow-sm cursor-pointer"
                      style={{
                        backgroundColor: group.bgColor,
                        color: group.color,
                        border: `1px solid ${group.color}30`,
                      }}
                      title={v.description}
                    >
                      <Plus className="w-3 h-3" />
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Editor */}
          <div className="relative">
            <Textarea
              ref={textareaRef}
              rows={12}
              className="font-mono text-xs"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="Escreva o template da descrição aqui... Use {{variavel}} para inserir dados dinâmicos."
            />
            {isModified && (
              <Badge className="absolute top-2 right-2 text-xs bg-warning text-warning-foreground">
                Não guardado
              </Badge>
            )}
          </div>

          {/* Visual Preview */}
          {showPreview && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Preview Visual:</p>
              <TemplatePreview template={template} />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" className="text-xs" onClick={handleReset}>
              <RotateCcw className="w-3 h-3 mr-1" /> Repor Padrão
            </Button>
            <Button
              size="sm"
              className="text-xs"
              disabled={!isModified || saveSettings.isPending}
              onClick={handleSave}
            >
              {saveSettings.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Save className="w-3 h-3 mr-1" />
              )}
              Guardar Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Product Preview Modal */}
      <ProductDescriptionPreview
        open={showProductPreview}
        onClose={() => setShowProductPreview(false)}
        title={SAMPLE_DATA.titulo}
        shortDescription={SAMPLE_DATA.descricao_curta}
        longDescription={renderedHtml}
        price={SAMPLE_DATA.preco}
        category={SAMPLE_DATA.categoria}
        seoKeywords={SAMPLE_DATA.keywords.split(", ")}
      />
    </>
  );
}
