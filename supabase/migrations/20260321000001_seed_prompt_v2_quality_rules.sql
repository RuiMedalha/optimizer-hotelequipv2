-- supabase/migrations/20260321000001_seed_prompt_v2_quality_rules.sql
--
-- Adds version 2 of the `product_optimization_global` prompt template,
-- appending 4 PT-PT writing quality rules to the v1 text.
--
-- NOTE: This migration does NOT affect the hardcoded fallback system prompt
-- inside supabase/functions/optimize-product/index.ts. That fallback is
-- updated separately in Task 5 of Block 1.5 (same migration batch).
--
-- Idempotent: safe to run multiple times. Will skip if v2 already exists.

DO $$
DECLARE
  t_id uuid;
  v1_text text;
  quality_rules text := E'\n\nREGRAS DE QUALIDADE DE ESCRITA:\n- Escreve sempre em português europeu (PT-PT), nunca em português do Brasil\n- Mantém um tom profissional e orientado a vendas B2B para setor HORECA e hotelaria\n- Nunca cortes frases a meio — cada campo deve terminar com pontuação completa\n- Nunca mistures a tabela técnica com o texto descritivo — a tabela vai SEMPRE separada';
BEGIN
  -- 1. Look up the global product_optimization_global template
  SELECT id INTO t_id
  FROM prompt_templates
  WHERE workspace_id IS NULL
    AND prompt_name = 'product_optimization_global'
  LIMIT 1;

  IF t_id IS NULL THEN
    RAISE NOTICE 'prompt_templates row "product_optimization_global" not found — skipping v2 seed';
    RETURN;
  END IF;

  -- 2. Skip if v2 already exists (idempotency guard)
  IF EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE template_id = t_id
      AND version_number = 2
  ) THEN
    RAISE NOTICE 'prompt_versions v2 already exists for template % — skipping', t_id;
    RETURN;
  END IF;

  -- 3. Get v1 prompt text to append to
  SELECT prompt_text INTO v1_text
  FROM prompt_versions
  WHERE template_id = t_id
    AND version_number = 1
  LIMIT 1;

  IF v1_text IS NULL THEN
    RAISE NOTICE 'prompt_versions v1 not found for template % — skipping v2 seed', t_id;
    RETURN;
  END IF;

  -- 4. Deactivate v1
  UPDATE prompt_versions
  SET is_active = false
  WHERE template_id = t_id
    AND version_number = 1;

  -- 5. Insert v2 with quality rules appended
  INSERT INTO prompt_versions (template_id, version_number, prompt_text, is_active)
  VALUES (t_id, 2, v1_text || quality_rules, true);

  RAISE NOTICE 'Successfully seeded prompt_versions v2 for template %', t_id;
END;
$$;
