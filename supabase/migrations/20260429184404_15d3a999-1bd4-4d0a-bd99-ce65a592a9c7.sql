-- Nenhuma alteração de esquema necessária, apenas lógica de aplicação e Edge Functions.
-- Mas vou garantir que os índices existem para performance em grandes volumes.

CREATE INDEX IF NOT EXISTS idx_products_sku_workspace ON public.products (sku, workspace_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_job_items_job_id_status ON public.ingestion_job_items (job_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_staging_workspace_status ON public.sync_staging (workspace_id, status);
