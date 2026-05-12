import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Product } from "./useProducts";

// Attribute name sets for robust matching (case-insensitive)
const EAN_ATTR_NAMES = new Set([
  "ean", "gtin", "barcode", "código de barras", "codigo de barras", "_ean", "_gtin", "_barcode",
]);
const MODELO_ATTR_NAMES = new Set([
  "modelo", "model", "ref", "referência", "referencia", "_modelo", "_model",
]);
const CRITICAL_ATTR_NAMES = new Set([...EAN_ATTR_NAMES, ...MODELO_ATTR_NAMES]);

function extractAttrValue(attrs: any[], nameSet: Set<string>): string {
  const found = (attrs || []).find((a: any) =>
    nameSet.has((a.name ?? "").toLowerCase().trim())
  );
  const val = found?.value ?? (Array.isArray(found?.values) ? found.values[0] : undefined);
  return val != null ? String(val) : "";
}

const EXCEL_MAX = 32000;

function safeVal(val: unknown): string {
  if (val == null) return "";
  return String(val);
}

function safeValPart(val: unknown, part: 1 | 2, keepHtml = false): string {
  if (val == null) return "";
  let str = String(val);
  if (!keepHtml) {
    str = str.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (part === 1) return str.substring(0, EXCEL_MAX);
  return str.length > EXCEL_MAX ? str.substring(EXCEL_MAX, EXCEL_MAX * 2) : "";
}

async function fetchUserLookup(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);
    const map = new Map<string, string>();
    for (const p of data ?? []) {
      map.set(p.user_id, p.full_name || p.email || p.user_id);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function fetchSessionLookup(runIds: string[]): Promise<Map<string, string>> {
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

async function fetchUsoProfissionalLookup(productIds: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (productIds.length === 0) return map;
  try {
    for (let i = 0; i < productIds.length; i += 200) {
      const batch = productIds.slice(i, i + 200);
      const { data } = await supabase
        .from("product_uso_profissional")
        .select("product_id, intro, use_cases, professional_tips, target_profiles")
        .in("product_id", batch);
      for (const row of data ?? []) {
        map.set(row.product_id, row);
      }
    }
    return map;
  } catch {
    return map;
  }
}

interface ExportColumn {
  key: string;
  header: string;
  splitPart?: 1 | 2;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "sku", header: "SKU" },
  { key: "woocommerce_id", header: "WooCommerce ID" },
  { key: "product_type", header: "Tipo" },
  { key: "original_title", header: "Título Original" },
  { key: "optimized_title", header: "Título Otimizado" },
  { key: "original_description", header: "Descrição Original (1/2)", splitPart: 1 },
  { key: "original_description", header: "Descrição Original (2/2)", splitPart: 2 },
  { key: "optimized_description", header: "Descrição Otimizada (1/2)", splitPart: 1 },
  { key: "optimized_description", header: "Descrição Otimizada (2/2)", splitPart: 2 },
  { key: "short_description", header: "Descrição Curta Original" },
  { key: "optimized_short_description", header: "Descrição Curta Otimizada" },
  { key: "technical_specs", header: "Características Técnicas" },
  { key: "original_price", header: "Preço Original" },
  { key: "sale_price", header: "Preço Promocional" },
  { key: "optimized_price", header: "Preço Otimizado" },
  { key: "optimized_sale_price", header: "Preço Promocional Otimizado" },
  { key: "category", header: "Categoria Principal" },
  { key: "category_paths_secondary", header: "Categorias Secundárias" },
  { key: "suggested_category", header: "Categoria Proposta (IA)" },
  { key: "supplier_ref", header: "Marca" },
  { key: "attr_ean", header: "EAN" },
  { key: "attr_modelo", header: "Modelo" },
  { key: "tags", header: "Tags" },
  { key: "meta_title", header: "Meta Title SEO" },
  { key: "meta_description", header: "Meta Description SEO" },
  { key: "seo_slug", header: "SEO Slug" },
  { key: "focus_keyword", header: "Focus Keyword" },
  { key: "faq", header: "FAQ" },
  { key: "uso_profissional_intro", header: "Uso Profissional - Introdução" },
  { key: "uso_profissional_cases", header: "Uso Profissional - Casos de Uso" },
  { key: "uso_profissional_tips", header: "Uso Profissional - Dicas" },
  { key: "uso_profissional_profiles", header: "Uso Profissional - Perfis" },
  { key: "upsell_skus", header: "Upsells (SKU | Título)" },
  { key: "crosssell_skus", header: "Cross-sells (SKU | Título)" },
  { key: "image_urls", header: "URLs Imagens" },
  { key: "image_alt_texts", header: "Alt Text Imagens" },
  { key: "attributes", header: "Outros Atributos" },
  { key: "woo_status", header: "Estado WooCommerce" },
  { key: "status", header: "Estado Optimização" },
  { key: "imported_at", header: "Importado em" },
  { key: "imported_by", header: "Importado por" },
  { key: "session_name", header: "Sessão" },
];

interface ProductLookups {
  users: Map<string, string>;
  sessions: Map<string, string>;
  usoProfissional: Map<string, any>;
}

function productToRow(p: Product, skuPrefix?: string, lookups?: ProductLookups) {
  const row: Record<string, unknown> = {};
  const attrs: any[] = Array.isArray((p as any).attributes) ? (p as any).attributes : [];
  const sourceProfile: any = (p as any).source_confidence_profile ?? {};
  const categoryPaths: string[] = Array.isArray(sourceProfile.category_paths)
    ? sourceProfile.category_paths
    : [];

  for (const col of EXPORT_COLUMNS) {
    let val = (p as any)[col.key];

    // SKU prefix
    if (col.key === "sku" && skuPrefix && val && !String(val).toUpperCase().startsWith(skuPrefix.toUpperCase())) {
      val = skuPrefix + val;
    }

    // Virtual columns
    if (col.key === "category_paths_secondary") {
      row[col.header] = categoryPaths.slice(1).join(" | ");
      continue;
    }
    if (col.key === "attr_ean") {
      row[col.header] = extractAttrValue(attrs, EAN_ATTR_NAMES);
      continue;
    }
    if (col.key === "attr_modelo") {
      row[col.header] = extractAttrValue(attrs, MODELO_ATTR_NAMES);
      continue;
    }
    if (col.key === "woo_status") {
      row[col.header] = sourceProfile.woo_status ?? "";
      continue;
    }
    if (col.key === "imported_at") {
      row[col.header] = (p as any).created_at
        ? new Date((p as any).created_at).toLocaleDateString("pt-PT")
        : "";
      continue;
    }
    if (col.key === "imported_by") {
      const uid = (p as any).user_id;
      row[col.header] = (uid && lookups?.users.get(uid)) || uid || "";
      continue;
    }
    if (col.key === "session_name") {
      const rid = (p as any).workflow_run_id;
      row[col.header] = (rid && lookups?.sessions.get(rid)) || rid || "";
      continue;
    }

    // Uso Profissional columns from lookups
    if (col.key === "uso_profissional_intro") {
      const uso = lookups?.usoProfissional?.get((p as any).id);
      row[col.header] = uso?.intro || "";
      continue;
    }
    if (col.key === "uso_profissional_cases") {
      const uso = lookups?.usoProfissional?.get((p as any).id);
      const cases = Array.isArray(uso?.use_cases) ? uso.use_cases : [];
      row[col.header] = cases.map((uc: any) => `${uc.context || uc.title || ""}: ${uc.description || ""}`).join(" | ");
      continue;
    }
    if (col.key === "uso_profissional_tips") {
      const uso = lookups?.usoProfissional?.get((p as any).id);
      const tips = Array.isArray(uso?.professional_tips) ? uso.professional_tips : [];
      row[col.header] = tips.map((t: any) => typeof t === "string" ? t : (t?.tip || t?.text || "")).join(" | ");
      continue;
    }
    if (col.key === "uso_profissional_profiles") {
      const uso = lookups?.usoProfissional?.get((p as any).id);
      const profiles = Array.isArray(uso?.target_profiles) ? uso.target_profiles : [];
      row[col.header] = profiles.map((p: any) => typeof p === "string" ? p : (p?.name || "")).filter(Boolean).join(" | ");
      continue;
    }

    // Standard columns
    if (col.key === "faq" && Array.isArray(val)) {
      row[col.header] = val.map((f: any) => `Q: ${f.question} A: ${f.answer}`).join(" | ");
    } else if ((col.key === "upsell_skus" || col.key === "crosssell_skus") && Array.isArray(val)) {
      row[col.header] = val.map((item: any) => typeof item === "string" ? item : item.sku).filter(Boolean).join(",");
    } else if (col.key === "image_alt_texts" && Array.isArray(val)) {
      row[col.header] = val.map((a: any) => a.alt_text).join(" | ");
    } else if (col.key === "attributes" && Array.isArray(val)) {
      const others = val.filter((a: any) => !CRITICAL_ATTR_NAMES.has((a.name ?? "").toLowerCase().trim()));
      row[col.header] = others.map((a: any) => `${a.name}: ${a.value || (a.values || []).join(", ")}`).join(" | ");
    } else if (col.key === "focus_keyword" && Array.isArray(val)) {
      row[col.header] = val.join(", ");
    } else if (Array.isArray(val)) {
      row[col.header] = val.join(", ");
    } else {
      row[col.header] = col.splitPart 
        ? safeValPart((p as any)[col.key], col.splitPart)
        : safeVal((p as any)[col.key]);
    }
  }
  return row;
}

function writeExcel(rows: Record<string, unknown>[], fileName: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Produtos");
  ws["!cols"] = EXPORT_COLUMNS.map((col) => ({ wch: Math.max(col.header.length, 20) }));
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export async function exportProductsToExcel(products: Product[], fileName = "produtos-otimizados", skuPrefix?: string) {
  if (products.length === 0) {
    toast.error("Nenhum produto para exportar.");
    return;
  }
  const uniqueUserIds = [...new Set(products.map((p: any) => p.user_id).filter(Boolean))];
  const uniqueRunIds = [...new Set(products.map((p: any) => p.workflow_run_id).filter(Boolean))];
  const productIds = products.map((p: any) => p.id).filter(Boolean);
  const [userMap, sessionMap, usoMap] = await Promise.all([
    fetchUserLookup(uniqueUserIds),
    fetchSessionLookup(uniqueRunIds),
    fetchUsoProfissionalLookup(productIds),
  ]);
  const lookups: ProductLookups = { users: userMap, sessions: sessionMap, usoProfissional: usoMap };
  const rows = products.map((p) => productToRow(p, skuPrefix, lookups));
  writeExcel(rows, fileName);
  toast.success(`${products.length} produto(s) exportado(s) com sucesso!`);
}

/**
 * Fetch ALL products from a workspace (paginated) and export to Excel.
 * Supports optional status filter.
 */
export async function exportAllProductsToExcel(
  workspaceId: string,
  options: {
    fileName?: string;
    skuPrefix?: string;
    statusFilter?: string;
    onProgress?: (loaded: number, total: number) => void;
  } = {}
) {
  const { fileName = "produtos-todos", skuPrefix, statusFilter = "all", onProgress } = options;

  const allProducts: Product[] = [];
  const PAGE_SIZE = 1000;
  let page = 1;
  let totalCount = 0;

  toast.info("A carregar todos os produtos para exportação...");

  while (true) {
    const { data, error } = await supabase.rpc("get_products_page", {
      _workspace_id: workspaceId,
      _search: "",
      _status: statusFilter,
      _category: "all",
      _product_type: "all",
      _source_file: "all",
      _woo_filter: "all",
      _image_status: "all",
      _page: page,
      _page_size: PAGE_SIZE,
    });

    if (error) {
      toast.error(`Erro ao carregar produtos: ${error.message}`);
      return;
    }

    const rows = (data || []) as any[];
    if (rows.length === 0) break;

    if (page === 1 && rows.length > 0) {
      totalCount = Number(rows[0].total_count) || 0;
    }

    const products: Product[] = rows.map(({ total_count, ...rest }: any) => rest as Product);
    allProducts.push(...products);

    onProgress?.(allProducts.length, totalCount);

    if (rows.length < PAGE_SIZE) break;
    page++;
  }

  if (allProducts.length === 0) {
    toast.error("Nenhum produto encontrado para exportar.");
    return;
  }

  // Build lookup maps for user names and session names
  const uniqueUserIds = [...new Set(allProducts.map((p: any) => p.user_id).filter(Boolean))];
  const uniqueRunIds = [...new Set(allProducts.map((p: any) => p.workflow_run_id).filter(Boolean))];
  const productIds = allProducts.map((p: any) => p.id).filter(Boolean);
  const [userMap, sessionMap, usoMap] = await Promise.all([
    fetchUserLookup(uniqueUserIds),
    fetchSessionLookup(uniqueRunIds),
    fetchUsoProfissionalLookup(productIds),
  ]);
  const lookups: ProductLookups = { users: userMap, sessions: sessionMap, usoProfissional: usoMap };

  const excelRows = allProducts.map((p) => productToRow(p, skuPrefix, lookups));
  writeExcel(excelRows, fileName);
  toast.success(`${allProducts.length} produto(s) exportado(s) com sucesso!`);
}
