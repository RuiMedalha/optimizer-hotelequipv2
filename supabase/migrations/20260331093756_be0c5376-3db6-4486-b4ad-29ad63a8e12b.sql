-- Add unique constraint for resume capability (upsert)
ALTER TABLE public.category_architect_snapshots
  ADD CONSTRAINT category_architect_snapshots_rule_product_unique
  UNIQUE (rule_id, woo_product_id);

-- Reset the stuck migrating rule so it can be re-executed (will resume from snapshot)
UPDATE public.category_architect_rules
SET migration_status = 'attribute_created',
    migration_progress = 0,
    error_message = 'Reset após timeout - será retomado automaticamente'
WHERE id = '7a32b4cc-859c-477a-9fb5-c9cb193b8e9d'
  AND migration_status = 'migrating';

-- Remove the 2 duplicate rules that were created
DELETE FROM public.category_architect_rules
WHERE id IN ('627cb771-ef5d-4692-9914-57285c4b183b', '5c400117-3106-4620-b008-98782a4a30d5')
  AND migration_status = 'attribute_created'
  AND attribute_slug = 'pa_linha';