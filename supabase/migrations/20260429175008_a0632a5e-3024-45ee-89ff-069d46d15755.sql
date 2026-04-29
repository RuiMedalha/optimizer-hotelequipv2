ALTER TABLE public.sync_staging DROP CONSTRAINT IF EXISTS fk_sync_staging_workspace;
ALTER TABLE public.sync_staging DROP CONSTRAINT IF EXISTS fk_sync_staging_supplier;
ALTER TABLE public.sync_staging DROP CONSTRAINT IF EXISTS fk_sync_staging_job;

-- Garantir que a FK para ingestion_jobs existe apenas uma vez (já que não existia antes da minha intervenção)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_staging_ingestion_job_id_fkey') THEN
        ALTER TABLE public.sync_staging 
        ADD CONSTRAINT sync_staging_ingestion_job_id_fkey 
        FOREIGN KEY (ingestion_job_id) REFERENCES public.ingestion_jobs(id) ON DELETE SET NULL;
    END IF;
END $$;