import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, FileText } from "lucide-react";

interface ParsingIssue {
  id: string;
  supplier_name: string;
  product_ref: string;
  error_type: string;
  error_description: string;
  timestamp: string;
  source_file?: string;
}

interface SupplierParsingIssuesProps {
  issues: ParsingIssue[];
  onRetry?: (id: string) => void;
  onViewSource?: (id: string) => void;
}

export function SupplierParsingIssues({ issues, onRetry, onViewSource }: SupplierParsingIssuesProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Parsing Issues</CardTitle></CardHeader>
      <CardContent>
        {issues.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Referência</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell className="font-medium">{issue.supplier_name}</TableCell>
                  <TableCell className="font-mono text-xs">{issue.product_ref}</TableCell>
                  <TableCell><Badge variant="destructive">{issue.error_type}</Badge></TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{issue.error_description}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(issue.timestamp).toLocaleDateString("pt-PT")}</TableCell>
                  <TableCell className="flex gap-1">
                    {onViewSource && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewSource(issue.id)}><FileText className="h-3 w-3" /></Button>}
                    {onRetry && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRetry(issue.id)}><RefreshCw className="h-3 w-3" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">Sem erros de parsing.</p>
        )}
      </CardContent>
    </Card>
  );
}
