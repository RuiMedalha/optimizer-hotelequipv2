import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, ChevronDown, ChevronUp, Package, User, FolderOpen, Filter } from "lucide-react";

interface ImportLogEntry {
  id: string;
  created_at: string;
  user_id: string;
  details: {
    type: string;
    imported: number;
    variations: number;
    skipped: number;
    filters: Record<string, string>;
    workflow_run_id?: string;
    imported_at?: string;
  };
}

async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);
    return new Map((data ?? []).map((p) => [p.user_id, p.full_name || p.email || p.user_id]));
  } catch {
    return new Map();
  }
}

async function resolveSessionNames(runIds: string[]): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("catalog_workflow_runs")
      .select("id, catalog_workflows(workflow_name)")
      .in("id", runIds);
    const map = new Map<string, string>();
    for (const r of data ?? []) {
      const name = (r.catalog_workflows as any)?.workflow_name;
      if (name) map.set(r.id, name);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function ImportHistoryPanel() {
  const { activeWorkspace } = useWorkspaceContext();
  const [expanded, setExpanded] = useState(false);
  const [expandedFilters, setExpandedFilters] = useState<Set<string>>(new Set());

  const { data: logs, isLoading } = useQuery({
    queryKey: ["import-history", activeWorkspace?.id],
    enabled: expanded && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, created_at, user_id, details")
        .eq("workspace_id", activeWorkspace!.id)
        .eq("action", "upload")
        .filter("details->>type", "eq", "woocommerce_import")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;

      const entries = (data ?? []) as unknown as ImportLogEntry[];

      // Resolve names in parallel with safe fallback
      const userIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))];
      const runIds = [...new Set(entries.map((e) => e.details?.workflow_run_id).filter(Boolean))] as string[];
      const [userMap, sessionMap] = await Promise.all([
        resolveUserNames(userIds),
        resolveSessionNames(runIds),
      ]);

      return entries.map((e) => ({
        ...e,
        _userName: userMap.get(e.user_id) || e.user_id || "—",
        _sessionName: e.details?.workflow_run_id
          ? (sessionMap.get(e.details.workflow_run_id) || e.details.workflow_run_id)
          : "—",
      }));
    },
  });

  const toggleFilter = (id: string) => {
    setExpandedFilters((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const hasFilters = (filters: Record<string, string>) =>
    Object.values(filters || {}).some((v) => v && v !== "all");

  return (
    <Card>
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="w-4 h-4" />
          Histórico de Importações
          <span className="ml-auto text-muted-foreground">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-2">
          {isLoading && (
            <p className="text-sm text-muted-foreground">A carregar histórico...</p>
          )}
          {!isLoading && (!logs || logs.length === 0) && (
            <p className="text-sm text-muted-foreground">Nenhuma importação registada.</p>
          )}
          {logs?.map((entry) => (
            <div key={entry.id} className="rounded-md border p-3 space-y-1.5 text-sm">
              <div className="flex flex-wrap gap-3 items-center">
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString("pt-PT")}
                </span>
                <div className="flex items-center gap-1 text-xs">
                  <User className="w-3 h-3 text-muted-foreground" />
                  <span>{entry._userName}</span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <FolderOpen className="w-3 h-3 text-muted-foreground" />
                  <span>{entry._sessionName}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-xs gap-1">
                  <Package className="w-3 h-3" />
                  {entry.details.imported} importados
                </Badge>
                {entry.details.variations > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {entry.details.variations} variações
                  </Badge>
                )}
                {entry.details.skipped > 0 && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    {entry.details.skipped} ignorados
                  </Badge>
                )}
              </div>
              {hasFilters(entry.details.filters) && (
                <div>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => toggleFilter(entry.id)}
                  >
                    <Filter className="w-3 h-3" />
                    {expandedFilters.has(entry.id) ? "Ocultar filtros" : "Ver filtros"}
                  </button>
                  {expandedFilters.has(entry.id) && (
                    <div className="mt-1 text-xs text-muted-foreground pl-4 space-y-0.5">
                      {Object.entries(entry.details.filters)
                        .filter(([, v]) => v && v !== "all")
                        .map(([k, v]) => (
                          <div key={k}><strong>{k}:</strong> {String(v)}</div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
