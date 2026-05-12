-- Enable RLS on uploaded_files if not already enabled
ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

-- Policy for viewing files (users in the same workspace)
CREATE POLICY "Users can view files in their workspace"
ON public.uploaded_files FOR SELECT
TO authenticated
USING (workspace_id IN (
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
));

-- Policy for inserting files
CREATE POLICY "Users can insert files into their workspace"
ON public.uploaded_files FOR INSERT
TO authenticated
WITH CHECK (workspace_id IN (
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
));

-- Policy for updating files
CREATE POLICY "Users can update files in their workspace"
ON public.uploaded_files FOR UPDATE
TO authenticated
USING (workspace_id IN (
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
));

-- Policy for deleting files
CREATE POLICY "Users can delete files in their workspace"
ON public.uploaded_files FOR DELETE
TO authenticated
USING (workspace_id IN (
  SELECT workspace_id FROM public.profiles WHERE id = auth.uid()
));