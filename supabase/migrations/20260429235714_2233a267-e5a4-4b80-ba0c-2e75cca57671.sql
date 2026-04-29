ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_title TEXT,
  ADD COLUMN IF NOT EXISTS supplier_description TEXT,
  ADD COLUMN IF NOT EXISTS supplier_short_description TEXT;