import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ImportRecord {
  id: string;
  supplier_name: string;
  created_at: string;
  rows_processed: number;
  successful_matches: number;
  manual_reviews: number;
  source_type: string | null;
  average_confidence: number;
}

interface SupplierImportHistoryProps {
  imports: ImportRecord[];
  onViewDetails?: (id: string) => void;
}

export function SupplierImportHistory({ imports, onViewDetails }: SupplierImportHistoryProps) {
  const statusBadge = (confidence: number) => {
    if (confidence >= 0.8) return <Badge variant="default">Sucesso</Badge>;
    if (confidence >= 0.5) return <Badge variant="secondary">Parcial</Badge>;
    return <Badge variant="destructive">Problemas</Badge>;
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Importações Recentes</CardTitle></CardHeader>
      <CardContent>
        {imports.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Processados</TableHead>
                <TableHead className="text-right">Matches</TableHead>
                <TableHead className="text-right">Revisões</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((imp) => (
                <TableRow key={imp.id} className={onViewDetails ? "cursor-pointer" : ""} onClick={() => onViewDetails?.(imp.id)}>
                  <TableCell className="font-medium">{imp.supplier_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(imp.created_at).toLocaleDateString("pt-PT")}</TableCell>
                  <TableCell className="text-right">{imp.rows_processed}</TableCell>
                  <TableCell className="text-right">{imp.successful_matches}</TableCell>
                  <TableCell className="text-right">{imp.manual_reviews}</TableCell>
                  <TableCell><Badge variant="outline">{imp.source_type || "—"}</Badge></TableCell>
                  <TableCell>{statusBadge(imp.average_confidence)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">Sem importações recentes.</p>
        )}
      </CardContent>
    </Card>
  );
}
