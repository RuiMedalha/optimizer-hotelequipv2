import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Enums, Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export type Product = Tables<"products">;

export interface ProductFilters {
  search?: string;
  status?: string;
  category?: string;
  productType?: string;
  sourceFile?: string;
  wooFilter?: string;
  imageStatus?: "failed" | "missing" | "ok" | "all" | "any_issue";
  publishabilityDecision?: string;
  publishedToUrl?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedProducts {
  products: Product[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Server-side paginated products query.
 * Uses a SQL function for filtering + pagination at database level.
 */
export function useProducts(filters: ProductFilters = {}) {
  const { activeWorkspace } = useWorkspaceContext();
  const {
    search = "",
    status = "all",
    category = "all",
    productType = "all",
    sourceFile = "all",
    wooFilter = "all",
    imageStatus = "all",
    publishabilityDecision = "all",
    publishedToUrl = "all",
    page = 1,
    pageSize = 100,
  } = filters;

  return useQuery({
    queryKey: [
      "products",
      activeWorkspace?.id,
      search,
      status,
      category,
      productType,
      sourceFile,
      wooFilter,
      imageStatus,
      publishabilityDecision,
      publishedToUrl,
      page,
      pageSize,
    ],
    enabled: !!activeWorkspace,
    queryFn: async (): Promise<PaginatedProducts> => {
      // Ensure we send 'all' if the value is missing or undefined
      const targetPublishedToUrl = publishedToUrl || 'all';

      const { data, error } = await supabase.rpc("get_products_page", {
        _workspace_id: activeWorkspace!.id,
        _search: search,
        _status: status,
        _category: category,
        _product_type: productType,
        _source_file: sourceFile,
        _woo_filter: wooFilter,
        _image_status: imageStatus,
        _publishability_decision: publishabilityDecision,
        _published_to_url: targetPublishedToUrl,
        _page: page,
        _page_size: pageSize,
      });

      if (error) {
        console.error("RPC Error in get_products_page:", error);
        throw error;
      }

      const rows = (data || []) as any[];
      const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

      // Strip total_count from each row to match Product type
      const products: Product[] = rows.map(({ total_count, ...rest }) => rest as Product);

      return {
        products,
        totalCount,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      };
    },
  });
}

/**
 * Lightweight hook to fetch ALL product IDs + minimal data for bulk operations.
 */
export function useAllProductIds() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["all-product-ids", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const all: any[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("products")
          .select("id, sku, original_title, optimized_title, product_type, parent_product_id, status, technical_specs, category, suggested_category, suggested_categories, source_file, woocommerce_id, image_urls, image_alt_texts, workspace_id, brand, supplier_name, short_description, original_description, optimized_description, attributes, suggested_category_confidence, is_discontinued, workflow_state")
          .eq("workspace_id", activeWorkspace!.id)
          .order("updated_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });
}

/**
 * Filter options (unique categories and source files) fetched from server.
 */
export function useProductFilterOptions() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["product-filter-options", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_product_filter_options", {
        _workspace_id: activeWorkspace!.id,
      });
      if (error) throw error;

      const categories: string[] = [];
      const sourceFiles: string[] = [];
      (data || []).forEach((row: any) => {
        if (row.filter_type === "category" && row.filter_value) categories.push(row.filter_value);
        if (row.filter_type === "source_file" && row.filter_value) sourceFiles.push(row.filter_value);
      });

      return {
        categories: categories.sort(),
        sourceFiles: sourceFiles.sort(),
      };
    },
  });
}

export function useUpdateProductStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: Enums<"product_status"> }) => {
      const { error } = await supabase
        .from("products")
        .update({ status })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      toast.success("Estado atualizado com sucesso!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useProductStats() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["product-stats", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_product_stats", {
        _workspace_id: activeWorkspace?.id ?? null,
      });
      if (error) throw error;

      let pending = 0, processing = 0, optimized = 0, needs_review = 0, published = 0, failed = 0, discontinued = 0, total = 0;
      let pub_publish = 0, pub_review = 0, pub_skip = 0, pub_null = 0;

      (data || []).forEach((row: any) => {
        const count = Number(row.count);
        
        // If product is discontinued, count only in the discontinued bucket
        if (row.is_discontinued) {
          discontinued += count;
          return;
        }

        // Only count non-discontinued products for total and other status
        total += count;
        
        // Status counts
        if (row.status === "pending") pending += count;
        else if (row.status === "processing") processing += count;
        else if (row.status === "optimized") optimized += count;
        else if (row.status === "needs_review") needs_review += count;
        else if (row.status === "published") published += count;
        else if (row.status === "error") failed += count;

        // Publishability counts
        if (row.publishability_decision === "publish") pub_publish += count;
        else if (row.publishability_decision === "review") pub_review += count;
        else if (row.publishability_decision === "skip") pub_skip += count;
        else if (row.publishability_decision === "null") pub_null += count;
      });

      return { 
        pending, processing, optimized, needs_review, published, failed, discontinued, total,
        publish: pub_publish, review: pub_review, skip: pub_skip, unanalyzed: pub_null
      };
    },
  });
}