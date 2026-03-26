import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { MoreHorizontal, Eye, Pencil, Upload, History, BookOpen } from "lucide-react";

interface SupplierRow {
  id: string;
  supplier_name: string;
  is_active: boolean;
  total_products: number;
  last_import_date: string | null;
  quality_score: number | null;
  matching_rate: number | null;
  conflict_rate: number | null;
}

interface SupplierTableProps {
  suppliers: SupplierRow[];
  onView: (id: string) => void;
  onEdit?: (id: string) => void;
  onRunImport?: (id: string) => void;
  onViewHistory?: (id: string) => void;
  onOpenPlaybook?: (id: string) => void;
}

export function SupplierTable({ suppliers, onView, onEdit, onRunImport, onViewHistory, onOpenPlaybook }: SupplierTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fornecedor</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Produtos</TableHead>
          <TableHead>Última Importação</TableHead>
          <TableHead>Qualidade</TableHead>
          <TableHead className="text-right">Matching</TableHead>
          <TableHead className="text-right">Conflitos</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {suppliers.map((s) => (
          <TableRow key={s.id} className="cursor-pointer" onClick={() => onView(s.id)}>
            <TableCell className="font-medium">{s.supplier_name}</TableCell>
            <TableCell>
              <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Ativo" : "Inativo"}</Badge>
            </TableCell>
            <TableCell className="text-right">{s.total_products}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {s.last_import_date ? new Date(s.last_import_date).toLocaleDateString("pt-PT") : "—"}
            </TableCell>
            <TableCell>
              {s.quality_score !== null ? (
                <div className="flex items-center gap-2 min-w-[100px]">
                  <Progress value={s.quality_score * 100} className="h-2 flex-1" />
                  <span className="text-xs font-medium w-8">{Math.round(s.quality_score * 100)}%</span>
                </div>
              ) : <span className="text-xs text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="text-right text-sm">{s.matching_rate !== null ? `${Math.round(s.matching_rate * 100)}%` : "—"}</TableCell>
            <TableCell className="text-right text-sm">{s.conflict_rate !== null ? `${Math.round(s.conflict_rate * 100)}%` : "—"}</TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(s.id); }}><Eye className="h-4 w-4 mr-2" />Ver Detalhes</DropdownMenuItem>
                  {onEdit && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(s.id); }}><Pencil className="h-4 w-4 mr-2" />Editar</DropdownMenuItem>}
                  {onRunImport && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRunImport(s.id); }}><Upload className="h-4 w-4 mr-2" />Importar</DropdownMenuItem>}
                  {onViewHistory && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewHistory(s.id); }}><History className="h-4 w-4 mr-2" />Histórico</DropdownMenuItem>}
                  {onOpenPlaybook && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpenPlaybook(s.id); }}><BookOpen className="h-4 w-4 mr-2" />Playbook</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
        {!suppliers.length && (
          <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">Nenhum fornecedor registado.</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );
}
