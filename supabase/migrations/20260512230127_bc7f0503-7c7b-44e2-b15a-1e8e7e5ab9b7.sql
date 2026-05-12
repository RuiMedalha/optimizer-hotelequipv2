-- Ensure the storage bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-base', 'knowledge-base', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload files to knowledge-base
CREATE POLICY "Allow authenticated users to upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'knowledge-base');

-- Allow authenticated users to view files in knowledge-base
CREATE POLICY "Allow authenticated users to view files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'knowledge-base');

-- Allow authenticated users to update their files
CREATE POLICY "Allow authenticated users to update files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'knowledge-base');

-- Allow authenticated users to delete their files
CREATE POLICY "Allow authenticated users to delete files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'knowledge-base');