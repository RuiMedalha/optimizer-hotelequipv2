ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier_name TEXT;
CREATE INDEX IF NOT EXISTS idx_products_supplier_name ON public.products(supplier_name);