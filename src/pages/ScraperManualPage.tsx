import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Globe, MousePointerClick, List, Crosshair, Play, Download,
  ArrowRight, Wand2, Upload, Layers, FileSpreadsheet, Navigation,
  Eye, Zap, Coins, Brain, Search, Target, RefreshCw, Settings2,
  CheckCircle2, AlertTriangle, BookOpen, ExternalLink,
} from "lucide-react";

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" />
        {title}
      </h2>
      <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
        {number}
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs">
      <span className="text-primary font-bold">💡</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

export default function ScraperManualPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary" />
          Manual de Utilização — Ferramentas de Scraping
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Guia completo para as duas ferramentas de extração de dados de fornecedores
        </p>
      </div>

      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visão Geral</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>O sistema dispõe de <strong className="text-foreground">duas ferramentas complementares</strong> para extração de dados de sites de fornecedores:</p>
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4 border-primary/30">
              <div className="flex items-center gap-2 mb-2">
                <MousePointerClick className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">Visual Scraper</span>
              </div>
              <p className="text-xs">Extração manual/visual com controlo total. Navegue pelo site, selecione elementos clicando, defina campos e extraia em lote. Ideal para sites complexos ou quando precisa de controlo fino.</p>
              <Badge variant="outline" className="mt-2 text-[10px]">Rota: /visual-scraper</Badge>
            </Card>
            <Card className="p-4 border-primary/30">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground">Website Extraction Agent</span>
              </div>
              <p className="text-xs">Extração inteligente automatizada em 3 fases (Discovery → Teste → Escala). O agente classifica páginas, extrai campos automaticamente e aprende padrões por fornecedor.</p>
              <Badge variant="outline" className="mt-2 text-[10px]">Rota: /website-agent</Badge>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* ═══════════ VISUAL SCRAPER ═══════════ */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-primary">
          <MousePointerClick className="w-6 h-6" />
          1. Visual Scraper — Guia Passo a Passo
        </h2>

        <Section icon={Navigation} title="Passo 1 — Introduzir URL">
          <p>Abra o Visual Scraper e insira o URL da página de listagem/categorias do fornecedor no campo de texto. Prima <strong className="text-foreground">Enter</strong> ou clique <strong className="text-foreground">"Abrir"</strong>.</p>
          <p>Alternativamente, pode:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Importar CSV/Excel</strong> — ficheiro com uma coluna de URLs</li>
            <li><strong className="text-foreground">Colar URLs manualmente</strong> — um por linha na caixa de texto</li>
          </ul>
          <Tip>Se já tem uma lista de URLs de produto (ex: exportada de outro sistema), use a importação direta para saltar os passos de navegação.</Tip>
        </Section>

        <Section icon={Eye} title="Passo 2 — Navegar e Explorar">
          <p>O site do fornecedor é carregado dentro de uma pré-visualização embutida (iframe via proxy). Pode:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Navegar</strong> — clique em links para explorar o site</li>
            <li><strong className="text-foreground">Voltar atrás</strong> — botão ← no browser interno</li>
            <li><strong className="text-foreground">Recarregar</strong> — botão de refresh</li>
            <li><strong className="text-foreground">Abrir original</strong> — ícone de link externo abre no browser real</li>
          </ul>
          <p className="font-medium text-foreground mt-2">Ações disponíveis neste passo:</p>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div className="p-2 border rounded-lg">
              <p className="text-xs font-medium text-foreground flex items-center gap-1"><List className="w-3 h-3" /> Extrair Links</p>
              <p className="text-[10px]">Extrai todos os links da página actual, classificando-os automaticamente em categorias, grupos e produtos.</p>
            </div>
            <div className="p-2 border rounded-lg">
              <p className="text-xs font-medium text-foreground flex items-center gap-1"><Crosshair className="w-3 h-3" /> Selecionar Campos</p>
              <p className="text-[10px]">Entra em modo de seleção visual — clique nos elementos que deseja extrair.</p>
            </div>
          </div>
        </Section>

        <Section icon={List} title="Passo 3 — Gestão de Links (URLs)">
          <p>Após extrair links, o sistema mostra uma tabela com todos os URLs encontrados, classificados automaticamente:</p>
          <div className="flex flex-wrap gap-2 my-2">
            <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">Categoria</Badge>
            <Badge variant="outline" className="text-[10px] text-violet-600 border-violet-300">Grupo</Badge>
            <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">Produto</Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Outro</Badge>
          </div>
          <p><strong className="text-foreground">Funcionalidades disponíveis:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Reclassificar tipo</strong> — mude o tipo de qualquer link (ex: de "Outro" para "Produto")</li>
            <li><strong className="text-foreground">Selecionar/desselecionar</strong> — checkbox individual ou "Selecionar Todos"</li>
            <li><strong className="text-foreground">Filtrar</strong> — pesquise por URL ou texto</li>
            <li><strong className="text-foreground">Remover</strong> — elimine links irrelevantes</li>
            <li><strong className="text-foreground">Importar URLs</strong> — adicione mais URLs de ficheiro</li>
            <li><strong className="text-foreground">Detetar Padrões</strong> — agrupa URLs por estrutura (ex: <code>/product/{"{id}"}</code>) e permite selecionar por padrão</li>
          </ul>

          <Tip>O sistema filtra automaticamente links de navegação (menus, rodapé, redes sociais) usando heurísticas de DOM e padrões de URL.</Tip>

          <p className="font-medium text-foreground mt-3">Agente de Categorias:</p>
          <p>Se forem encontradas categorias/grupos, abre automaticamente um diálogo para selecionar as categorias a explorar. Opções:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Explorar categorias</strong> — navega dentro das categorias para encontrar links de produto</li>
            <li><strong className="text-foreground">Explorar + Correr Produtos</strong> — encontra produtos e inicia a extração automaticamente</li>
          </ul>

          <p className="font-medium text-foreground mt-3">Paginação:</p>
          <p>O sistema deteta automaticamente links de paginação. Pode seguir uma página de cada vez ou clicar <strong className="text-foreground">"Seguir Toda a Paginação"</strong> para percorrer até 50 páginas automaticamente.</p>

          <p className="font-medium text-foreground mt-3">Multi-Camada (Drilling):</p>
          <p>Pode explorar categorias em profundidade — cada nível cria uma nova camada com breadcrumbs para voltar atrás.</p>
        </Section>

        <Section icon={Crosshair} title="Passo 4 — Selecionar Campos de Extração">
          <p>Neste modo, clique directamente nos elementos da página para definir os campos que deseja extrair.</p>
          <p><strong className="text-foreground">Para cada campo capturado, pode:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Renomear</strong> — altere o nome do campo (ex: "Campo 1" → "Título")</li>
            <li><strong className="text-foreground">Alterar tipo</strong> — Texto, Imagem, Link ou HTML</li>
            <li><strong className="text-foreground">Editar seletor CSS</strong> — ajuste o seletor manualmente (campo monospace)</li>
            <li><strong className="text-foreground">Marcar como Variação</strong> — extrai múltiplos valores separados por "|" (ex: cores, tamanhos)</li>
            <li><strong className="text-foreground">Remover</strong> — elimine campos não desejados</li>
          </ul>

          <Tip>Use o botão "Auto-detetar Campos" (<Wand2 className="w-3 h-3 inline" />) para que o sistema identifique automaticamente campos comuns (título, preço, SKU, imagens, especificações, etc.) usando seletores conhecidos de WooCommerce, Drupal e outros CMS.</Tip>

          <p className="font-medium text-foreground mt-3">Campos auto-detetáveis:</p>
          <div className="grid grid-cols-3 gap-1 mt-1">
            {["Título", "Modelo", "Gama", "Referência/SKU", "Preço", "Preço Original", "Descrição", "Imagem Principal", "Galeria Imagens", "Características", "Benefícios", "Capacidade", "Categoria", "Marca", "Peso", "Dimensões", "Stock", "Variações", "EAN/GTIN", "Documentos/PDF"].map(f => (
              <Badge key={f} variant="secondary" className="text-[10px] justify-center">{f}</Badge>
            ))}
          </div>

          <p className="font-medium text-foreground mt-3">Adicionar campos manualmente:</p>
          <p>Na área de links (Passo 3), pode adicionar campos com o botão <strong className="text-foreground">"+ Adicionar Campo"</strong> e escrever o seletor CSS directamente.</p>
        </Section>

        <Section icon={Play} title="Passo 5 — Confirmar e Extrair">
          <p>Antes de iniciar a extração em lote, o sistema mostra um resumo:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Número de páginas de produto selecionadas</li>
            <li>Campos configurados (com indicação de variações)</li>
            <li>Modo de custo (Gratuito vs. Premium/Firecrawl)</li>
          </ul>
          <p>Clique <strong className="text-foreground">"Extrair Dados"</strong> para iniciar. O sistema processa em lotes de 5 páginas com indicação de progresso.</p>
          <Tip>A extração é feita por um edge function ("scrape-with-selectors") que aplica os seletores CSS definidos a cada página.</Tip>
        </Section>

        <Section icon={Download} title="Passo 6 — Resultados e Exportação">
          <p>Após a extração, visualize os resultados numa tabela interactiva. Ações disponíveis:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Exportar Excel</strong> — descarrega um ficheiro .xlsx com todos os dados</li>
            <li><strong className="text-foreground">Enviar para Ingestão</strong> — cria um job de ingestão com mapeamento de campos</li>
          </ul>
          <p className="font-medium text-foreground mt-3">Mapeamento para Produtos:</p>
          <p>Ao enviar para ingestão, deve mapear cada campo extraído para o campo correspondente do produto (título, descrição, preço, SKU, etc.). O título é obrigatório. Pode ignorar campos não relevantes.</p>
        </Section>

        <Section icon={Coins} title="Modos de Custo">
          <p>O Visual Scraper oferece dois modos de operação:</p>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <Card className="p-3 border-emerald-300">
              <p className="text-xs font-semibold text-emerald-600 flex items-center gap-1"><Coins className="w-3 h-3" /> Gratuito (Fetch)</p>
              <p className="text-[10px] mt-1">Usa fetch HTTP simples via proxy. Funciona para a maioria dos sites. Sem custo adicional.</p>
            </Card>
            <Card className="p-3 border-amber-300">
              <p className="text-xs font-semibold text-amber-600 flex items-center gap-1"><Zap className="w-3 h-3" /> Premium (Firecrawl)</p>
              <p className="text-[10px] mt-1">Renderiza JavaScript, contorna bloqueios anti-bot. Necessário para SPAs e sites protegidos. Gasta créditos.</p>
            </Card>
          </div>
          <Tip>Comece sempre no modo Gratuito. Só mude para Premium se a página não carregar correctamente ou os dados estiverem em falta.</Tip>
        </Section>
      </div>

      <Separator />

      {/* ═══════════ WEBSITE EXTRACTION AGENT ═══════════ */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-primary">
          <Brain className="w-6 h-6" />
          2. Website Extraction Agent — Guia Completo
        </h2>

        <p className="text-sm text-muted-foreground">O agente opera em modo enterprise, com um fluxo controlado de 4 fases para minimizar custos e maximizar precisão.</p>

        <Section icon={Settings2} title="Fase 0 — Setup">
          <p><strong className="text-foreground">Configuração inicial:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Selecionar configuração existente</strong> — se já extraiu deste fornecedor, selecione a configuração para reutilizar padrões aprendidos</li>
            <li><strong className="text-foreground">Criar nova configuração</strong> — defina o domínio e nome do fornecedor</li>
            <li><strong className="text-foreground">Inserir URL</strong> — URL do site do fornecedor</li>
            <li><strong className="text-foreground">Escolher modo</strong> — Gratuito (fetch) ou Premium (Firecrawl)</li>
          </ul>
          <p className="mt-2">Clique <strong className="text-foreground">"Iniciar Discovery"</strong> para começar.</p>
        </Section>

        <Section icon={Search} title="Fase A — Discovery">
          <p>O agente explora o site e classifica automaticamente as páginas encontradas:</p>
          <div className="flex flex-wrap gap-2 my-2">
            <Badge className="bg-emerald-500/10 text-emerald-600 text-[10px]">Produto</Badge>
            <Badge className="bg-blue-500/10 text-blue-600 text-[10px]">Categoria</Badge>
            <Badge className="bg-amber-500/10 text-amber-600 text-[10px]">Pesquisa</Badge>
            <Badge className="bg-purple-500/10 text-purple-600 text-[10px]">Documento</Badge>
            <Badge className="bg-muted text-muted-foreground text-[10px]">Desconhecido</Badge>
          </div>
          <p><strong className="text-foreground">Dashboard de discovery:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Contagem total de links por tipo</li>
            <li>Classificação da página alvo com confidence score</li>
            <li>Lista de todas as páginas descobertas com checkbox para seleção</li>
            <li>Botão "Selecionar Produtos" para selecionar automaticamente todas as páginas de produto</li>
          </ul>
          <p className="mt-2"><strong className="text-foreground">Sinais usados para classificação:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Schema.org (Product, BreadcrumbList)</li>
            <li>Presença de preço, SKU, botão "Add to Cart"</li>
            <li>Padrões de URL (/product/, /p/, etc.)</li>
            <li>Tabelas de especificações técnicas</li>
          </ul>
        </Section>

        <Section icon={Target} title="Fase B — Teste de Extração">
          <p>Selecione o tamanho da amostra para testar:</p>
          <div className="flex gap-2 my-2">
            <Badge variant="outline" className="text-[10px]">1 página</Badge>
            <Badge variant="outline" className="text-[10px]">5 páginas</Badge>
            <Badge variant="outline" className="text-[10px]">10 páginas</Badge>
          </div>
          <p>O agente extrai automaticamente os seguintes campos (quando encontrados):</p>
          <div className="grid grid-cols-3 gap-1 mt-2">
            {[
              "Nome do Produto", "SKU / Referência", "Ref. Fornecedor", "Marca",
              "Preço", "Descrição", "Descrição Curta", "Imagens",
              "Especificações", "Atributos", "Downloads", "Acessórios", "Categorias"
            ].map(f => (
              <Badge key={f} variant="secondary" className="text-[10px] justify-center">{f}</Badge>
            ))}
          </div>
          <Tip>O agente prioriza JSON-LD e parsing DOM/Regex antes de recorrer a IA, minimizando custos.</Tip>
        </Section>

        <Section icon={Eye} title="Fase C — Preview Estruturado">
          <p>Após o teste, o sistema mostra um preview completo com:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Tabela de resumo</strong> — Nome, SKU, Preço, Specs, Imagens e Confiança por página</li>
            <li><strong className="text-foreground">Métricas globais</strong> — total processado, confiança média, warnings e erros</li>
            <li><strong className="text-foreground">Detalhe por página</strong> — todos os campos extraídos com confidence score individual</li>
            <li><strong className="text-foreground">Separador de Avisos</strong> — lista de warnings por página</li>
          </ul>
          <p className="mt-2"><strong className="text-foreground">Confidence Score:</strong></p>
          <div className="flex gap-3 my-1">
            <span className="text-xs"><span className="text-emerald-600 font-bold">≥80%</span> — Alta confiança</span>
            <span className="text-xs"><span className="text-amber-600 font-bold">50-79%</span> — Confiança moderada</span>
            <span className="text-xs"><span className="text-destructive font-bold">&lt;50%</span> — Baixa confiança</span>
          </div>
        </Section>

        <Section icon={Zap} title="Fase D — Escalar">
          <p>Só após validar o preview pode escalar a extração para todas as páginas de produto descobertas.</p>
          <p>Clique <strong className="text-foreground">"Escalar (N produtos)"</strong> para processar todas as páginas de produto em lote.</p>
          <Tip>Antes de escalar, pode guardar os padrões aprendidos clicando "Guardar Padrões". Isto permite que futuras extrações do mesmo fornecedor sejam mais rápidas e precisas.</Tip>
        </Section>

        <Section icon={Brain} title="Memória e Aprendizagem">
          <p>O agente mantém uma memória por fornecedor/domínio que inclui:</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong className="text-foreground">Seletores validados</strong> — CSS selectors que funcionaram com alta confiança</li>
            <li><strong className="text-foreground">Padrões de URL</strong> — estruturas de URL típicas de produto para este domínio</li>
            <li><strong className="text-foreground">Mapeamentos de campo</strong> — associações campo → valor que tiveram sucesso</li>
            <li><strong className="text-foreground">Estatísticas</strong> — páginas descobertas, produtos extraídos, seletores aprendidos</li>
          </ul>
          <p className="mt-2">Aceda à memória clicando no botão <strong className="text-foreground">"Memória"</strong> (<Brain className="w-3 h-3 inline" />) no topo da página.</p>
          <Tip>Quanto mais extrações fizer de um fornecedor, mais inteligente o agente se torna. Os padrões são reutilizados automaticamente em futuras sessões.</Tip>
        </Section>
      </div>

      <Separator />

      {/* ═══════════ COMPARAÇÃO ═══════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quando usar cada ferramenta?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Cenário</th>
                  <th className="text-center py-2 px-4 font-medium">Visual Scraper</th>
                  <th className="text-center py-2 px-4 font-medium">Website Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[
                  ["Primeiro scrape de um fornecedor desconhecido", "✅ Recomendado", "✅ Recomendado"],
                  ["Site com layout complexo ou dinâmico", "✅ Controlo total", "⚠️ Pode precisar Premium"],
                  ["Extração recorrente do mesmo fornecedor", "⚠️ Manual cada vez", "✅ Reutiliza padrões"],
                  ["Grande volume de produtos (100+)", "✅ Funcional", "✅ Mais eficiente"],
                  ["Necessidade de ajustar seletores CSS", "✅ Editor visual + manual", "❌ Automático apenas"],
                  ["Campos não-standard ou custom", "✅ Flexível", "⚠️ Campos predefinidos"],
                  ["Preview e validação antes de escalar", "✅ Passo a passo", "✅ Fase de preview dedicada"],
                  ["Exportar para Excel", "✅ Suportado", "❌ Via pipeline"],
                  ["Enviar directo para pipeline de ingestão", "✅ Com mapeamento", "✅ Automático"],
                  ["Aprendizagem contínua por fornecedor", "❌ Não disponível", "✅ Memória persistente"],
                ].map(([scenario, visual, agent], i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4 text-muted-foreground">{scenario}</td>
                    <td className="py-2 px-4 text-center">{visual}</td>
                    <td className="py-2 px-4 text-center">{agent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* ═══════════ FAQ ═══════════ */}
      <Section icon={AlertTriangle} title="Problemas Comuns e Soluções">
        <div className="space-y-3">
          {[
            {
              q: "A página não carrega ou mostra conteúdo em branco",
              a: "Active o modo Premium (Firecrawl). O site pode exigir JavaScript ou ter proteção anti-bot."
            },
            {
              q: "Os links extraídos são apenas do rodapé/menu",
              a: "O sistema filtra automaticamente navegação e rodapé. Se persistir, verifique se o conteúdo principal está dentro de um <main> ou container identificável."
            },
            {
              q: "A auto-deteção de campos não encontra nada",
              a: "O site pode usar classes CSS não-standard. Use o modo de seleção visual (clique nos elementos) ou adicione campos manualmente com os seletores CSS correctos."
            },
            {
              q: "Os dados extraídos estão incompletos",
              a: "Verifique o seletor CSS do campo — pode ser demasiado restritivo. Teste com seletores mais genéricos. Para imagens, o sistema já procura recursivamente em containers."
            },
            {
              q: "Erro WORKER_LIMIT ou timeout",
              a: "Reduza o número de páginas por lote. O sistema já processa em chunks de 5 páginas, mas sites lentos podem precisar de chunks menores."
            },
            {
              q: "Confidence score baixo no Website Agent",
              a: "Indica que o agente não tem certeza sobre os dados extraídos. Valide manualmente e guarde os padrões correctos para melhorar futuras extrações."
            },
          ].map((item, i) => (
            <div key={i} className="p-3 border rounded-lg">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-500" /> {item.q}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{item.a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Footer */}
      <Card className="bg-muted/30">
        <CardContent className="py-4 text-center text-xs text-muted-foreground">
          <p>Este manual cobre as funcionalidades actuais das ferramentas de scraping.</p>
          <p className="mt-1">Para dúvidas adicionais, contacte a equipa de suporte.</p>
        </CardContent>
      </Card>
    </div>
  );
}
