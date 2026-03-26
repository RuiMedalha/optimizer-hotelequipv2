import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Package, BarChart3, AlertTriangle } from "lucide-react";

interface SupplierHealthCardsProps {
  activeSuppliers: number;
  totalProducts: number;
  avgQuality: number;
  openConflicts: number;
}

export function SupplierHealthCards({ activeSuppliers, totalProducts, avgQuality, openConflicts }: SupplierHealthCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{activeSuppliers}</p>
              <p className="text-xs text-muted-foreground">Fornecedores Ativos</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{totalProducts}</p>
              <p className="text-xs text-muted-foreground">Produtos Importados</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{avgQuality ? `${Math.round(avgQuality * 100)}%` : "—"}</p>
              <p className="text-xs text-muted-foreground">Qualidade Média</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-2xl font-bold">{openConflicts}</p>
              <p className="text-xs text-muted-foreground">Conflitos Abertos</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
