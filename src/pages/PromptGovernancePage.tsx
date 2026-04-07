import { useState } from "react";
import { usePromptGovernance, type PromptTemplate, type PromptVersion } from "@/hooks/usePromptGovernance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, FileCode, Cog, Wrench, ScrollText, Loader2, Sparkles, Palette, Image as ImageIcon, BookOpen, ArrowRightLeft } from "lucide-react";
import { DescriptionTemplateEditor } from "@/components/DescriptionTemplateEditor";
import { PromptTemplatesTable } from "@/components/prompt-governance/PromptTemplatesTable";
import { EditPromptTemplateDialog } from "@/components/prompt-governance/EditPromptTemplateDialog";
import { PromptVersionHistoryPanel } from "@/components/prompt-governance/PromptVersionHistoryPanel";
import { PromptVersionCompareDialog } from "@/components/prompt-governance/PromptVersionCompareDialog";
import { PromptPerformancePanel } from "@/components/prompt-governance/PromptPerformancePanel";
import { ConfirmArchiveDialog } from "@/components/prompt-governance/ConfirmArchiveDialog";
import { PromptSwitcherPanel } from "@/components/prompt-governance/PromptSwitcherPanel";
import { ConfirmDeleteDialog } from "@/components/prompt-governance/ConfirmDeleteDialog";
import { FieldPromptsSettings } from "@/components/FieldPromptsSettings";
import { toast } from "sonner";

const PROMPT_TYPES = ["enrichment", "description", "seo", "categorization", "validation", "translation", "general", "image", "uso_profissional"];
const SYSTEM_TYPES = ["general"];
const SERVICE_TYPES = ["enrichment", "description", "seo", "categorization", "validation", "translation"];
const IMAGE_TYPES = ["image"];
const USO_PROFISSIONAL_TYPES = ["uso_profissional"];

