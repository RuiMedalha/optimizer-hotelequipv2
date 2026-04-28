CREATE OR REPLACE FUNCTION public.increment_sku_alias_usage(ws_id UUID, supp_id UUID, sku_supp TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.sku_aliases
    SET vezes_usado = COALESCE(vezes_usado, 0) + 1,
        updated_at = NOW()
    WHERE workspace_id = ws_id
      AND supplier_id = supp_id
      AND sku_supplier = sku_supp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;