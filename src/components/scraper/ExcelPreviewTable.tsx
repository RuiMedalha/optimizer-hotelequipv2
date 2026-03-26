import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, FileSpreadsheet, Eye, Table as TableIcon } from "lucide-react";
import { DEFAULT_PRODUCT_FIELDS } from "@/hooks/useUploadCatalog";

interface ExcelPreviewTableProps {
  data: Record<string, string>[];
  /** Current scraper→product mapping */
  mapping?: Record<string, string>;
  /** Called when mapping changes */
  onMappingChange?: (mapping: Record<string, string>) => void;
  maxPreviewRows?: number;
}

const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const getColLetter = (idx: number) =>
  idx < 26 ? COLUMN_LETTERS[idx] : COLUMN_LETTERS[Math.floor(idx / 26) - 1] + COLUMN_LETTERS[idx % 26];

export function ExcelPreviewTable({
  data,
  mapping = {},
  onMappingChange,
  maxPreviewRows = 50,
}: ExcelPreviewTableProps) {
  const [view, setView] = useState<"excel" | "mapped">("excel");

  if (!data.length) return null;

  const headers = Object.keys(data[0]);
  const visibleRows = data.slice(0, maxPreviewRows);

  const mappedFields = Object.entries(mapping)
    .map(([scraperKey, productField]) => ({
      scraperKey,
      productField,
      label: DEFAULT_PRODUCT_FIELDS.find(f => f.key === productField)?.label || productField,
    }))
    .filter(f => f.productField !== "__ignore__");

  return (
    <div className="space-y-2">
      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <div className="flex items-center gap-2">
          <TabsList className="h-8">
            <TabsTrigger value="excel" className="text-xs gap-1 h-7">
              <FileSpreadsheet className="w-3 h-3" /> Excel
            </TabsTrigger>
            <TabsTrigger value="mapped" className="text-xs gap-1 h-7" disabled={mappedFields.length === 0}>
              <Eye className="w-3 h-3" /> Produto
            </TabsTrigger>
          </TabsList>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {data.length} linhas · {headers.length} colunas
            {data.length > maxPreviewRows && ` (mostrando ${maxPreviewRows})`}
          </span>
        </div>

        {/* ═══ Excel-style view ═══ */}
        <TabsContent value="excel" className="mt-2">
          <ScrollArea className="border rounded-lg max-h-[420px]">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-xs">
                {/* Column letters row */}
                <thead>
                  <tr className="bg-muted/60 sticky top-0 z-10">
                    <th className="w-10 min-w-10 border-r border-b bg-muted/80 text-center text-[10px] text-muted-foreground font-normal py-1" />
                    {headers.map((_, ci) => (
                      <th
                        key={ci}
                        className="border-r border-b bg-muted/80 text-center text-[10px] text-muted-foreground font-normal py-1 min-w-[100px]"
                      >
                        {getColLetter(ci)}
                      </th>
                    ))}
                  </tr>
                  {/* Header names row */}
                  <tr className="bg-muted/40 sticky top-[25px] z-10">
                    <th className="w-10 min-w-10 border-r border-b bg-muted/60 text-center text-[10px] text-muted-foreground font-medium py-1.5">
                      #
                    </th>
                    {headers.map((h, ci) => (
                      <th
                        key={ci}
                        className="border-r border-b bg-muted/60 text-left px-2 py-1.5 font-semibold text-foreground whitespace-nowrap"
                      >
                        {h}
                        {mapping[h] && (
                          <Badge variant="default" className="text-[8px] ml-1 py-0 px-1">
                            {DEFAULT_PRODUCT_FIELDS.find(f => f.key === mapping[h])?.label || mapping[h]}
                          </Badge>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, ri) => (
                    <tr
                      key={ri}
                      className={`${ri % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-primary/5 transition-colors`}
                    >
                      <td className="border-r text-center text-[10px] text-muted-foreground font-mono py-1 bg-muted/30">
                        {ri + 1}
                      </td>
                      {headers.map((h, ci) => {
                        const val = row[h] || "";
                        const isUrl = val.startsWith("http");
                        return (
                          <td
                            key={ci}
                            className="border-r px-2 py-1 max-w-[220px] truncate"
                            title={val}
                          >
                            {isUrl ? (
                              <a href={val} target="_blank" rel="noreferrer" className="text-primary underline">
                                {val.length > 50 ? val.substring(0, 50) + "…" : val}
                              </a>
                            ) : (
                              val.length > 100 ? val.substring(0, 100) + "…" : val || "—"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollArea>

          {/* Inline mapping row under Excel view */}
          {onMappingChange && (
            <div className="mt-2 p-3 border rounded-lg bg-muted/10 space-y-2">
              <p className="text-xs font-medium flex items-center gap-1">
                <ArrowRight className="w-3 h-3" /> Mapeamento rápido
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {headers.map(h => (
                  <div key={h} className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium truncate max-w-[80px]" title={h}>{h}</span>
                    <ArrowRight className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                    <Select
                      value={mapping[h] || "__ignore__"}
                      onValueChange={v => {
                        const next = { ...mapping };
                        if (v === "__ignore__") delete next[h]; else next[h] = v;
                        onMappingChange(next);
                      }}
                    >
                      <SelectTrigger className="h-6 text-[10px] flex-1 min-w-0">
                        <SelectValue placeholder="Ignorar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ignore__"><span className="text-muted-foreground">— Ignorar —</span></SelectItem>
                        {DEFAULT_PRODUCT_FIELDS.map(pf => (
                          <SelectItem key={pf.key} value={pf.key}>{pf.label}{pf.required ? " *" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ═══ Mapped product view ═══ */}
        <TabsContent value="mapped" className="mt-2">
          {mappedFields.length === 0 ? (
            <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
              Mapeie os campos primeiro para visualizar como ficarão os produtos.
            </div>
          ) : (
            <ScrollArea className="border rounded-lg max-h-[420px]">
              <div className="overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted/60 sticky top-0 z-10">
                      <th className="w-10 min-w-10 border-r border-b bg-muted/80 text-center text-[10px] text-muted-foreground font-normal py-1.5">
                        #
                      </th>
                      {mappedFields.map(f => (
                        <th key={f.scraperKey} className="border-r border-b bg-muted/60 text-left px-2 py-1.5 whitespace-nowrap">
                          <Badge variant="secondary" className="text-[10px]">{f.label}</Badge>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, ri) => (
                      <tr key={ri} className={`${ri % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-primary/5`}>
                        <td className="border-r text-center text-[10px] text-muted-foreground font-mono py-1 bg-muted/30">
                          {ri + 1}
                        </td>
                        {mappedFields.map(f => {
                          const val = row[f.scraperKey] || "";
                          const isImg = val.startsWith("http") && /\.(jpg|jpeg|png|webp|gif|svg)/i.test(val.split("?")[0]);
                          return (
                            <td key={f.scraperKey} className="border-r px-2 py-1 max-w-[220px] truncate" title={val}>
                              {isImg ? (
                                <img src={val} alt="" className="h-8 w-8 object-cover rounded inline-block" />
                              ) : val.startsWith("http") ? (
                                <a href={val} target="_blank" rel="noreferrer" className="text-primary underline">
                                  {val.substring(0, 40)}…
                                </a>
                              ) : (
                                val.substring(0, 100) || "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
