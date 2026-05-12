UPDATE storage.buckets 
SET public = true 
WHERE name = 'product-images';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND schemaname = 'storage' 
        AND policyname = 'Public read access for product-images'
    ) THEN
        CREATE POLICY "Public read access for product-images"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'product-images');
    END IF;
END $$;