
-- Product Localizations
CREATE TABLE public.product_localizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  locale text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  translated_title text,
  translated_short_description text,
  translated_description text,
  translated_meta_title text,
  translated_meta_description text,
  translated_slug text,
  translated_tags text[],
  translated_faq jsonb,
  translated_image_alt_texts jsonb,
  quality_score integer DEFAULT 0,
  needs_review boolean DEFAULT true,
  source_language text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, locale)
);
ALTER TABLE public.product_localizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace localizations" ON public.product_localizations FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- Translation Memories
CREATE TABLE public.translation_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_locale text NOT NULL,
  target_locale text NOT NULL,
  source_text text NOT NULL,
  translated_text text NOT NULL,
  field_type text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  approved_by uuid,
  confidence_score integer DEFAULT 80,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.translation_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace translation memories" ON public.translation_memories FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- Terminology Dictionaries
CREATE TABLE public.terminology_dictionaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_locale text NOT NULL,
  target_locale text NOT NULL,
  source_term text NOT NULL,
  target_term text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  channel_id uuid,
  is_mandatory boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.terminology_dictionaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace terminology" ON public.terminology_dictionaries FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- Locale Style Guides
CREATE TABLE public.locale_style_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  locale text NOT NULL,
  channel_id uuid,
  tone text,
  seo_rules jsonb,
  writing_rules jsonb,
  forbidden_terms text[],
  preferred_patterns text[],
  cta_patterns text[],
  units_style jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.locale_style_guides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace style guides" ON public.locale_style_guides FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- Translation Jobs
CREATE TABLE public.translation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_locale text NOT NULL,
  target_locales text[] NOT NULL,
  product_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  processed_products integer DEFAULT 0,
  failed_products integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.translation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace translation jobs" ON public.translation_jobs FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- Translation Job Items
CREATE TABLE public.translation_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.translation_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  locale text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  fields_translated text[],
  confidence_score integer DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.translation_job_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage translation job items" ON public.translation_job_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.translation_jobs tj WHERE tj.id = job_id AND public.has_workspace_access_hybrid(tj.workspace_id, 'viewer'))
);

-- Updated_at triggers
CREATE TRIGGER update_product_localizations_updated_at BEFORE UPDATE ON public.product_localizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_locale_style_guides_updated_at BEFORE UPDATE ON public.locale_style_guides FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
