import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider } from "@/hooks/useAuth";
import { useAuth } from "@/hooks/auth-context";
import { useCurrentUserProfile } from "@/hooks/useUserManagement";
import { WorkspaceProvider } from "@/hooks/useWorkspaces";
import { PendingApproval } from "@/components/PendingApproval";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Loader2 } from "lucide-react";

// Eager — críticos para boot/auth/landing
import Index from "./pages/Index";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import PublicLandingPage from "./pages/PublicLandingPage";

// Lazy — todas as restantes páginas (carregam on-demand)
const UploadPage = lazy(() => import("./pages/UploadPage"));
const ProductsPage = lazy(() => import("./pages/ProductsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const WorkspaceMembersPage = lazy(() => import("./pages/WorkspaceMembersPage"));
const CategoriesPage = lazy(() => import("./pages/CategoriesPage"));
const VariationsPage = lazy(() => import("./pages/VariationsPage"));
const WooImportPage = lazy(() => import("./pages/WooImportPage"));
const ImagesPage = lazy(() => import("./pages/ImagesPage"));
const ReviewQueuePage = lazy(() => import("./pages/ReviewQueuePage"));
const IngestionHubPage = lazy(() => import("./pages/IngestionHubPage"));
const AssetLibraryPage = lazy(() => import("./pages/AssetLibraryPage"));
const PDFExtractionPage = lazy(() => import("./pages/PDFExtractionPage"));
const ExtractionMemoryPage = lazy(() => import("./pages/ExtractionMemoryPage"));
const TranslationMemoryPage = lazy(() => import("./pages/TranslationMemoryPage"));
const ChannelManagerPage = lazy(() => import("./pages/ChannelManagerPage"));
const CommerceIntelligencePage = lazy(() => import("./pages/CommerceIntelligencePage"));
const AgentControlCenterPage = lazy(() => import("./pages/AgentControlCenterPage"));
const CatalogBrainPage = lazy(() => import("./pages/CatalogBrainPage"));
const BrainDecisionEnginePage = lazy(() => import("./pages/BrainDecisionEnginePage"));
const BrainLearningEnginePage = lazy(() => import("./pages/BrainLearningEnginePage"));
const BrainSimulationPage = lazy(() => import("./pages/BrainSimulationPage"));
const DigitalTwinPage = lazy(() => import("./pages/DigitalTwinPage"));
const MarketIntelligencePage = lazy(() => import("./pages/MarketIntelligencePage"));
const RevenueAndDemandPage = lazy(() => import("./pages/RevenueAndDemandPage"));
const StrategicPlannerPage = lazy(() => import("./pages/StrategicPlannerPage"));
const AutonomousCommercePage = lazy(() => import("./pages/AutonomousCommercePage"));
const OrchestrationPage = lazy(() => import("./pages/OrchestrationPage"));
const SourcePriorityPage = lazy(() => import("./pages/SourcePriorityPage"));
const PromptGovernancePage = lazy(() => import("./pages/PromptGovernancePage"));
const AgentRegistryPage = lazy(() => import("./pages/AgentRegistryPage"));
const ProductIdentityPage = lazy(() => import("./pages/ProductIdentityPage"));
const AiProviderCenterPage = lazy(() => import("./pages/AiProviderCenterPage"));
const SupplierIntelligencePage = lazy(() => import("./pages/SupplierIntelligencePage"));
const CanonicalAssemblyPage = lazy(() => import("./pages/CanonicalAssemblyPage"));
const ConflictCenterPage = lazy(() => import("./pages/ConflictCenterPage"));
const ChannelPayloadBuilderPage = lazy(() => import("./pages/ChannelPayloadBuilderPage"));
const ExecutionPlannerPage = lazy(() => import("./pages/ExecutionPlannerPage"));
const CostDashboardPage = lazy(() => import("./pages/CostDashboardPage"));
const CatalogOperationsControlTowerPage = lazy(() => import("./pages/CatalogOperationsControlTowerPage"));
const SupplierPlaybooksPage = lazy(() => import("./pages/SupplierPlaybooksPage"));
const AgentRuntimeConsolePage = lazy(() => import("./pages/AgentRuntimeConsolePage"));
const CatalogWorkflowCenterPage = lazy(() => import("./pages/CatalogWorkflowCenterPage"));
const VisualScraperPage = lazy(() => import("./pages/VisualScraperPage"));
const WebsiteExtractionAgentPage = lazy(() => import("./pages/WebsiteExtractionAgentPage"));
const ScraperManualPage = lazy(() => import("./pages/ScraperManualPage"));
const AiComparisonHistoryPage = lazy(() => import("./pages/AiComparisonHistoryPage"));
const CategoryArchitectPage = lazy(() => import("./pages/CategoryArchitectPage"));
const SeoLifecyclePage = lazy(() => import("./pages/SeoLifecyclePage"));
const IntelligenceDashboardPage = lazy(() => import("./pages/IntelligenceDashboardPage"));

const PageFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds default for all queries
      retry: 1,
    },
  },
});

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    if (location.pathname === "/") {
      return <PublicLandingPage />;
    }

    return <Navigate to="/login" replace />;
  }

  return (
    <WorkspaceProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/produtos" element={<ProductsPage />} />
            <Route path="/variacoes" element={<VariationsPage />} />
            <Route path="/categorias" element={<CategoriesPage />} />
            <Route path="/category-architect" element={<CategoryArchitectPage />} />
            <Route path="/importar-woo" element={<WooImportPage />} />
            <Route path="/seo-lifecycle" element={<SeoLifecyclePage />} />
            <Route path="/imagens" element={<ImagesPage />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
            <Route path="/membros" element={<WorkspaceMembersPage />} />
            <Route path="/revisao" element={<ReviewQueuePage />} />
            <Route path="/ingestao" element={<IngestionHubPage />} />
            <Route path="/assets" element={<AssetLibraryPage />} />
            <Route path="/pdf-extraction" element={<PDFExtractionPage />} />
            <Route path="/extraction-memory" element={<ExtractionMemoryPage />} />
            <Route path="/traducoes" element={<TranslationMemoryPage />} />
            <Route path="/canais" element={<ChannelManagerPage />} />
            <Route path="/inteligencia" element={<CommerceIntelligencePage />} />
            <Route path="/command-center" element={<IntelligenceDashboardPage />} />
            <Route path="/agentes" element={<AgentControlCenterPage />} />
            <Route path="/brain" element={<CatalogBrainPage />} />
            <Route path="/decisoes" element={<BrainDecisionEnginePage />} />
            <Route path="/aprendizagem" element={<BrainLearningEnginePage />} />
            <Route path="/simulacao" element={<BrainSimulationPage />} />
            <Route path="/digital-twin" element={<DigitalTwinPage />} />
            <Route path="/market-intelligence" element={<MarketIntelligencePage />} />
            <Route path="/revenue-demand" element={<RevenueAndDemandPage />} />
            <Route path="/strategic-planner" element={<StrategicPlannerPage />} />
            <Route path="/autonomous-commerce" element={<AutonomousCommercePage />} />
            <Route path="/orquestracao" element={<OrchestrationPage />} />
            <Route path="/source-priority" element={<SourcePriorityPage />} />
            <Route path="/prompt-governance" element={<PromptGovernancePage />} />
            <Route path="/agent-registry" element={<AgentRegistryPage />} />
            <Route path="/product-identity" element={<ProductIdentityPage />} />
            <Route path="/ai-governance" element={<Navigate to="/ai-provider-center" replace />} />
            <Route path="/ai-provider-center" element={<AiProviderCenterPage />} />
            <Route path="/supplier-intelligence" element={<SupplierIntelligencePage />} />
            <Route path="/canonical-assembly" element={<CanonicalAssemblyPage />} />
            <Route path="/conflict-center" element={<ConflictCenterPage />} />
            <Route path="/channel-payloads" element={<ChannelPayloadBuilderPage />} />
            <Route path="/execution-planner" element={<ExecutionPlannerPage />} />
            <Route path="/cost-intelligence" element={<CostDashboardPage />} />
            <Route path="/control-tower" element={<CatalogOperationsControlTowerPage />} />
            <Route path="/supplier-playbooks" element={<SupplierPlaybooksPage />} />
            <Route path="/agent-runtime" element={<AgentRuntimeConsolePage />} />
            <Route path="/workflow-center" element={<CatalogWorkflowCenterPage />} />
            <Route path="/visual-scraper" element={<VisualScraperPage />} />
            <Route path="/website-agent" element={<WebsiteExtractionAgentPage />} />
            <Route path="/scraper-manual" element={<ScraperManualPage />} />
            <Route path="/ai-comparacoes" element={<AiComparisonHistoryPage />} />
            <Route path="/admin/utilizadores" element={<AdminUsersPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </WorkspaceProvider>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;
  return <AuthPage />;
}

const App = () => (
  <ErrorBoundary fallbackMessage="Ocorreu um erro na aplicação. Recarregue para continuar.">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<AuthRoute />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
