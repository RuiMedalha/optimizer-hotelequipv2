import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, RefreshCw, DollarSign, Settings } from "lucide-react";

interface ChangeEntry {
  id: string;
  supplier_name: string;
  change_type: "new" | "updated" | "price_change" | "attribute_update";
  product_title: string;
  details: string;
  timestamp: string;
}

interface SupplierChangeFeedProps {
  changes: ChangeEntry[];
}

const changeIcons: Record<string, any> = {
  new: Plus,
  updated: RefreshCw,
  price_change: DollarSign,
  attribute_update: Settings,
};

const changeLabels: Record<string, string> = {
  new: "Novo",
  updated: "Atualizado",
  price_change: "Preço",
  attribute_update: "Atributo",
};

const changeVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "default",
  updated: "secondary",
  price_change: "outline",
  attribute_update: "outline",
};

export function SupplierChangeFeed({ changes }: SupplierChangeFeedProps) {
  // Group by supplier
  const grouped = changes.reduce<Record<string, ChangeEntry[]>>((acc, c) => {
    (acc[c.supplier_name] ||= []).push(c);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Alterações Recentes no Catálogo</CardTitle></CardHeader>
      <CardContent>
        {Object.keys(grouped).length ? (
          <div className="space-y-4">
            {Object.entries(grouped).map(([supplier, entries]) => (
              <div key={supplier}>
                <p className="text-sm font-medium mb-2">{supplier}</p>
                <div className="space-y-1.5 pl-2 border-l-2 border-border">
                  {entries.slice(0, 5).map((e) => {
                    const Icon = changeIcons[e.change_type] || RefreshCw;
                    return (
                      <div key={e.id} className="flex items-center gap-2 text-xs">
                        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                        <Badge variant={changeVariants[e.change_type]} className="text-[10px] px-1.5">{changeLabels[e.change_type]}</Badge>
                        <span className="truncate flex-1">{e.product_title}</span>
                        <span className="text-muted-foreground shrink-0">{new Date(e.timestamp).toLocaleDateString("pt-PT")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">Sem alterações recentes.</p>
        )}
      </CardContent>
    </Card>
  );
}
