ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS published_to_url text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS published_at timestamptz;