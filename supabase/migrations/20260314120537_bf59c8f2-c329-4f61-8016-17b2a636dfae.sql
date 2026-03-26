
-- Add lifecycle columns to supplier_playbook_drafts
ALTER TABLE public.supplier_playbook_drafts 
  ADD COLUMN IF NOT EXISTS ingestion_job_id uuid DEFAULT null,
  ADD COLUMN IF NOT EXISTS uploaded_file_id uuid DEFAULT null,
  ADD COLUMN IF NOT EXISTS promoted_playbook_id uuid DEFAULT null,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT null,
  ADD COLUMN IF NOT EXISTS version_number integer DEFAULT 1;

-- Add lifecycle columns to supplier_playbooks  
ALTER TABLE public.supplier_playbooks
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT null,
  ADD COLUMN IF NOT EXISTS origin_draft_id uuid DEFAULT null,
  ADD COLUMN IF NOT EXISTS origin_ingestion_job_id uuid DEFAULT null;

-- Add soft delete / archive support to ingestion_jobs
ALTER TABLE public.ingestion_jobs
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT null;
