-- Add origin column to products table if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'products' AND column_name = 'origin') THEN
        ALTER TABLE public.products ADD COLUMN origin TEXT;
    END IF;
END $$;

-- Add index for performance on filtering by origin
CREATE INDEX IF NOT EXISTS idx_products_origin ON public.products(origin);