-- Tighten storage.objects RLS for the 'product-images' bucket.
-- Convention: path must start with {workspace_id}/...
-- SELECT remains public (bucket is public for serving images to WC/site).
-- INSERT/UPDATE/DELETE require active editor+ membership on the workspace
-- whose UUID is the first folder segment of the object name.

-- Drop existing INSERT/UPDATE/DELETE policies for this bucket if present.
-- We use DO blocks to drop only matching policies safely.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        policyname ILIKE '%product-images%'
        OR policyname ILIKE '%product_images%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- INSERT: only active editor+ members of the workspace matching the first path segment
CREATE POLICY "product-images: workspace members can insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND public.has_workspace_access(
    ((storage.foldername(name))[1])::uuid,
    'editor'::public.workspace_role
  )
);

-- UPDATE: same constraint, validated on both old and new rows
CREATE POLICY "product-images: workspace members can update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND public.has_workspace_access(
    ((storage.foldername(name))[1])::uuid,
    'editor'::public.workspace_role
  )
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND public.has_workspace_access(
    ((storage.foldername(name))[1])::uuid,
    'editor'::public.workspace_role
  )
);

-- DELETE: same membership requirement
CREATE POLICY "product-images: workspace members can delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND public.has_workspace_access(
    ((storage.foldername(name))[1])::uuid,
    'editor'::public.workspace_role
  )
);

-- SELECT: keep public read access for the bucket (needed for previews and WooCommerce).
-- Only create if no public SELECT policy already exists for this bucket.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd = 'SELECT'
      AND qual ILIKE '%product-images%'
  ) THEN
    CREATE POLICY "product-images: public read"
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'product-images');
  END IF;
END $$;