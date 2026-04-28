ALTER TABLE public.ingestion_jobs ADD COLUMN config JSONB;

COMMENT ON COLUMN public.ingestion_jobs.config IS 'Stores the configuration used for this job, including field_mappings, sku_prefix, source_language, etc.';