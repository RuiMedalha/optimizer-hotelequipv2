ALTER TABLE public.ingestion_jobs 
ADD COLUMN role TEXT,
ADD COLUMN supplier_id UUID REFERENCES public.supplier_profiles(id);

CREATE INDEX idx_ingestion_jobs_role ON public.ingestion_jobs(role);
CREATE INDEX idx_ingestion_jobs_supplier_id ON public.ingestion_jobs(supplier_id);