-- Function to mark stuck publish jobs as failed
CREATE OR REPLACE FUNCTION public.mark_stuck_publish_jobs_failed()
RETURNS TABLE(job_id uuid, marked_failed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _stuck record;
  _reason text;
BEGIN
  FOR _stuck IN
    SELECT id, status, processed_products, total_products, updated_at
    FROM public.publish_jobs
    WHERE status IN ('processing', 'queued')
      AND updated_at < now() - INTERVAL '10 minutes'
  LOOP
    _reason := format(
      'Trabalho interrompido automaticamente: sem atividade há %s minutos (estado=%s, %s/%s processados).',
      EXTRACT(EPOCH FROM (now() - _stuck.updated_at))::int / 60,
      _stuck.status,
      _stuck.processed_products,
      _stuck.total_products
    );

    UPDATE public.publish_jobs
    SET status = 'failed',
        error_message = _reason,
        completed_at = now(),
        updated_at = now()
    WHERE id = _stuck.id;

    UPDATE public.publish_job_items
    SET status = 'error'::job_item_status,
        completed_at = COALESCE(completed_at, now()),
        error_message = COALESCE(error_message, 'Trabalho interrompido por inatividade do servidor.')
    WHERE job_id = _stuck.id
      AND status NOT IN ('done', 'error', 'skipped');

    job_id := _stuck.id;
    marked_failed := true;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

-- Schedule cleanup every 2 minutes
SELECT cron.unschedule('mark-stuck-publish-jobs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mark-stuck-publish-jobs');

SELECT cron.schedule(
  'mark-stuck-publish-jobs',
  '*/2 * * * *',
  $$ SELECT public.mark_stuck_publish_jobs_failed(); $$
);