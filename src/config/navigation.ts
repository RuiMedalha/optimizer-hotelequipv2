import {
  LayoutDashboard,
  ClipboardList,
  UserCog,
  Package,
  GitBranch,
  FolderTree,
  Radio,
  ShoppingCart,
  Upload,
  Database,
  FileText,
  Brain,
  ImageIcon,
  Library,
  Languages,
  TrendingUp,
  Globe,
  Bot,
  Sparkles,
  Target,
  GraduationCap,
  FlaskConical,
  Copy,
  Settings,
  DollarSign,
  Map,
  Zap,
  Workflow,
  ArrowDownUp,
  FileCode,
  Cpu,
  Fingerprint,
  Gauge,
  Building2,
  Layers,
  Scale,
  Send,
  BookOpen,
  Terminal,
  Route,
  TowerControl,
  GitMerge,
  GitCompare,
  MousePointerClick,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  icon: LucideIcon;
  route: string;
  badge?: string;
  featureFlag?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  defaultOpen?: boolean;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    key: "gestao",
    label: "Gestão",
    icon: LayoutDashboard,
    defaultOpen: true,
    items: [
      { title: "Dashboard", icon: LayoutDashboard, route: "/" },
      { title: "Control Tower", icon: TowerControl, route: "/control-tower" },
      { title: "Revisão", icon: ClipboardList, route: "/revisao" },
      { title: "Membros", icon: UserCog, route: "/membros" },
    ],
  },
  {
    key: "catalogo",
    label: "Catálogo",
    icon: Package,
    defaultOpen: true,
    items: [
      { title: "Produtos", icon: Package, route: "/produtos" },
      { title: "Variações", icon: GitBranch, route: "/variacoes" },
      { title: "Categorias", icon: FolderTree, route: "/categorias" },
      { title: "Category Architect", icon: Wand2, route: "/category-architect" },
      { title: "SEO Lifecycle", icon: Shield, route: "/seo-lifecycle" },
      { title: "Canais", icon: Radio, route: "/canais" },
      { title: "Importar WooCommerce", icon: ShoppingCart, route: "/importar-woo" },
    ],
  },
  {
    key: "ingestao",
    label: "Ingestão",
    icon: Database,
    items: [
      { title: "Upload", icon: Upload, route: "/upload" },
      { title: "Ingestion Hub", icon: Database, route: "/ingestao" },
      { title: "Website Agent", icon: Bot, route: "/website-agent" },
      { title: "Visual Scraper", icon: MousePointerClick, route: "/visual-scraper" },
      { title: "Manual Scraper", icon: BookOpen, route: "/scraper-manual" },
      { title: "Extração PDF", icon: FileText, route: "/pdf-extraction" },
      { title: "Memória de Extração", icon: Brain, route: "/extraction-memory" },
    ],
  },
  {
    key: "conteudo",
    label: "Conteúdo & Media",
    icon: ImageIcon,
    items: [
      { title: "Imagens", icon: ImageIcon, route: "/imagens" },
      { title: "Asset Library", icon: Library, route: "/assets" },
      { title: "Tradução & i18n", icon: Languages, route: "/traducoes" },
    ],
  },
  {
    key: "inteligencia",
    label: "Inteligência",
    icon: TrendingUp,
    items: [
      { title: "Commerce Intelligence", icon: TrendingUp, route: "/inteligencia" },
      { title: "Market Intelligence", icon: Globe, route: "/market-intelligence" },
      { title: "Revenue & Demand", icon: DollarSign, route: "/revenue-demand" },
      { title: "Strategic Planner", icon: Map, route: "/strategic-planner" },
      { title: "Autonomous Commerce", icon: Zap, route: "/autonomous-commerce" },
    ],
  },
  {
    key: "agentes",
    label: "Agentes AI",
    icon: Bot,
    items: [
      { title: "Agentes AI", icon: Bot, route: "/agentes" },
      { title: "Agent Registry", icon: Cpu, route: "/agent-registry" },
      { title: "Agent Runtime", icon: Terminal, route: "/agent-runtime" },
      { title: "Orquestração AI", icon: Workflow, route: "/orquestracao" },
      { title: "Workflow Center", icon: GitMerge, route: "/workflow-center" },
      { title: "Execution Planner", icon: Route, route: "/execution-planner" },
    ],
  },
  {
    key: "brain",
    label: "Catalog Brain",
    icon: Sparkles,
    items: [
      { title: "Catalog Brain", icon: Sparkles, route: "/brain" },
      { title: "Decision Engine", icon: Target, route: "/decisoes" },
      { title: "Learning Engine", icon: GraduationCap, route: "/aprendizagem" },
      { title: "Simulation Engine", icon: FlaskConical, route: "/simulacao" },
      { title: "Digital Twin", icon: Copy, route: "/digital-twin" },
    ],
  },
  {
    key: "dados",
    label: "Dados & Qualidade",
    icon: Layers,
    items: [
      { title: "Product Identity", icon: Fingerprint, route: "/product-identity" },
      { title: "Canonical Assembly", icon: Layers, route: "/canonical-assembly" },
      { title: "Source Priority", icon: ArrowDownUp, route: "/source-priority" },
      { title: "Conflict Center", icon: Scale, route: "/conflict-center" },
      { title: "Channel Payloads", icon: Send, route: "/channel-payloads" },
    ],
  },
  {
    key: "governance",
    label: "AI Governance",
    icon: Gauge,
    items: [
      { title: "AI Provider Center", icon: Cpu, route: "/ai-provider-center", badge: "Core" },
      { title: "Prompt Governance", icon: FileCode, route: "/prompt-governance" },
      { title: "Cost Intelligence", icon: DollarSign, route: "/cost-intelligence" },
      { title: "Comparações IA", icon: GitCompare, route: "/ai-comparacoes" },
      { title: "Supplier Intelligence", icon: Building2, route: "/supplier-intelligence" },
      { title: "Supplier Playbooks", icon: BookOpen, route: "/supplier-playbooks" },
    ],
  },
  {
    key: "sistema",
    label: "Sistema",
    icon: Settings,
    items: [
      { title: "Configurações", icon: Settings, route: "/configuracoes" },
    ],
  },
];