// ═══ DEFAULT PROMPT SEEDS ═══
const DEFAULT_PROMPTS: Array<{ prompt_name: string; prompt_type: string; description: string; base_prompt: string }> = [
  // ── SISTEMA ──
  {
    prompt_name: "Instruções Gerais da IA",
    prompt_type: "general",
    description: "Comportamento base, tom de escrita, idioma e regras globais para todas as tarefas de IA",
    base_prompt: `És um assistente especializado em equipamento profissional para hotelaria, restauração, cozinhas industriais e bares (HORECA).

REGRAS GLOBAIS:
- Responde SEMPRE em Português de Portugal (pt-PT)
- Tom profissional, técnico mas acessível
- Usa terminologia do setor HORECA português
- Unidades: metros, kg, litros, watts, volts (sistema métrico)
- Moeda: EUR (€)
- NÃO inventes especificações técnicas — usa apenas dados fornecidos
- NÃO incluas o nome da marca no texto comercial — foca no equipamento
- Mantém consistência entre campos (título, descrição, SEO devem ser coerentes)
- Prioriza precisão sobre criatividade
- Formato de saída: JSON estruturado conforme schema fornecido`,
  },
  // ── SERVIÇO: Enrichment ──
  {
    prompt_name: "Enriquecimento de Produto",
    prompt_type: "enrichment",
    description: "Completa e enriquece dados de produto a partir de fontes parciais (PDF, scraping, catálogo)",
    base_prompt: `Analisa os dados parciais do produto e enriquece com informação adicional.

OBJETIVO: Preencher campos em falta mantendo 100% de precisão nos dados existentes.

CAMPOS A ENRIQUECER:
- Título otimizado (máx 70 chars, keyword no início)
- Descrição comercial (150-250 chars, sem dados técnicos)
- Especificações técnicas (tabela estruturada)
- Categoria e subcategoria HORECA
- Tags relevantes (4-8)
- FAQ (3-5 perguntas)

REGRAS:
- NÃO alteres dados confirmados (SKU, preço original, dimensões medidas)
- Infere apenas quando há evidência suficiente
- Marca confiança: alta (>90%), média (70-90%), baixa (<70%)
- Se um campo não pode ser inferido com confiança, deixa vazio
- Usa contexto do catálogo para manter consistência com produtos similares`,
  },
  // ── SERVIÇO: Description ──
  {
    prompt_name: "Geração de Descrição",
    prompt_type: "description",
    description: "Gera descrições comerciais e técnicas otimizadas, humanizadas e variadas para produto",
    base_prompt: `És um copywriter especialista em equipamento profissional HORECA.

REGRAS DE ESCRITA (anti-repetição):
- NUNCA comeces com "Descubra" ou "Apresentamos" — vai direto ao valor prático
- NUNCA uses clichés: "revolucionário", "incrível", "melhor do mercado", "solução perfeita"
- Sê específico: "construção em aço inox AISI 304" > "alta qualidade"
- Sê útil: "ideal para 80-120 refeições/dia" > "grande capacidade"
- Varia a estrutura entre produtos — cada descrição deve sentir-se única
- Usa verbos de ação: "produz", "mantém", "reduz", "otimiza", "suporta"

ESTRUTURA short_description (máx 160 chars):
- 1-2 frases focadas no benefício operacional + 1 spec diferenciadora
- Funciona como snippet em listagens

ESTRUTURA long_description (HTML):
1. <p> de abertura: O que é, para quem, que problema resolve (sem specs, 2-3 frases)
2. <ul> com 4-6 características PRÁTICAS (benefício de cada, não só a spec)
3. <p> com aplicações concretas: tipo de estabelecimento, volume, situações
4. <table> com specs técnicas se disponíveis
5. Opcional: 2-3 <details><summary>FAQ</summary> com perguntas reais

REGRAS SEO:
- Keyword principal na 1ª frase, variações long-tail nas seo_keywords
- Natural, sem stuffing
- Normas (CE, HACCP) quando relevante

SAÍDA JSON:
{ "short_description": "", "long_description": "HTML", "seo_keywords": [], "confidence_score": 0.0-1.0 }`,
  },
  // ── SERVIÇO: SEO ──
  {
    prompt_name: "Otimização SEO",
    prompt_type: "seo",
    description: "Gera meta titles, meta descriptions, slugs e focus keywords otimizados",
    base_prompt: `Otimiza os campos SEO do produto para máxima visibilidade em pesquisa.

CAMPOS A GERAR:

1. META TITLE (máx 60 chars):
   - Keyword principal no início
   - Inclui "Comprar" ou "Preço" para intenção comercial
   - NÃO inclui marca — foca na linha/série e tipo
   - Termina com separador e nome da loja se couber

2. META DESCRIPTION (máx 155 chars):
   - Call-to-action (ex: "Encomende já", "Entrega rápida")
   - 1-2 benefícios chave
   - Menção de preço ou "Melhor preço" se aplicável
   - Linguagem que gere cliques

3. SEO SLUG:
   - Lowercase, sem acentos, hífens
   - Keyword principal + tipo + linha
   - Máx 5-7 palavras
   - Ex: fritadeira-gas-linha-700-8-litros

4. FOCUS KEYWORDS (3-5):
   - Keyword principal do produto
   - Variações long-tail
   - Termos de pesquisa do setor HORECA

5. IMAGE ALT TEXTS (máx 125 chars cada):
   - Descritivo e relevante
   - Keyword + linha/marca
   - Não começar com "Imagem de"

REGRAS:
- Pesquisa de intenção comercial (comprar, preço, melhor)
- Evita keyword stuffing
- Cada campo deve ser único e complementar`,
  },
  // ── SERVIÇO: Categorization ──
  {
    prompt_name: "Classificação de Produto",
    prompt_type: "categorization",
    description: "Classifica produtos na taxonomia HORECA com categoria e subcategoria",
    base_prompt: `Classifica o produto na taxonomia HORECA correta.

TAXONOMIA PRINCIPAL:
- Cozinha > Fogões, Fritadeiras, Fornos, Grelhadores, Banhos-maria, Marmitas, Basculantes
- Cozinha > Preparação (Cortadores, Batedeiras, Amassadeiras, Processadores)
- Lavagem > Máquinas Lavar Loiça, Máquinas Lavar Copos, Túneis Lavagem
- Frio > Armários Refrigerados, Bancadas Refrigeradas, Abatedores, Câmaras
- Bar > Máquinas Café, Máquinas Gelo, Dispensadores Bebidas
- Mobiliário Inox > Bancadas, Estantes, Lavatórios, Mesas
- Ventilação > Hottes, Exaustores, Filtros
- Distribuição > Buffets, Vitrinas, Carros Transporte

FORMATO DE SAÍDA:
{
  "category": "Categoria Principal",
  "subcategory": "Subcategoria",
  "confidence": 0.95,
  "alternative_category": "Alternativa se ambíguo",
  "reasoning": "Breve justificação"
}

REGRAS:
- Prioriza categorias existentes no catálogo
- Se ambíguo, indica as 2 categorias mais prováveis com confiança
- Pode propor nova subcategoria se nenhuma existente serve
- Considera o uso primário do equipamento para classificar`,
  },
  // ── SERVIÇO: Validation ──
  {
    prompt_name: "Validação de Produto",
    prompt_type: "validation",
    description: "Valida completude, consistência e qualidade dos dados de produto",
    base_prompt: `Valida os dados do produto e reporta problemas de qualidade.

VERIFICAÇÕES OBRIGATÓRIAS:

1. COMPLETUDE:
   - Título presente e com >20 chars
   - Descrição presente e com >100 chars
   - Pelo menos 1 imagem
   - Preço > 0
   - Categoria atribuída
   - SKU único

2. CONSISTÊNCIA:
   - Título coerente com descrição
   - Categoria correta para o tipo de produto
   - Preço razoável para a categoria (não outlier extremo)
   - Dimensões e peso fazem sentido para o tipo

3. QUALIDADE:
   - Sem texto duplicado entre campos
   - Sem caracteres especiais/encoding quebrado
   - Meta title ≤ 60 chars
   - Meta description ≤ 155 chars
   - Imagens com alt text

FORMATO DE SAÍDA:
{
  "score": 85,
  "issues": [
    { "field": "meta_title", "severity": "warning", "message": "Meta title tem 72 chars (máx 60)" }
  ],
  "suggestions": ["Adicionar FAQ", "Completar alt text das imagens"]
}

REGRAS:
- Score de 0-100
- Severity: error (bloqueante), warning (recomendado), info (sugestão)
- Não penalizar campos opcionais em falta, apenas obrigatórios`,
  },
  // ── SERVIÇO: Translation ──
  {
    prompt_name: "Tradução de Conteúdo",
    prompt_type: "translation",
    description: "Traduz conteúdo de produto mantendo terminologia técnica HORECA",
    base_prompt: `Traduz o conteúdo do produto para o idioma alvo mantendo qualidade profissional.

REGRAS DE TRADUÇÃO:
- Mantém terminologia técnica correta no idioma alvo
- NÃO traduz: SKUs, códigos, nomes de modelos, marcas
- Adapta unidades se necessário (mas mantém sistema métrico)
- Mantém formatação HTML intacta
- Traduz alt texts das imagens
- Adapta o SEO ao mercado alvo (keywords locais)

GLOSSÁRIO HORECA (PT→EN exemplo):
- Fritadeira → Fryer
- Fogão → Range/Cooker
- Bancada → Worktable/Counter
- Armário refrigerado → Refrigerated cabinet
- Máquina lavar loiça → Dishwasher
- Abatedor → Blast chiller
- Hotte → Extraction hood
- Banho-maria → Bain-marie

FORMATO DE SAÍDA:
Retorna o mesmo JSON de entrada com todos os campos de texto traduzidos.
Adiciona campo "translation_notes" com observações relevantes.

REGRAS:
- Confiança mínima: 85% para publicação automática
- Se um termo técnico não tem tradução clara, mantém o original entre parênteses
- Verifica que URLs e links não foram alterados`,
  },
  // ── IMAGENS ──
  {
    prompt_name: "Imagem — Alt Text SEO",
    prompt_type: "image",
    description: "Prompt usado para gerar alt text das imagens durante otimização e lifestyle. Variáveis: {{product_name}}, {{product_type}}",
    base_prompt: `Gera um texto alternativo (alt text) otimizado para SEO em Português de Portugal para esta imagem de produto.

CONTEXTO DO PRODUTO:
- Nome: {{product_name}}
- Tipo: {{product_type}}

REGRAS OBRIGATÓRIAS:
- Máximo 125 caracteres
- Descreve o produto de forma clara, concreta e acessível
- Inclui a keyword principal quando fizer sentido, sem keyword stuffing
- Se a perspetiva for evidente, menciona-a (ex: vista frontal, detalhe lateral)
- Não comeces com "Imagem de"
- Responde APENAS com o texto alt, sem aspas, sem markdown e sem explicações`,
  },
  {
    prompt_name: "Imagem — Lifestyle",
    prompt_type: "image",
    description: "Prompt usado para gerar imagens lifestyle a partir da imagem original. Variáveis: {{product_name}}, {{product_type}}",
    base_prompt: `Coloca este produto num ambiente comercial realista e profissional.

CONTEXTO DO PRODUTO:
- Nome: {{product_name}}
- Tipo: {{product_type}}

REGRAS OBRIGATÓRIAS:
- O produto deve ser o foco principal, centrado e em destaque
- O ambiente deve corresponder à categoria do produto
- Mantém proporções realistas e aspecto comercial premium
- Iluminação profissional e fotografia de catálogo de alta qualidade
- Não distorças o produto nem inventes características físicas
- Resultado final pronto para e-commerce`,
  },
  {
    prompt_name: "Imagem — Otimização",
    prompt_type: "image",
    description: "Prompt usado para upscale/otimização visual sem alterar a composição original. Variáveis: {{product_name}}, {{product_type}}",
    base_prompt: `Melhora a qualidade desta imagem de produto para e-commerce.

CONTEXTO DO PRODUTO:
- Nome: {{product_name}}
- Tipo: {{product_type}}

REGRAS OBRIGATÓRIAS:
- Aumenta nitidez, definição e resolução percebida
- Melhora ligeiramente brilho, contraste e saturação com resultado natural
- Remove ruído e desfocagem se existirem
- Mantém enquadramento, fundo, ângulo e composição EXATAMENTE como estão
- Não recortes, não mudes a posição do produto e não substituas o fundo
- Apenas melhora a qualidade visual da imagem existente`,
  },
  // ── USO PROFISSIONAL ──
  {
    prompt_name: "Uso Profissional — Conteúdo Editorial",
    prompt_type: "uso_profissional",
    description: "Gera conteúdo editorial sobre como o equipamento é usado por profissionais de hotelaria/restauração",
    base_prompt: `És um especialista em equipamentos profissionais para hotelaria, restauração e catering em Portugal. Escreves conteúdo editorial em português europeu para um catálogo B2B. O teu público são chefs, responsáveis de F&B, gestores de hotel e compradores profissionais.

Quando descreves como um equipamento é usado, focas em:
- Contextos reais de uso profissional (não doméstico)
- Benefícios operacionais concretos (velocidade, consistência, higiene, custo)
- Linguagem técnica mas acessível
- Casos de uso específicos da hotelaria portuguesa

NUNCA uses linguagem de review de consumidor.
Escreves como um técnico especialista, não como um cliente.

Gera conteúdo com esta estrutura:
1. Introdução (1 parágrafo sobre o valor do equipamento)
2. 3 Casos de uso (contexto + descrição detalhada)
3. 3-4 Dicas profissionais
4. 3 Perfis profissionais alvo`,
  },
  {
    prompt_name: "Uso Profissional — Bullet Points",
    prompt_type: "uso_profissional",
    description: "Versão compacta em bullets — ideal para fichas técnicas e catálogos rápidos",
    base_prompt: `És um técnico especialista em equipamento profissional HORECA. Gera conteúdo de uso profissional em formato BULLET POINTS compacto em português europeu.

FORMATO OBRIGATÓRIO (tudo em bullets):

📋 PARA QUE SERVE:
• [Função principal do equipamento em 1 linha]
• [Segunda função ou variante de uso]

🏨 ONDE SE USA:
• [Tipo de estabelecimento 1] — [contexto específico]
• [Tipo de estabelecimento 2] — [contexto específico]
• [Tipo de estabelecimento 3] — [contexto específico]

⚡ VANTAGENS OPERACIONAIS:
• [Benefício 1 com dado concreto]
• [Benefício 2 com dado concreto]
• [Benefício 3 com dado concreto]
• [Benefício 4 com dado concreto]

💡 DICAS DE PROFISSIONAL:
• [Dica prática 1]
• [Dica prática 2]
• [Dica prática 3]

👤 PERFIS QUE USAM:
• [Perfil 1] — [porquê]
• [Perfil 2] — [porquê]
• [Perfil 3] — [porquê]

REGRAS:
- Máximo 5 bullets por secção
- Cada bullet ≤ 80 chars
- Sem parágrafos de texto — APENAS bullets
- Tom técnico e direto
- Dados concretos sempre que possível`,
  },

  // ═══ EXEMPLOS ALTERNATIVOS (Bullet Points) ═══
  {
    prompt_name: "Descrição — Bullet Points",
    prompt_type: "description",
    description: "Gera descrições usando listas de bullets em vez de texto corrido — mais scannable e direto",
    base_prompt: `És um copywriter técnico para equipamento profissional HORECA. Gera descrições em formato BULLET POINTS.

ESTRUTURA short_description (máx 160 chars):
- 1 frase direta: o que é + para quem + 1 spec chave

ESTRUTURA long_description (HTML):

<h3>O que é</h3>
<ul>
  <li>Tipo de equipamento e função principal</li>
  <li>Linha/série e posicionamento</li>
</ul>

<h3>Principais Vantagens</h3>
<ul>
  <li>✅ [Vantagem 1 com dado concreto]</li>
  <li>✅ [Vantagem 2 com dado concreto]</li>
  <li>✅ [Vantagem 3 com dado concreto]</li>
  <li>✅ [Vantagem 4 com dado concreto]</li>
</ul>

<h3>Ideal Para</h3>
<ul>
  <li>🏨 [Tipo estabelecimento + volume/contexto]</li>
  <li>🍽️ [Tipo estabelecimento + volume/contexto]</li>
  <li>☕ [Tipo estabelecimento + volume/contexto]</li>
</ul>

<h3>Especificações</h3>
<table>com specs técnicas</table>

REGRAS:
- ZERO parágrafos de texto corrido
- Apenas bullets e tabelas
- Cada bullet ≤ 100 chars, começa com emoji ou ✅
- NÃO incluas marca no texto comercial
- Inclui normas (CE, HACCP) se relevante

SAÍDA JSON:
{ "short_description": "", "long_description": "HTML", "seo_keywords": [], "confidence_score": 0.0-1.0 }`,
  },
  {
    prompt_name: "SEO — Formato Agressivo",
    prompt_type: "seo",
    description: "SEO focado em conversão com CTAs fortes e keywords comerciais — para campanhas e promoções",
    base_prompt: `Otimiza SEO do produto com foco MÁXIMO em conversão e cliques.

1. META TITLE (máx 60 chars):
   - Começa com "Comprar" ou "Melhor Preço"
   - Keyword principal logo a seguir
   - Ex: "Comprar Fritadeira Gás 8L Linha 700 | Entrega Rápida"

2. META DESCRIPTION (máx 155 chars):
   - Abre com benefício operacional
   - Inclui urgência: "Stock limitado", "Entrega em 24h", "Preço especial"
   - Fecha com CTA: "Encomende agora", "Peça orçamento"
   - Ex: "Fritadeira profissional 8L com termostato digital. Ideal para restaurantes com alto volume. Entrega em 24h — Encomende já!"

3. SEO SLUG:
   - comprar-[tipo]-[linha]-[spec-chave]
   - Ex: comprar-fritadeira-gas-linha-700

4. FOCUS KEYWORDS (5-8):
   - Inclui keywords transacionais: "comprar", "preço", "onde comprar"
   - Inclui keywords informacionais: "melhor [tipo] para [uso]"
   - Variações com e sem acento

5. IMAGE ALT TEXTS:
   - "[Tipo] [Linha] — Comprar ao melhor preço"

REGRAS:
- Foco 100% em intenção de compra
- Cada campo complementa os outros sem repetir
- Sem keyword stuffing mas agressivo em CTAs`,
  },
  {
    prompt_name: "Enriquecimento — Modo Rápido",
    prompt_type: "enrichment",
    description: "Versão simplificada do enrichment — preenche apenas campos vazios sem reescrever existentes",
    base_prompt: `Analisa os dados do produto e preenche APENAS os campos em falta. NÃO reescrevas campos que já têm conteúdo.

VERIFICAÇÃO RÁPIDA:
• Título vazio? → Gera título (máx 70 chars, keyword no início)
• Descrição vazia? → Gera descrição curta (3-4 bullets)
• Categoria vazia? → Classifica na taxonomia HORECA
• Tags vazias? → Gera 4-6 tags
• Meta title vazio? → Gera meta title SEO
• Meta description vazia? → Gera meta description
• FAQ vazio? → Gera 3 FAQs

PARA CADA CAMPO PREENCHIDO:
- Marca confiança: alta (>90%), média (70-90%), baixa (<70%)
- Se confiança < 70%, deixa vazio e reporta

REGRAS:
- NÃO alteres dados confirmados (SKU, preço, dimensões)
- NÃO reescrevas campos que já têm conteúdo válido
- Formato de saída: JSON com apenas os campos preenchidos
- Marca "skipped" nos campos já preenchidos`,
  },
  {
    prompt_name: "Validação — Checklist Rápido",
    prompt_type: "validation",
    description: "Validação simplificada em formato checklist — pass/fail para cada campo obrigatório",
    base_prompt: `Valida o produto usando um checklist rápido de PASS/FAIL.

CHECKLIST:
☐ Título: presente, >20 chars, <70 chars → ✅/❌
☐ Descrição: presente, >100 chars → ✅/❌
☐ Preço: >0 e razoável para a categoria → ✅/❌
☐ Categoria: atribuída e válida → ✅/❌
☐ SKU: presente e formato correto → ✅/❌
☐ Imagem: pelo menos 1 → ✅/❌
☐ Meta Title: ≤60 chars → ✅/❌
☐ Meta Description: ≤155 chars → ✅/❌
☐ Slug: presente e formatado → ✅/❌
☐ Tags: ≥3 tags → ✅/❌

FORMATO DE SAÍDA:
{
  "score": [0-100 baseado em % de checks passed],
  "passed": ["titulo", "preco", ...],
  "failed": [
    { "field": "meta_title", "reason": "Tem 72 chars (máx 60)" }
  ],
  "quick_fixes": ["Reduzir meta_title para 60 chars"]
}

REGRAS:
- Sem análise profunda — apenas checklist
- Score = (passed / total) * 100
- quick_fixes: max 3, ações concretas e rápidas`,
  },
  {
    prompt_name: "Categorização — Multi-Nível",
    prompt_type: "categorization",
    description: "Classificação detalhada com 3 níveis de hierarquia e tags de aplicação",
    base_prompt: `Classifica o produto com 3 NÍVEIS de profundidade na taxonomia HORECA.

FORMATO:
{
  "level_1": "Categoria Principal",
  "level_2": "Subcategoria",
  "level_3": "Tipo Específico",
  "application_tags": ["restaurante", "hotel", "catering"],
  "energy_type": "gas|electric|manual|null",
  "line_series": "Linha 700|Linha 900|null",
  "confidence": 0.95,
  "reasoning": "Breve justificação"
}

EXEMPLOS:
• Fritadeira a gás 8L → Cozinha > Fritadeiras > Fritadeiras a Gás
• Abatedor 5 tabuleiros → Frio > Abatedores > Abatedores Compactos
• Bancada inox 1200mm → Mobiliário Inox > Bancadas > Bancadas de Trabalho
• Máquina de café 2 grupos → Bar > Máquinas de Café > Máquinas Espresso

REGRAS:
- Prioriza categorias existentes no catálogo
- application_tags: 2-4 contextos de uso
- Se ambíguo, indica alternativa com confidence`,
  },
];

