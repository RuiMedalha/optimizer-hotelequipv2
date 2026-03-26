
-- ORQ-9: Conflict Resolution & Human Review Orchestrator

-- Enums
CREATE TYPE public.conflict_type_enum AS ENUM ('source_value_conflict','identity_conflict','grouping_conflict','taxonomy_conflict','schema_conflict','pricing_conflict','asset_conflict','publish_conflict','channel_conflict');
CREATE TYPE public.conflict_scope_enum AS ENUM ('field','product','group','category','asset_set','channel_payload');
CREATE TYPE public.severity_enum AS ENUM ('low','medium','high','critical');
CREATE TYPE public.conflict_status_enum AS ENUM ('open','in_review','auto_resolved','human_resolved','rejected','closed');
CREATE TYPE public.auto_resolution_status_enum AS ENUM ('not_attempted','resolved','failed','escalated');
CREATE TYPE public.selection_status_enum AS ENUM ('candidate','selected','rejected','needs_review');
CREATE TYPE public.task_type_enum AS ENUM ('field_review','identity_review','grouping_review','taxonomy_review','pricing_review','asset_review','publish_approval','manual_override');
CREATE TYPE public.review_task_status_enum AS ENUM ('pending','assigned','in_review','approved','rejected','cancelled','done');
CREATE TYPE public.decision_type_enum AS ENUM ('approve','reject','override','defer','split','merge','rebuild','block_publish','unlock_publish');
CREATE TYPE public.resolution_mode_enum AS ENUM ('highest_confidence','source_priority','manual_only','schema_first','price_rule_first','asset_rule_first','hybrid');
CREATE TYPE public.approval_mode_enum AS ENUM ('auto','human_optional','human_required','blocked');
CREATE TYPE public.resolution_source_enum AS ENUM ('system','human','policy','supplier_memory','schema_engine');

-- conflict_cases
CREATE TABLE public.conflict_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  canonical_product_id uuid REFERENCES public.canonical_products(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE SET NULL,
  conflict_type public.conflict_type_enum NOT NULL,
  conflict_scope public.conflict_scope_enum NOT NULL DEFAULT 'field',
  severity public.severity_enum NOT NULL DEFAULT 'medium',
  status public.conflict_status_enum NOT NULL DEFAULT 'open',
  auto_resolution_status public.auto_resolution_status_enum NOT NULL DEFAULT 'not_attempted',
  requires_human_review boolean NOT NULL DEFAULT false,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conflict_cases_workspace ON public.conflict_cases(workspace_id);
CREATE INDEX idx_conflict_cases_status ON public.conflict_cases(status);
CREATE INDEX idx_conflict_cases_severity ON public.conflict_cases(severity);
CREATE INDEX idx_conflict_cases_canonical ON public.conflict_cases(canonical_product_id);
CREATE INDEX idx_conflict_cases_product ON public.conflict_cases(product_id);

ALTER TABLE public.conflict_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage conflict_cases in their workspace" ON public.conflict_cases FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- conflict_case_items
CREATE TABLE public.conflict_case_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_case_id uuid NOT NULL REFERENCES public.conflict_cases(id) ON DELETE CASCADE,
  field_name text,
  source_type text,
  source_record_id text,
  candidate_value jsonb,
  confidence_score numeric DEFAULT 0,
  validation_status text DEFAULT 'pending',
  selection_status public.selection_status_enum NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conflict_case_items_case ON public.conflict_case_items(conflict_case_id);

ALTER TABLE public.conflict_case_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage conflict_case_items via case" ON public.conflict_case_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.conflict_cases cc WHERE cc.id = conflict_case_id AND public.has_workspace_access_hybrid(cc.workspace_id, 'viewer'))
);

-- conflict_resolution_rules
CREATE TABLE public.conflict_resolution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  conflict_type public.conflict_type_enum NOT NULL,
  resolution_mode public.resolution_mode_enum NOT NULL DEFAULT 'source_priority',
  rule_priority integer NOT NULL DEFAULT 50,
  rule_config jsonb DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conflict_resolution_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage conflict_resolution_rules in workspace" ON public.conflict_resolution_rules FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- human_review_tasks
CREATE TABLE public.human_review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  review_queue_id uuid,
  conflict_case_id uuid REFERENCES public.conflict_cases(id) ON DELETE SET NULL,
  canonical_product_id uuid REFERENCES public.canonical_products(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  task_type public.task_type_enum NOT NULL,
  priority integer NOT NULL DEFAULT 50,
  assigned_to uuid,
  status public.review_task_status_enum NOT NULL DEFAULT 'pending',
  review_reason text,
  review_payload jsonb DEFAULT '{}',
  decision_payload jsonb,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_human_review_tasks_workspace ON public.human_review_tasks(workspace_id);
CREATE INDEX idx_human_review_tasks_status ON public.human_review_tasks(status);
CREATE INDEX idx_human_review_tasks_assigned ON public.human_review_tasks(assigned_to);

ALTER TABLE public.human_review_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage human_review_tasks in workspace" ON public.human_review_tasks FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- review_assignments
CREATE TABLE public.review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_task_id uuid NOT NULL REFERENCES public.human_review_tasks(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL,
  assigned_by uuid,
  assignment_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.review_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage review_assignments via task" ON public.review_assignments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.human_review_tasks t WHERE t.id = review_task_id AND public.has_workspace_access_hybrid(t.workspace_id, 'viewer'))
);

-- review_decisions
CREATE TABLE public.review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_task_id uuid NOT NULL REFERENCES public.human_review_tasks(id) ON DELETE CASCADE,
  decision_type public.decision_type_enum NOT NULL,
  decision_reason text,
  field_overrides jsonb,
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.review_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage review_decisions via task" ON public.review_decisions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.human_review_tasks t WHERE t.id = review_task_id AND public.has_workspace_access_hybrid(t.workspace_id, 'viewer'))
);

-- publish_approval_rules
CREATE TABLE public.publish_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  applies_to_channel uuid,
  applies_to_category uuid,
  approval_mode public.approval_mode_enum NOT NULL DEFAULT 'auto',
  min_quality_score integer DEFAULT 0,
  min_confidence_score integer DEFAULT 0,
  require_human_approval boolean NOT NULL DEFAULT false,
  block_on_conflict boolean NOT NULL DEFAULT true,
  rule_config jsonb DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.publish_approval_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage publish_approval_rules in workspace" ON public.publish_approval_rules FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- resolution_history
CREATE TABLE public.resolution_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_case_id uuid NOT NULL REFERENCES public.conflict_cases(id) ON DELETE CASCADE,
  resolution_source public.resolution_source_enum NOT NULL DEFAULT 'system',
  resolution_action text,
  before_state jsonb,
  after_state jsonb,
  confidence_delta numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resolution_history_case ON public.resolution_history(conflict_case_id);

ALTER TABLE public.resolution_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage resolution_history via case" ON public.resolution_history FOR ALL USING (
  EXISTS (SELECT 1 FROM public.conflict_cases cc WHERE cc.id = conflict_case_id AND public.has_workspace_access_hybrid(cc.workspace_id, 'viewer'))
);
