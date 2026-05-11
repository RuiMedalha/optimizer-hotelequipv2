ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_status text DEFAULT 'ok';

-- Update existing products that already have no images:
UPDATE products 
SET image_status = 'missing' 
WHERE (image_urls IS NULL OR array_length(image_urls, 1) IS NULL) 
AND image_status = 'ok';