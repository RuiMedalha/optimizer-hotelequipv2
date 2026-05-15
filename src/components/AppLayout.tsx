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
      <main className="flex-1 overflow-auto min-w-0 min-h-screen flex flex-col">
        {/* Top Header / Navbar */}
        <header className="sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-background/95 backdrop-blur border-b">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors lg:hidden"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-xs">HE</span>
              </div>
              <span className="font-semibold text-sm hidden sm:inline-block">Hotelequip</span>
            </div>
          </div>

          {activeWorkspace && (
            <div className="flex items-center gap-2 bg-primary/5 px-3 py-1 rounded-full border border-primary/10">
              <FolderOpen className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-bold text-primary truncate max-w-[150px] sm:max-w-none">
                {activeWorkspace.name}
              </span>
              <Badge variant="secondary" className="hidden xs:flex text-[8px] h-4 px-1 bg-primary text-primary-foreground border-none">ACTIVO</Badge>
            </div>
          )}

          <div className="w-10 lg:hidden" /> {/* Spacer for symmetry on mobile */}
        </header>

        {/* Session banner on data pages */}
        {showBanner && <WorkflowSessionBanner />}

        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
