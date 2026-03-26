
-- BLOCO 9.1: Extend Brain Foundation enums and tables

-- Extend brain_entity_type
ALTER TYPE public.brain_entity_type ADD VALUE IF NOT EXISTS 'product_family';
ALTER TYPE public.brain_entity_type ADD VALUE IF NOT EXISTS 'variant';
ALTER TYPE public.brain_entity_type ADD VALUE IF NOT EXISTS 'schema';
ALTER TYPE public.brain_entity_type ADD VALUE IF NOT EXISTS 'asset';
ALTER TYPE public.brain_entity_type ADD VALUE IF NOT EXISTS 'document';
ALTER TYPE public.brain_entity_type ADD VALUE IF NOT EXISTS 'feed';

-- Extend brain_relation_type
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'belongs_to_family';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'has_variant';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'uses_schema';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'derived_from';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'sourced_from';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'related_bundle';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'translated_to';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'published_to';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'blocked_by';
ALTER TYPE public.brain_relation_type ADD VALUE IF NOT EXISTS 'optimized_by';

-- Extend brain_observation_type
ALTER TYPE public.brain_observation_type ADD VALUE IF NOT EXISTS 'low_confidence';
ALTER TYPE public.brain_observation_type ADD VALUE IF NOT EXISTS 'feed_rejection';
ALTER TYPE public.brain_observation_type ADD VALUE IF NOT EXISTS 'high_conversion';
ALTER TYPE public.brain_observation_type ADD VALUE IF NOT EXISTS 'poor_ctr';
ALTER TYPE public.brain_observation_type ADD VALUE IF NOT EXISTS 'untranslated_content';
ALTER TYPE public.brain_observation_type ADD VALUE IF NOT EXISTS 'image_quality_issue';
ALTER TYPE public.brain_observation_type ADD VALUE IF NOT EXISTS 'schema_mismatch';
ALTER TYPE public.brain_observation_type ADD VALUE IF NOT EXISTS 'supplier_pattern_detected';

-- Extend brain_plan_status
ALTER TYPE public.brain_plan_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE public.brain_plan_status ADD VALUE IF NOT EXISTS 'waiting_review';

-- Extend brain_outcome_type
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'seo_score';
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'quality_score';
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'feed_acceptance';
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'publish_success';
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'ctr';
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'conversion_rate';
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'revenue';
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'review_time';
ALTER TYPE public.brain_outcome_type ADD VALUE IF NOT EXISTS 'completion_rate';

-- Extend brain_cluster_type
ALTER TYPE public.brain_cluster_type ADD VALUE IF NOT EXISTS 'technical_cluster';
ALTER TYPE public.brain_cluster_type ADD VALUE IF NOT EXISTS 'seo_cluster';
ALTER TYPE public.brain_cluster_type ADD VALUE IF NOT EXISTS 'visual_cluster';
ALTER TYPE public.brain_cluster_type ADD VALUE IF NOT EXISTS 'translation_cluster';
ALTER TYPE public.brain_cluster_type ADD VALUE IF NOT EXISTS 'monetization_cluster';
