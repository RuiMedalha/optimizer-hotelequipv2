import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Table2, MapPin, Eye } from "lucide-react";

interface Zone {
  type: string;
  description?: string;
  pages?: number[];
  confidence?: number;
}

interface Props {
  analysis: {
    layout_complexity?: string;
    detected_zones?: Zone[];
    has_complex_tables?: boolean;
    needs_ocr?: boolean;
    text_quality?: string;
    detected_products_estimate?: number;
    document_language?: string;
    supplier_hint?: string;
    totalPages?: number;
    pagesWithTables?: number;
  } | null;
}

const zoneTypeColors: Record<string, string> = {
  product_title: "bg-primary/20 text-primary",
  sku: "bg-accent text-accent-foreground",
  reference: "bg-accent text-accent-foreground",
  price: "bg-secondary text-secondary-foreground",
  technical_specs: "bg-muted text-foreground",
  dimension: "bg-muted text-foreground",
  power: "bg-muted text-foreground",
  description: "bg-primary/10 text-primary",
  table_product_list: "bg-primary/20 text-primary",
  image: "bg-accent/50 text-accent-foreground",
  category: "bg-secondary/50 text-secondary-foreground",
  header: "bg-muted text-muted-foreground",
  footer: "bg-muted text-muted-foreground",
};

const complexityColors: Record<string, string> = {
  simple: "bg-primary/10 text-primary",
  moderate: "bg-accent text-accent-foreground",
  complex: "bg-destructive/10 text-destructive",
};

export function DocumentPreviewPanel({ analysis }: Props) {
  if (!analysis) return null;

  const zones = analysis.detected_zones || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Eye className="h-4 w-4" /> Análise do Documento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary badges */}
        <div className="flex flex-wrap gap-2">
          {analysis.layout_complexity && (
            <Badge className={complexityColors[analysis.layout_complexity] || ""}>
              Layout: {analysis.layout_complexity}
            </Badge>
          )}
          {analysis.text_quality && (
            <Badge variant="outline">Qualidade texto: {analysis.text_quality}</Badge>
          )}
          {analysis.totalPages && (
            <Badge variant="secondary">
              <FileText className="h-3 w-3 mr-1" /> {analysis.totalPages} páginas
            </Badge>
          )}
          {analysis.pagesWithTables != null && (
            <Badge variant="secondary">
              <Table2 className="h-3 w-3 mr-1" /> {analysis.pagesWithTables} com tabelas
            </Badge>
          )}
          {analysis.detected_products_estimate != null && (
            <Badge variant="default">~{analysis.detected_products_estimate} produtos estimados</Badge>
          )}
          {analysis.document_language && (
            <Badge variant="outline">{analysis.document_language}</Badge>
          )}
          {analysis.needs_ocr && <Badge variant="destructive">Necessita OCR</Badge>}
          {analysis.supplier_hint && (
            <Badge variant="outline">
              <MapPin className="h-3 w-3 mr-1" /> {analysis.supplier_hint}
            </Badge>
          )}
        </div>

        {/* Detected zones */}
        {zones.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Zonas Detetadas</p>
            <ScrollArea className="max-h-48">
              <div className="space-y-1">
                {zones.map((z, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded-md bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${zoneTypeColors[z.type] || ""}`}>
                        {z.type}
                      </Badge>
                      <span className="text-muted-foreground">{z.description}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {z.pages?.length ? (
                        <span className="text-muted-foreground">p. {z.pages.join(", ")}</span>
                      ) : null}
                      {z.confidence != null && (
                        <Badge variant="outline" className="text-[10px]">{z.confidence}%</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
