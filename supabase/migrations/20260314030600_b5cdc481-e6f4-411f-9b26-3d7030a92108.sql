
-- Supplier Schema Profiles: auto-detected structure from files
CREATE TABLE public.supplier_schema_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  source_file_id uuid NULL,
  file_type text NOT NULL DEFAULT 'excel',
  detected_columns jsonb DEFAULT '[]'::jsonb,
  sku_column text,
  price_column text,
  name_column text,
  ean_column text,
  image_column text,
  attribute_columns text[] DEFAULT '{}',
  variation_structure jsonb,
  detection_confidence numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Supplier Patterns: learned patterns across imports
CREATE TABLE public.supplier_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  pattern_type text NOT NULL,
  pattern_key text NOT NULL,
  pattern_value jsonb DEFAULT '{}'::jsonb,
  occurrences integer DEFAULT 1,
  confidence numeric DEFAULT 0.5,
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Supplier Data Quality Scores
CREATE TABLE public.supplier_data_quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  matching_accuracy numeric DEFAULT 0,
  missing_fields_rate numeric DEFAULT 0,
  conflict_rate numeric DEFAULT 0,
  parse_error_rate numeric DEFAULT 0,
  overall_score numeric DEFAULT 0,
  total_imports integer DEFAULT 0,
  total_products integer DEFAULT 0,
  last_calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Supplier Mapping Suggestions
CREATE TABLE public.supplier_mapping_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  source_column text NOT NULL,
  suggested_field text NOT NULL,
  confidence numeric DEFAULT 0.5,
  accepted boolean,
  created_at timestamptz DEFAULT now()
);

-- Supplier Knowledge Graph entries
CREATE TABLE public.supplier_knowledge_graph (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  node_type text NOT NULL,
  node_id text NOT NULL,
  node_label text,
  related_node_type text,
  related_node_id text,
  related_node_label text,
  relationship_type text NOT NULL,
  weight numeric DEFAULT 1.0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.supplier_schema_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_data_quality_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_mapping_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_knowledge_graph ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage supplier_schema_profiles" ON public.supplier_schema_profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.supplier_profiles sp JOIN public.workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_schema_profiles.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

CREATE POLICY "Users can manage supplier_patterns" ON public.supplier_patterns
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.supplier_profiles sp JOIN public.workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_patterns.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

CREATE POLICY "Users can manage supplier_data_quality_scores" ON public.supplier_data_quality_scores
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = supplier_data_quality_scores.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

CREATE POLICY "Users can manage supplier_mapping_suggestions" ON public.supplier_mapping_suggestions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.supplier_profiles sp JOIN public.workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_mapping_suggestions.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

CREATE POLICY "Users can manage supplier_knowledge_graph" ON public.supplier_knowledge_graph
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = supplier_knowledge_graph.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );
