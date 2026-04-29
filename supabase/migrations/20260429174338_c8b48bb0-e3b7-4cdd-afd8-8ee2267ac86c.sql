ALTER TABLE public.sync_staging
ADD CONSTRAINT fk_sync_staging_workspace
FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
ON DELETE CASCADE;

ALTER TABLE public.sync_staging
ADD CONSTRAINT fk_sync_staging_supplier
FOREIGN KEY (supplier_id) REFERENCES public.supplier_profiles(id)
ON DELETE SET NULL;

ALTER TABLE public.sync_staging
ADD CONSTRAINT fk_sync_staging_job
FOREIGN KEY (ingestion_job_id) REFERENCES public.ingestion_jobs(id)
ON DELETE SET NULL;