export default function PromptGovernancePage() {
  const {
    templates, createTemplate, updateTemplate, archiveTemplate, restoreTemplate,
    deleteTemplate, duplicateTemplate, useVersions, createVersion, activateVersion,
    usageLogs, useVersionPerformance, switchActivePrompt,
  } = usePromptGovernance();

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("switcher");
  const [seeding, setSeeding] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ prompt_name: "", prompt_type: "general", base_prompt: "", description: "" });

  // Edit dialog
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);

  // Confirm dialogs
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Compare
  const [compareVersions, setCompareVersions] = useState<[PromptVersion | null, PromptVersion | null]>([null, null]);

  // New version
  const [newVersionText, setNewVersionText] = useState("");
  const [newVersionNotes, setNewVersionNotes] = useState("");

  const versions = useVersions(selectedTemplate);
  const logs = usageLogs(selectedVersion);
  const performance = useVersionPerformance(selectedVersion);

  const selectedTpl = templates.data?.find(t => t.id === selectedTemplate);
  const existingPromptKeys = new Set((templates.data || []).map((t) => `${t.prompt_type}:${t.prompt_name}`));

  const systemTemplates = (templates.data || []).filter(t => SYSTEM_TYPES.includes(t.prompt_type));
  const serviceTemplates = (templates.data || []).filter(t => SERVICE_TYPES.includes(t.prompt_type));
  const imageTemplates = (templates.data || []).filter(t => IMAGE_TYPES.includes(t.prompt_type));
  const usoProfissionalTemplates = (templates.data || []).filter(t => USO_PROFISSIONAL_TYPES.includes(t.prompt_type));
  const missingImagePrompts = DEFAULT_PROMPTS.filter(
    (p) => IMAGE_TYPES.includes(p.prompt_type) && !existingPromptKeys.has(`${p.prompt_type}:${p.prompt_name}`)
  );
  const missingUsoProfPrompts = DEFAULT_PROMPTS.filter(
    (p) => USO_PROFISSIONAL_TYPES.includes(p.prompt_type) && !existingPromptKeys.has(`${p.prompt_type}:${p.prompt_name}`)
  );

  const handleSelectTemplate = (id: string) => {
    setSelectedTemplate(id);
    setSelectedVersion(null);
    setActiveTab("versions");
  };

  const seedPrompts = async (
    promptsToCreate: Array<{ prompt_name: string; prompt_type: string; description: string; base_prompt: string }>,
    emptyMessage: string,
    successFormatter: (count: number) => string,
  ) => {
    const toCreate = promptsToCreate;

    if (toCreate.length === 0) {
      toast.info(emptyMessage);
      return;
    }

    setSeeding(true);
    try {
      for (const prompt of toCreate) {
        await createTemplate.mutateAsync(prompt);
      }
      toast.success(successFormatter(toCreate.length));
    } catch (e: any) {
      toast.error(`Erro ao criar prompts: ${e.message}`);
    } finally {
      setSeeding(false);
    }
  };

  const handleSeedDefaults = async () => {
    const toCreate = DEFAULT_PROMPTS.filter(
      (p) => !existingPromptKeys.has(`${p.prompt_type}:${p.prompt_name}`)
    );

    await seedPrompts(
      toCreate,
      "Todos os prompts padrão já existem.",
      (count) => `${count} prompts padrão criados!`,
    );
  };

  const handleSeedImagePrompts = async () => {
    await seedPrompts(
      missingImagePrompts,
      "Os prompts de imagem já existem.",
      (count) => `${count} prompts de imagem criados!`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCode className="w-6 h-6" /> Prompt Governance
          </h1>
          <p className="text-muted-foreground">Gestão de prompts de sistema, serviço e imagem usados no runtime da IA</p>
        </div>
        <div className="flex gap-2">
          {(templates.data || []).length === 0 && (
            <Button variant="outline" onClick={handleSeedDefaults} disabled={seeding}>
              {seeding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              Criar Prompts Padrão
            </Button>
          )}
          {(templates.data || []).length > 0 && (templates.data || []).length < DEFAULT_PROMPTS.length && (
            <Button variant="outline" size="sm" onClick={handleSeedDefaults} disabled={seeding}>
              {seeding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              Completar em Falta
            </Button>
          )}
          <Button onClick={() => setShowCreate(!showCreate)}>
            <Plus className="w-4 h-4 mr-1" /> Novo Template
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{systemTemplates.length}</p>
          <p className="text-xs text-muted-foreground">Prompts de Sistema</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{serviceTemplates.length}</p>
          <p className="text-xs text-muted-foreground">Prompts de Serviço</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{imageTemplates.length}</p>
          <p className="text-xs text-muted-foreground">Prompts de Imagem</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{usoProfissionalTemplates.length}</p>
          <p className="text-xs text-muted-foreground">Uso Profissional</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{(templates.data || []).filter(t => t.is_active).length}</p>
          <p className="text-xs text-muted-foreground">Ativos</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{templates.data?.length || 0}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </CardContent></Card>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardHeader><CardTitle className="text-base">Novo Template</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nome do prompt" value={newTemplate.prompt_name} onChange={e => setNewTemplate(f => ({ ...f, prompt_name: e.target.value }))} className="flex-1" />
              <Select value={newTemplate.prompt_type} onValueChange={v => setNewTemplate(f => ({ ...f, prompt_type: v }))}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general" className="font-medium">⚙️ Sistema — general</SelectItem>
                  <SelectItem value="image">🖼️ Imagem — image</SelectItem>
                  <SelectItem value="uso_profissional">📖 Uso Profissional</SelectItem>
                  {SERVICE_TYPES.map(t => <SelectItem key={t} value={t}>🔧 Serviço — {t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Descrição" value={newTemplate.description} onChange={e => setNewTemplate(f => ({ ...f, description: e.target.value }))} />
            <Textarea placeholder="Prompt base..." value={newTemplate.base_prompt} onChange={e => setNewTemplate(f => ({ ...f, base_prompt: e.target.value }))} rows={4} />
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  createTemplate.mutate(newTemplate);
                  setNewTemplate({ prompt_name: "", prompt_type: "general", base_prompt: "", description: "" });
                  setShowCreate(false);
                }}
                disabled={!newTemplate.prompt_name || !newTemplate.base_prompt || createTemplate.isPending}
              >
                <Plus className="w-4 h-4 mr-1" /> Criar
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="switcher" className="gap-1.5">
            <ArrowRightLeft className="h-4 w-4" /> Troca Rápida
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-1.5">
            <Cog className="h-4 w-4" /> Sistema ({systemTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="service" className="gap-1.5">
            <Wrench className="h-4 w-4" /> Serviço ({serviceTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="images" className="gap-1.5">
            <ImageIcon className="h-4 w-4" /> Imagens ({imageTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="uso-profissional" className="gap-1.5">
            <BookOpen className="h-4 w-4" /> Uso Prof. ({usoProfissionalTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="field-prompts" className="gap-1.5">
            <ScrollText className="h-4 w-4" /> Prompts por Campo
          </TabsTrigger>
          <TabsTrigger value="description-template" className="gap-1.5">
            <Palette className="h-4 w-4" /> Template Descrição
          </TabsTrigger>
          <TabsTrigger value="versions" disabled={!selectedTemplate}>
            Versões {selectedTpl ? `— ${selectedTpl.prompt_name}` : ""}
          </TabsTrigger>
          <TabsTrigger value="performance" disabled={!selectedVersion}>Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="switcher" className="mt-4">
          <PromptSwitcherPanel
            templates={templates.data || []}
            onSwitch={(p) => switchActivePrompt.mutate(p)}
            switching={switchActivePrompt.isPending}
            onSelectTemplate={(id) => { setSelectedTemplate(id); setSelectedVersion(null); setActiveTab("versions"); }}
          />
        </TabsContent>

        <TabsContent value="system" className="mt-4">
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <Cog className="w-4 h-4 inline mr-1" />
              <strong>Prompts de Sistema</strong> definem o comportamento base da IA — instruções gerais, tom de escrita, regras de idioma e formato de saída.
            </p>
          </div>
          <PromptTemplatesTable
            templates={systemTemplates}
            selectedId={selectedTemplate}
            onSelect={handleSelectTemplate}
            onEdit={t => setEditingTemplate(t)}
            onDuplicate={id => duplicateTemplate.mutate(id)}
            onArchive={id => setArchiveId(id)}
            onRestore={id => restoreTemplate.mutate(id)}
            onDelete={id => setDeleteId(id)}
          />
        </TabsContent>

        <TabsContent value="service" className="mt-4">
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <Wrench className="w-4 h-4 inline mr-1" />
              <strong>Prompts de Serviço</strong> são especializados por tarefa — enrichment, SEO, descrições, categorização, validação e tradução. São ligados às regras de routing no AI Provider Center.
            </p>
          </div>
          <PromptTemplatesTable
            templates={serviceTemplates}
            selectedId={selectedTemplate}
            onSelect={handleSelectTemplate}
            onEdit={t => setEditingTemplate(t)}
            onDuplicate={id => duplicateTemplate.mutate(id)}
            onArchive={id => setArchiveId(id)}
            onRestore={id => restoreTemplate.mutate(id)}
            onDelete={id => setDeleteId(id)}
          />
        </TabsContent>

        <TabsContent value="images" className="mt-4">
          <div className="mb-4 flex flex-col gap-3 rounded-lg bg-muted/50 p-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              <ImageIcon className="mr-1 inline h-4 w-4" />
              <strong>Prompts de Imagem</strong> controlam o alt text, a geração lifestyle e a otimização visual.
              Variáveis disponíveis: <code>{"{{product_name}}"}</code> e <code>{"{{product_type}}"}</code>.
            </p>
            {missingImagePrompts.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleSeedImagePrompts} disabled={seeding}>
                {seeding ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                Criar prompts base de imagem
              </Button>
            )}
          </div>

          <PromptTemplatesTable
            templates={imageTemplates}
            selectedId={selectedTemplate}
            onSelect={handleSelectTemplate}
            onEdit={t => setEditingTemplate(t)}
            onDuplicate={id => duplicateTemplate.mutate(id)}
            onArchive={id => setArchiveId(id)}
            onRestore={id => restoreTemplate.mutate(id)}
            onDelete={id => setDeleteId(id)}
          />
        </TabsContent>

        <TabsContent value="uso-profissional" className="mt-4">
          <div className="mb-4 flex flex-col gap-3 rounded-lg bg-muted/50 p-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              <BookOpen className="mr-1 inline h-4 w-4" />
              <strong>Uso Profissional</strong> — prompt editorial que gera conteúdo sobre como o equipamento é usado por profissionais de hotelaria e restauração. Usado no tab "Uso Prof." de cada produto.
            </p>
            {missingUsoProfPrompts.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => seedPrompts(missingUsoProfPrompts, "O prompt de Uso Profissional já existe.", (c) => `${c} prompt(s) de Uso Profissional criado(s)!`)} disabled={seeding}>
                {seeding ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                Criar prompt base
              </Button>
            )}
          </div>
          <PromptTemplatesTable
            templates={usoProfissionalTemplates}
            selectedId={selectedTemplate}
            onSelect={handleSelectTemplate}
            onEdit={t => setEditingTemplate(t)}
            onDuplicate={id => duplicateTemplate.mutate(id)}
            onArchive={id => setArchiveId(id)}
            onRestore={id => restoreTemplate.mutate(id)}
            onDelete={id => setDeleteId(id)}
          />
        </TabsContent>

        <TabsContent value="field-prompts" className="mt-4">
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <ScrollText className="w-4 h-4 inline mr-1" />
              <strong>Prompts por Campo</strong> — instruções específicas que a IA segue ao otimizar cada campo do produto (título, descrição, SEO, etc.). Estes são os prompts operacionais usados durante a otimização.
            </p>
          </div>
          <FieldPromptsSettings />
        </TabsContent>

        <TabsContent value="description-template" className="mt-4">
          <div className="mb-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">
              <Palette className="w-4 h-4 inline mr-1" />
              <strong>Template de Descrição</strong> — define a estrutura visual da descrição gerada pela IA. 
              Use variáveis coloridas para montar o layout. O template é passado como instrução de formato à IA.
            </p>
          </div>
          <DescriptionTemplateEditor />
        </TabsContent>

        <TabsContent value="versions" className="space-y-4 mt-4">
          {!selectedTemplate ? (
            <p className="text-muted-foreground">Selecione um template.</p>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Nova Versão</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Textarea placeholder="Texto do prompt..." value={newVersionText} onChange={e => setNewVersionText(e.target.value)} rows={4} />
                  <Input placeholder="Notas da versão (opcional)" value={newVersionNotes} onChange={e => setNewVersionNotes(e.target.value)} />
                  <Button
                    size="sm"
                    onClick={() => {
                      createVersion.mutate({ template_id: selectedTemplate!, prompt_text: newVersionText, version_notes: newVersionNotes || undefined });
                      setNewVersionText("");
                      setNewVersionNotes("");
                    }}
                    disabled={!newVersionText || createVersion.isPending}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Criar Versão
                  </Button>
                </CardContent>
              </Card>

              <PromptVersionHistoryPanel
                versions={versions.data || []}
                selectedVersionId={selectedVersion}
                onSelectVersion={id => { setSelectedVersion(id); }}
                onActivateVersion={versionId => activateVersion.mutate({ template_id: selectedTemplate!, version_id: versionId })}
                onCompareVersions={(a, b) => setCompareVersions([a, b])}
                templateId={selectedTemplate!}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <PromptPerformancePanel
            performance={performance.data}
            logs={logs.data || []}
            loading={performance.isLoading}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <EditPromptTemplateDialog
        template={editingTemplate}
        open={!!editingTemplate}
        onOpenChange={open => { if (!open) setEditingTemplate(null); }}
        onSave={updates => updateTemplate.mutate(updates)}
        saving={updateTemplate.isPending}
      />

      <ConfirmArchiveDialog
        open={!!archiveId}
        onOpenChange={open => { if (!open) setArchiveId(null); }}
        onConfirm={() => { if (archiveId) archiveTemplate.mutate(archiveId); setArchiveId(null); }}
      />

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={open => { if (!open) setDeleteId(null); }}
        onConfirm={() => { if (deleteId) deleteTemplate.mutate(deleteId); setDeleteId(null); }}
      />

      <PromptVersionCompareDialog
        open={!!compareVersions[0] && !!compareVersions[1]}
        onOpenChange={open => { if (!open) setCompareVersions([null, null]); }}
        versionA={compareVersions[0]}
        versionB={compareVersions[1]}
      />
    </div>
  );
}
