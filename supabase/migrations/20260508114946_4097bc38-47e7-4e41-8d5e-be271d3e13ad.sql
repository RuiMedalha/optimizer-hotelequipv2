DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'images_product_sort_unique'
    ) THEN
        ALTER TABLE public.images ADD CONSTRAINT images_product_sort_unique UNIQUE (product_id, sort_order);
    END IF;
END $$;