ALTER TABLE products 
ADD COLUMN certifications JSONB DEFAULT '[]'::jsonb;