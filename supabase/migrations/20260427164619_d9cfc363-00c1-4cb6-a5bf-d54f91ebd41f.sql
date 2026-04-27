ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock INTEGER;

COMMENT ON COLUMN public.products.stock IS 'Current stock quantity of the product';
