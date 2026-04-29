-- Add change_type column
ALTER TABLE public.sync_staging 
ADD COLUMN IF NOT EXISTS change_type TEXT;

-- Index for better filtering performance
CREATE INDEX IF NOT EXISTS idx_sync_staging_change_type ON public.sync_staging(change_type);

-- Create a function to delete orphan sync_staging records
CREATE OR REPLACE FUNCTION public.delete_orphan_sync_staging_by_job()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.sync_staging WHERE ingestion_job_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for ingestion_jobs
DROP TRIGGER IF EXISTS trigger_delete_sync_staging_on_job_delete ON public.ingestion_jobs;
CREATE TRIGGER trigger_delete_sync_staging_on_job_delete
BEFORE DELETE ON public.ingestion_jobs
FOR EACH ROW EXECUTE FUNCTION public.delete_orphan_sync_staging_by_job();

-- Create a function to delete orphan sync_staging records by product
CREATE OR REPLACE FUNCTION public.delete_orphan_sync_staging_by_product()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.sync_staging WHERE existing_product_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for products
DROP TRIGGER IF EXISTS trigger_delete_sync_staging_on_product_delete ON public.products;
CREATE TRIGGER trigger_delete_sync_staging_on_product_delete
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.delete_orphan_sync_staging_by_product();

-- Clear current staging state
DELETE FROM public.sync_staging;
