ALTER TABLE public.product_uso_profissional
ADD COLUMN IF NOT EXISTS routing_in_description boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS routing_in_custom_field boolean NOT NULL DEFAULT false;