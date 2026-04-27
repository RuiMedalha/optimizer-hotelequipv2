-- 1) Storage: remove broad public SELECT policies for product-images
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "product-images: public read" ON storage.objects;

-- Allow only workspace members to LIST/SELECT objects metadata in product-images
-- (Direct file URLs continue to work via Supabase's public bucket URL resolver)
CREATE POLICY "product-images: workspace members can list"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND has_workspace_access(((storage.foldername(name))[1])::uuid, 'viewer'::workspace_role)
);

-- 2) Revoke EXECUTE from anon on SECURITY DEFINER helpers (keep authenticated)
REVOKE EXECUTE ON FUNCTION public.can_assign_workspace_role(uuid, workspace_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_edit_workspace_content(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_manage_workspace(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_manage_workspace_member_row(uuid, workspace_role, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_publish_in_workspace(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.compute_product_completeness_score(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.enqueue_product_for_review(uuid, uuid, review_reason, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_active_schema_for_product(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_channel_workspace_id(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_decision_workspace_id(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_product_assets(uuid, uuid, asset_usage_enum) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_product_filter_options(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_product_stats(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_products_page(uuid, text, text, text, text, text, text, integer, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_simulation_run_workspace_id(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_supplier_workspace_id(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_workspace_role(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_workspace_access(uuid, workspace_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_workspace_access_hybrid(uuid, workspace_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.increment_image_credits(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.increment_scraping_credits(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_workspace_owner(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.search_knowledge(text, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.search_knowledge(text, uuid, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.search_knowledge_hybrid(text, uuid, text, integer) FROM anon, public;

-- Trigger functions: revoke from both anon and authenticated (only the engine needs them)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.auto_insert_workspace_owner() FROM anon, authenticated, public;