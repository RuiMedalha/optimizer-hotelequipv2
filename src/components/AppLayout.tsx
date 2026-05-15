import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { WorkflowSessionBanner } from "./WorkflowSessionBanner";
import { Menu, X, FolderOpen } from "lucide-react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";

const SESSION_ROUTES = [
  "/woo-import",
  "/upload",
  "/products",
  "/images",
  "/variations",
  "/review-queue",
  "/ingestion",
  "/pdf-extraction",
];

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { activeWorkspace } = useWorkspaceContext();
  const location = useLocation();
  const showBanner = SESSION_ROUTES.some((r) => location.pathname.startsWith(r));

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 lg:relative lg:z-auto transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <AppSidebar onNavigate={() => setMobileOpen(false)} />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0 min-h-screen">
        {/* Mobile header */}
        <div className="sticky top-0 z-30 flex items-center gap-3 px-4 h-14 bg-background/95 backdrop-blur border-b lg:hidden">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">HE</span>
            </div>
            <span className="font-semibold text-sm">Hotelequip</span>
          </div>
        </div>

        {/* Session banner on data pages */}
        {showBanner && <WorkflowSessionBanner />}

        <Outlet />
      </main>
    </div>
  );
}
