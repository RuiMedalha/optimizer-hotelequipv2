ALTER TABLE products 
ADD COLUMN seo_short_description TEXT;

COMMENT ON COLUMN products.seo_short_description IS 
'Clean text-only version of short description for og:description meta tag (no HTML)';