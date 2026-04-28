ALTER TABLE public.products ADD COLUMN brand TEXT;

COMMENT ON COLUMN public.products.brand IS 'The brand or manufacturer of the product.';