import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useCurrentUserProfile } from "@/hooks/useUserManagement";
import { WorkspaceProvider } from "@/hooks/useWorkspaces";
import { PendingApproval } from "@/components/PendingApproval";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import UploadPage from "./pages/UploadPage";
import ProductsPage from "./pages/ProductsPage";
import SettingsPage from "./pages/SettingsPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import WorkspaceMembersPage from "./pages/WorkspaceMembersPage";
import CategoriesPage from "./pages/CategoriesPage";
import VariationsPage from "./pages/VariationsPage";
import WooImportPage from "./pages/WooImportPage";
import ImagesPage from "./pages/ImagesPage";
import ReviewQueuePage from "./pages/ReviewQueuePage";
import IngestionHubPage from "./pages/IngestionHubPage";
import AssetLibraryPage from "./pages/AssetLibraryPage";
import PDFExtractionPage from "./pages/PDFExtractionPage";
import ExtractionMemoryPage from "./pages/ExtractionMemoryPage";
import TranslationMemoryPage from "./pages/TranslationMemoryPage";
import ChannelManagerPage from "./pages/ChannelManagerPage";
import CommerceIntelligencePage from "./pages/CommerceIntelligencePage";
import AgentControlCenterPage from "./pages/AgentControlCenterPage";
import CatalogBrainPage from "./pages/CatalogBrainPage";
import BrainDecisionEnginePage from "./pages/BrainDecisionEnginePage";
import BrainLearningEnginePage from "./pages/BrainLearningEnginePage";
import BrainSimulationPage from "./pages/BrainSimulationPage";
import DigitalTwinPage from "./pages/DigitalTwinPage";
import MarketIntelligencePage from "./pages/MarketIntelligencePage";
import RevenueAndDemandPage from "./pages/RevenueAndDemandPage";
import StrategicPlannerPage from "./pages/StrategicPlannerPage";
import AutonomousCommercePage from "./pages/AutonomousCommercePage";
import OrchestrationPage from "./pages/OrchestrationPage";
import SourcePriorityPage from "./pages/SourcePriorityPage";
import PromptGovernancePage from "./pages/PromptGovernancePage";
import AgentRegistryPage from "./pages/AgentRegistryPage";
import ProductIdentityPage from "./pages/ProductIdentityPage";
import AiGovernancePage from "./pages/AiGovernancePage";
import AiProviderCenterPage from "./pages/AiProviderCenterPage";
import SupplierIntelligencePage from "./pages/SupplierIntelligencePage";
import CanonicalAssemblyPage from "./pages/CanonicalAssemblyPage";
import ConflictCenterPage from "./pages/ConflictCenterPage";
import ChannelPayloadBuilderPage from "./pages/ChannelPayloadBuilderPage";
import ExecutionPlannerPage from "./pages/ExecutionPlannerPage";
import CostDashboardPage from "./pages/CostDashboardPage";
import CatalogOperationsControlTowerPage from "./pages/CatalogOperationsControlTowerPage";
import SupplierPlaybooksPage from "./pages/SupplierPlaybooksPage";
import AgentRuntimeConsolePage from "./pages/AgentRuntimeConsolePage";
import CatalogWorkflowCenterPage from "./pages/CatalogWorkflowCenterPage";
import VisualScraperPage from "./pages/VisualScraperPage";
import WebsiteExtractionAgentPage from "./pages/WebsiteExtractionAgentPage";
import ScraperManualPage from "./pages/ScraperManualPage";
import AiComparisonHistoryPage from "./pages/AiComparisonHistoryPage";
import CategoryArchitectPage from "./pages/CategoryArchitectPage";
import SeoLifecyclePage from "./pages/SeoLifecyclePage";
import IntelligenceDashboardPage from "./pages/IntelligenceDashboardPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import PublicLandingPage from "./pages/PublicLandingPage";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

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
