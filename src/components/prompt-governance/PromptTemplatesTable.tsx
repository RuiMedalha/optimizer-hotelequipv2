import { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PromptTemplateActionsDropdown } from "./PromptTemplateActionsDropdown";
import { Search } from "lucide-react";
import type { PromptTemplate } from "@/hooks/usePromptGovernance";

const PROMPT_TYPES = ["all", "enrichment", "description", "seo", "categorization", "validation", "translation", "general"];
const STATUS_FILTERS = ["all", "active", "archived"];

interface Props {
  templates: PromptTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (t: PromptTemplate) => void;
  onDuplicate: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}

export function PromptTemplatesTable({ templates, selectedId, onSelect, onEdit, onDuplicate, onArchive, onRestore, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return templates.filter(t => {
      const matchSearch = !search || t.prompt_name.toLowerCase().includes(search.toLowerCase()) || (t.description || "").toLowerCase().includes(search.toLowerCase());
      const matchType = typeFilter === "all" || t.prompt_type === typeFilter;
      const matchStatus = statusFilter === "all" || (statusFilter === "active" ? t.is_active : !t.is_active);
      return matchSearch && matchType && matchStatus;
    });
  }, [templates, search, typeFilter, statusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Pesquisar templates..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            {PROMPT_TYPES.map(t => <SelectItem key={t} value={t}>{t === "all" ? "Todos os tipos" : t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(s => <SelectItem key={s} value={s}>{s === "all" ? "Todos" : s === "active" ? "Ativos" : "Arquivados"}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="hidden md:table-cell">Descrição</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="hidden sm:table-cell">Atualizado</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(t => (
              <TableRow
                key={t.id}
                className={`cursor-pointer ${selectedId === t.id ? "bg-muted/50" : ""}`}
                onClick={() => onSelect(t.id)}
              >
                <TableCell className="font-medium">{t.prompt_name}</TableCell>
                <TableCell><Badge variant="secondary" className="text-xs">{t.prompt_type}</Badge></TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground text-sm max-w-[200px] truncate">{t.description || "—"}</TableCell>
                <TableCell>
                  {t.is_active
                    ? <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Ativo</Badge>
                    : <Badge variant="outline" className="text-muted-foreground">Arquivado</Badge>
                  }
                </TableCell>
                <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                  {new Date(t.updated_at || t.created_at).toLocaleDateString("pt-PT")}
                </TableCell>
                <TableCell>
                  <PromptTemplateActionsDropdown
                    template={t}
                    onEdit={() => onEdit(t)}
                    onDuplicate={() => onDuplicate(t.id)}
                    onArchive={() => onArchive(t.id)}
                    onRestore={() => onRestore(t.id)}
                    onDelete={() => onDelete(t.id)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum template encontrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
