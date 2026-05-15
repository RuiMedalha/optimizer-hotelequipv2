import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  FolderOpen,
  Check,
  Pencil,
  Trash2,
  Merge,
  MoreHorizontal,
  Plus,
  ChevronDown,
  Copy,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/auth-context";
import { useCurrentUserProfile } from "@/hooks/useUserManagement";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useOptimizationJob } from "@/hooks/useOptimizationJob";
import { usePublishJob } from "@/hooks/usePublishJob";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { navGroups, type NavGroup } from "@/config/navigation";
import { getStorageJson, setStorageItem } from "@/lib/safeStorage";

const STORAGE_KEY = "sidebar-groups-state";

function loadGroupState(): Record<string, boolean> {
  return getStorageJson<Record<string, boolean>>(STORAGE_KEY, {});
}

function saveGroupState(state: Record<string, boolean>) {
  setStorageItem(STORAGE_KEY, JSON.stringify(state));
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { data: profile } = useCurrentUserProfile();
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspaceId,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    mergeWorkspaces,
    isCreating,
    selectedCount,
  } = useWorkspaceContext();
  const { activeJob } = useOptimizationJob();
  const { activePublishJob } = usePublishJob();

  const [wsToSwitch, setWsToSwitch] = useState<string | null>(null);

  const isProcessing = useMemo(() => {
    return (activeJob && (activeJob.status === "processing" || activeJob.status === "queued")) ||
           (activePublishJob && (activePublishJob.status === "processing" || activePublishJob.status === "queued"));
  }, [activeJob, activePublishJob]);

  const handleWorkspaceSwitch = (id: string) => {
    if (id === activeWorkspace?.id) return;
    setWsToSwitch(id);
  };

  const confirmSwitch = () => {
    if (wsToSwitch) {
      setActiveWorkspaceId(wsToSwitch);
      setWsToSwitch(null);
    }
  };

  const [showNewWs, setShowNewWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [copyFromWsId, setCopyFromWsId] = useState<string>("");
  const [copyOptions, setCopyOptions] = useState({ providers: true, routing: true, prompts: true, categories: false });
  const [editWs, setEditWs] = useState<{ id: string; name: string } | null>(null);
  const [deleteWs, setDeleteWs] = useState<{ id: string; name: string } | null>(null);
  const [mergeWs, setMergeWs] = useState<{ sourceId: string; sourceName: string } | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");
  const [copyToWs, setCopyToWs] = useState<{ id: string; name: string } | null>(null);
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [copyToOptions, setCopyToOptions] = useState({ providers: true, routing: true, prompts: true, categories: false });

  // Group open/close state with localStorage persistence
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const saved = loadGroupState();
    const initial: Record<string, boolean> = {};
    navGroups.forEach((g) => {
      initial[g.key] = saved[g.key] !== undefined ? saved[g.key] : (g.defaultOpen ?? false);
    });
    return initial;
  });

  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveGroupState(next);
      return next;
    });
  }, []);

  // Auto-open group containing active route
  useEffect(() => {
    const activeGroup = navGroups.find((g) =>
      g.items.some((item) => {
        if (item.route === "/") return location.pathname === "/";
        return location.pathname.startsWith(item.route);
      })
    );
    if (activeGroup && !openGroups[activeGroup.key]) {
      setOpenGroups((prev) => {
        const next = { ...prev, [activeGroup.key]: true };
        saveGroupState(next);
        return next;
      });
    }
  }, [location.pathname]);

  const isRouteActive = (route: string) => {
    if (route === "/") return location.pathname === "/";
    return location.pathname === route;
  };

  const handleCreateWorkspace = async () => {
    if (newWsName.trim()) {
      const sourceId = copyFromWsId && copyFromWsId !== "none" ? copyFromWsId : undefined;
      createWorkspace(newWsName.trim(), undefined, sourceId, sourceId ? copyOptions : undefined);
      setNewWsName("");
      setCopyFromWsId("");
      setCopyOptions({ providers: true, routing: true, prompts: true, categories: false });
      setShowNewWs(false);
    }
  };

  const handleEditWorkspace = () => {
    if (editWs && editWs.name.trim()) {
      updateWorkspace(editWs.id, editWs.name.trim());
      setEditWs(null);
    }
  };

  const handleDeleteWorkspace = () => {
    if (deleteWs) {
      deleteWorkspace(deleteWs.id);
      setDeleteWs(null);
    }
  };

  const handleMergeWorkspaces = () => {
    if (mergeWs && mergeTargetId) {
      mergeWorkspaces(mergeWs.sourceId, mergeTargetId);
      setMergeWs(null);
      setMergeTargetId("");
    }
  };

  const handleCopyConfigToWorkspace = async () => {
    if (!copyToWs || !copySourceId || copySourceId === "none") return;
    const anyCopy = copyToOptions.providers || copyToOptions.routing || copyToOptions.prompts || copyToOptions.categories;
    if (!anyCopy) { toast.error("Selecione pelo menos uma opção para copiar."); return; }
    try {
      const { data: copyResult, error: copyError } = await supabase.functions.invoke("copy-workspace-config", {
        body: {
          sourceWorkspaceId: copySourceId,
          targetWorkspaceId: copyToWs.id,
          copyProviders: copyToOptions.providers,
          copyRouting: copyToOptions.routing,
          copyPrompts: copyToOptions.prompts,
          copyCategories: copyToOptions.categories,
        },
      });
      if (copyError) throw copyError;
      const s = copyResult?.stats;
      if (s) {
        const parts: string[] = [];
        if (s.providers > 0) parts.push(`${s.providers} providers`);
        if (s.routing > 0) parts.push(`${s.routing} regras`);
        if (s.prompts > 0) parts.push(`${s.prompts} prompts`);
        if (s.categories > 0) parts.push(`${s.categories} categorias`);
        toast.success(parts.length > 0 ? `Copiado para "${copyToWs.name}": ${parts.join(", ")}` : "Nenhum item encontrado para copiar.");
      }
    } catch (err: any) {
      toast.error(`Erro ao copiar: ${err.message || "desconhecido"}`);
    }
    setCopyToWs(null);
    setCopySourceId("");
    setCopyToOptions({ providers: true, routing: true, prompts: true, categories: false });
  };

  return (
    <>
      <aside
        className={cn(
          "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 h-screen sticky top-0",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Header / Branding */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
          {!collapsed ? (
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
                <span className="text-sidebar-primary-foreground font-bold text-sm">HE</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-sidebar-accent-foreground font-semibold text-sm truncate">
                  Hotelequip
                </h1>
                <p className="text-sidebar-muted text-xs truncate">Product Optimizer</p>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center mx-auto">
              <span className="text-sidebar-primary-foreground font-bold text-sm">HE</span>
            </div>
          )}
        </div>

        <div className="px-2 py-2 border-b border-sidebar-border overflow-hidden">
          <div className="px-3 py-2 bg-teal-500/20 border border-teal-500 rounded-md text-xs font-semibold text-teal-400 truncate">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
              </span>
            ) : (
              `✓ ${activeWorkspace?.name || 'Nenhum'}`
            )}
          </div>
        </div>

        {/* Workspace Selector */}
        {!collapsed && (
          <div className="px-2 py-3 border-b border-sidebar-border">
            <p className="text-[10px] uppercase tracking-wider text-sidebar-muted px-3 mb-1.5 font-medium">
              Workspaces
            </p>
            <div className="space-y-0.5 max-h-64 overflow-y-auto scrollbar-thin">
              {isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-sidebar-muted" />
                </div>
              ) : workspaces.length === 0 ? (
                <p className="text-[10px] text-sidebar-muted px-3 py-2 italic text-center">Nenhum workspace encontrado</p>
              ) : workspaces.map((ws) => (
                <div key={ws.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => handleWorkspaceSwitch(ws.id)}
                    className={cn(
                      "flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 rounded-md text-xs transition-all",
                      ws.id === activeWorkspace?.id
                        ? "bg-teal-600 text-white font-bold shadow-sm ring-1 ring-teal-400"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <FolderOpen className={cn("w-3.5 h-3.5 shrink-0", ws.id === activeWorkspace?.id ? "text-white" : "text-teal-500")} />
                    <span className="truncate">{ws.name}</span>
                    {ws.id === activeWorkspace?.id && (
                      <Badge variant="secondary" className="ml-auto text-[8px] h-4 px-1 bg-white/20 text-white border-none shrink-0">ACTIVO</Badge>
                    )}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-sidebar-accent/50 transition-all shrink-0">
                        <MoreHorizontal className="w-3 h-3 text-sidebar-muted" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={() => setEditWs({ id: ws.id, name: ws.name })}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Renomear
                      </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setCopyToWs({ id: ws.id, name: ws.name });
                            setCopySourceId("");
                          }}
                        >
                          <Copy className="w-3.5 h-3.5 mr-2" /> Copiar config
                        </DropdownMenuItem>
                      {workspaces.length > 1 && (
                        <DropdownMenuItem
                          onClick={() => {
                            setMergeWs({ sourceId: ws.id, sourceName: ws.name });
                            setMergeTargetId("");
                          }}
                        >
                          <Merge className="w-3.5 h-3.5 mr-2" /> Fundir
                        </DropdownMenuItem>
                      )}
                      {workspaces.length > 1 && (
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteWs({ id: ws.id, name: ws.name })}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Eliminar
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowNewWs(true)}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors mt-1 border border-dashed border-sidebar-border mx-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo workspace</span>
            </button>
          </div>
        )}

        {collapsed && (
          <div className="px-2 py-3 border-b border-sidebar-border flex flex-col gap-2 items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-10 h-10 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-600 hover:bg-teal-500/20 transition-colors"
                  title={activeWorkspace?.name || "Mudar Workspace"}
                >
                  <FolderOpen className="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-48">
                <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b mb-1">
                  Mudar Workspace
                </div>
                {workspaces.map((ws) => (
                  <DropdownMenuItem
                    key={ws.id}
                    onClick={() => handleWorkspaceSwitch(ws.id)}
                    className={cn(
                      "text-xs flex items-center justify-between",
                      ws.id === activeWorkspace?.id && "bg-teal-500/10 text-teal-700 font-bold"
                    )}
                  >
                    <span className="truncate max-w-[120px]">{ws.name}</span>
                    {ws.id === activeWorkspace?.id && <Check className="w-3 h-3" />}
                  </DropdownMenuItem>
                ))}
                <div className="border-t mt-1 pt-1">
                  <DropdownMenuItem onClick={() => setShowNewWs(true)} className="text-xs text-teal-600 font-medium">
                    <Plus className="w-3 h-3 mr-2" /> Novo Workspace
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
          {navGroups.map((group) => {
            const isOpen = openGroups[group.key] ?? false;
            const hasActiveItem = group.items.some((item) => isRouteActive(item.route));

            return (
              <div key={group.key}>
                {/* Group Header */}
                {!collapsed ? (
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className={cn(
                      "flex items-center w-full px-3 py-2 rounded-md text-[10px] uppercase tracking-widest font-semibold transition-colors",
                      hasActiveItem
                        ? "text-sidebar-primary"
                        : "text-sidebar-muted hover:text-sidebar-foreground"
                    )}
                  >
                    <group.icon className="w-3.5 h-3.5 mr-2 shrink-0" />
                    <span className="flex-1 text-left">{group.label}</span>
                    <ChevronDown
                      className={cn(
                        "w-3 h-3 shrink-0 transition-transform duration-200",
                        isOpen ? "rotate-0" : "-rotate-90"
                      )}
                    />
                  </button>
                ) : (
                  <div className="flex justify-center py-1.5">
                    <div className="w-6 h-px bg-sidebar-border" />
                  </div>
                )}

                {/* Group Items */}
                {(collapsed || isOpen) && (
                  <div className={cn(!collapsed && "ml-2 mt-0.5 space-y-0.5 mb-2")}>
                    {group.items.map((item) => {
                      const active = isRouteActive(item.route);
                      return (
                        <NavLink
                          key={item.route}
                          to={item.route}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                            collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2",
                            active
                              ? "bg-sidebar-accent text-sidebar-primary"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                          )}
                          title={collapsed ? item.title : undefined}
                        >
                          <item.icon className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4")} />
                          {!collapsed && <span>{item.title}</span>}
                          {!collapsed && item.badge && (
                            <span className="ml-auto text-[10px] font-semibold bg-primary/10 text-primary rounded-full px-1.5 py-0.5">
                              {item.badge}
                            </span>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border px-2 py-2 space-y-1">
          {!collapsed && user && (
            <p className="text-sidebar-muted text-xs truncate px-3 py-1">{user.email}</p>
          )}
          <ThemeToggle collapsed={collapsed} />
          <button
            onClick={async () => { await signOut(); navigate("/login"); }}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-destructive transition-colors w-full"
            )}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>

        {/* Collapse Toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center h-12 border-t border-sidebar-border text-sidebar-muted hover:text-sidebar-accent-foreground transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </aside>

      {/* New Workspace Dialog */}
      <Dialog open={showNewWs} onOpenChange={setShowNewWs}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Workspace</DialogTitle>
            <DialogDescription>Cada workspace isola categorias, produtos e configurações por site/fornecedor.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input
                placeholder="Ex: Fornecedor X, Marca Y"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateWorkspace()}
                autoFocus
                id="new-workspace-name"
                name="new-workspace-name"
              />
            </div>

            {workspaces.length > 0 && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Copiar configuração de</Label>
                  <Select value={copyFromWsId} onValueChange={setCopyFromWsId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Começar do zero" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Começar do zero</SelectItem>
                      {workspaces.map((ws) => (
                        <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {copyFromWsId && copyFromWsId !== "none" && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">O que copiar:</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: "providers" as const, label: "AI Providers" },
                        { key: "routing" as const, label: "Routing Rules" },
                        { key: "prompts" as const, label: "Prompts" },
                        { key: "categories" as const, label: "Categorias" },
                      ]).map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                          <Checkbox
                            checked={copyOptions[key]}
                            onCheckedChange={(checked) =>
                              setCopyOptions((prev) => ({ ...prev, [key]: !!checked }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewWs(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateWorkspace} disabled={!newWsName.trim() || isCreating}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Workspace Dialog */}
      <Dialog open={!!editWs} onOpenChange={(open) => !open && setEditWs(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input
                value={editWs?.name ?? ""}
                onChange={(e) =>
                  setEditWs((prev) => (prev ? { ...prev, name: e.target.value } : null))
                }
                onKeyDown={(e) => e.key === "Enter" && handleEditWorkspace()}
                autoFocus
                id="edit-workspace-name"
                name="edit-workspace-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditWs(null)}>
              Cancelar
            </Button>
            <Button onClick={handleEditWorkspace} disabled={!editWs?.name.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Workspace Dialog */}
      <Dialog open={!!deleteWs} onOpenChange={(open) => !open && setDeleteWs(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar Workspace</DialogTitle>
            <DialogDescription>
              Tem a certeza que deseja eliminar o workspace{" "}
              <strong>"{deleteWs?.name}"</strong>? Todos os produtos, ficheiros e dados
              associados serão eliminados permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteWs(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteWorkspace}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Workspace Dialog */}
      <Dialog open={!!mergeWs} onOpenChange={(open) => !open && setMergeWs(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fundir Workspaces</DialogTitle>
            <DialogDescription>
              Mover todos os produtos e dados de{" "}
              <strong>"{mergeWs?.sourceName}"</strong> para outro workspace. O workspace de
              origem será eliminado após a fusão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Workspace destino</Label>
              <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar workspace..." />
                </SelectTrigger>
                <SelectContent>
                  {workspaces
                    .filter((w) => w.id !== mergeWs?.sourceId)
                    .map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeWs(null)}>
              Cancelar
            </Button>
            <Button onClick={handleMergeWorkspaces} disabled={!mergeTargetId}>
              Fundir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy Config to Existing Workspace Dialog */}
      <Dialog open={!!copyToWs} onOpenChange={(open) => !open && setCopyToWs(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Copiar Configuração para "{copyToWs?.name}"</DialogTitle>
            <DialogDescription>Importar AI providers, regras de routing, prompts ou categorias de outro workspace.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Copiar de</Label>
              <Select value={copySourceId} onValueChange={setCopySourceId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecionar workspace de origem..." />
                </SelectTrigger>
                <SelectContent>
                  {workspaces
                    .filter((ws) => ws.id !== copyToWs?.id)
                    .map((ws) => (
                      <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {copySourceId && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">O que copiar:</Label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "providers" as const, label: "AI Providers" },
                    { key: "routing" as const, label: "Routing Rules" },
                    { key: "prompts" as const, label: "Prompts" },
                    { key: "categories" as const, label: "Categorias" },
                  ]).map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={copyToOptions[key]}
                        onCheckedChange={(checked) =>
                          setCopyToOptions((prev) => ({ ...prev, [key]: !!checked }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyToWs(null)}>Cancelar</Button>
            <Button onClick={handleCopyConfigToWorkspace} disabled={!copySourceId}>Copiar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Workspace Switch Dialog */}
      <Dialog open={!!wsToSwitch} onOpenChange={(open) => !open && setWsToSwitch(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mudar para workspace "{workspaces.find(w => w.id === wsToSwitch)?.name}"?</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>Estás actualmente em <strong>{activeWorkspace?.name}</strong>.</p>
              <div className="bg-muted p-3 rounded-md text-sm">
                {selectedCount > 0 && <p className="text-amber-600 font-medium">⚠️ Tens {selectedCount} produtos seleccionados.</p>}
                {isProcessing && <p className="text-primary font-medium">⚙️ Uma operação em massa está a decorrer.</p>}
              </div>
              <p className="text-xs text-muted-foreground mt-2">A mudança de workspace irá limpar a sua seleção actual.</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWsToSwitch(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmSwitch}>
              Confirmar mudança
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
