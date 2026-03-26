# Production Hardening Block 2 — Prompt Governance + Logging Traceability

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all AI system prompts DB-driven (editable without code deploy) via `prompt_templates` / `prompt_versions`, and log which prompt version generated each AI output.

**Architecture:** The `resolve-ai-route` function already contains `resolvePromptTemplate()` which queries `ai_routing_rules → prompt_templates → prompt_versions`. The infrastructure exists but (a) all routing rules are workspace-scoped (NOT NULL workspace_id) so global defaults can't be seeded, (b) `resolvePromptTemplate()` doesn't return the `prompt_version_id`, and (c) no log table stores which version was used. This plan fixes all three gaps.

**Tech Stack:** Deno Edge Functions (TypeScript), Supabase PostgreSQL, `resolve-ai-route` routing layer.

---

## Scope boundaries

### What this plan changes
- `supabase/migrations/` — new migration: make `workspace_id` nullable in `prompt_templates` + `ai_routing_rules`; add unique index for global template names; fix RLS on `prompt_templates` and `prompt_versions`; add `prompt_version_id` to both log tables
- `supabase/migrations/` — new seed: global prompt templates + versions for 6 task types; routing rules for 5 of them
- `supabase/functions/resolve-ai-route/index.ts` — `resolvePromptTemplate()` checks global rules + returns `{ text, versionId }` instead of just `string`; response `meta` includes `promptVersionId`
- `supabase/functions/_shared/ai/provider-types.ts` — add `promptVersionId?: string` to `RunPromptParams` + `UsageLogEntry`
- `supabase/functions/_shared/ai/prompt-runner.ts` — pass `promptVersionId` through to `logUsage()`
- `supabase/functions/_shared/ai/usage-logger.ts` — write `prompt_version_id` to `ai_usage_logs`
- `supabase/functions/optimize-product/index.ts` — read `promptVersionId` from response meta; log in `optimization_logs`

### What this plan deliberately excludes
- Routing rule for `product_optimization` task type — both `optimize-product` and `run-ai-comparison` use this task type with different system prompts. Adding a global rule would silently replace run-ai-comparison's prompt. Fix deferred to Block 5 (give run-ai-comparison its own task type first).
- Per-field user prompts in `optimize-product` (the `DEFAULT_FIELD_PROMPTS` dictionary) — these are user-turn prompts, not system prompts. Governing them requires a different table design. Out of scope.
- `extract-pdf-pages` and `analyze-product-page` — these bypass `resolve-ai-route` entirely so prompt governance doesn't apply. Fixed in Block 5.
- Image generation task types (`image_lifestyle_generation`, `image_optimization`) — no system prompt to govern; the prompt IS the user message. Out of scope.

---

## File structure

```
supabase/migrations/
  20260320000011_prompt_governance_schema.sql   ← CREATE: schema changes
  20260320000012_seed_global_prompt_versions.sql ← CREATE: templates + versions + rules

supabase/functions/resolve-ai-route/
  index.ts                                       ← MODIFY: resolvePromptTemplate() + response meta

supabase/functions/_shared/ai/
  provider-types.ts                              ← MODIFY: RunPromptParams + UsageLogEntry
  prompt-runner.ts                               ← MODIFY: pass promptVersionId to logUsage
  usage-logger.ts                                ← MODIFY: write prompt_version_id

supabase/functions/optimize-product/
  index.ts                                       ← MODIFY: read + log promptVersionId
```

---

## Task 1: Schema migration

**Context:** `prompt_templates.workspace_id` and `ai_routing_rules.workspace_id` are both `NOT NULL`, making global (system-wide) templates impossible. We need to make them nullable. We also need: (a) a unique index on `prompt_templates(prompt_name) WHERE workspace_id IS NULL` so the seed migration can use `ON CONFLICT (prompt_name) DO NOTHING` for idempotency, (b) RLS fixes on `prompt_templates` (drop the old `"ws access"` FOR ALL policy) and `prompt_versions` (allow access to versions of global templates), (c) `prompt_version_id` added to both log tables.

Note: `optimization_logs.chunks_used` and `rag_match_types` already exist (added in a prior migration). They are NOT added here.

**Files:**
- Create: `supabase/migrations/20260320000011_prompt_governance_schema.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260320000011_prompt_governance_schema.sql` with exactly this content:

```sql
-- Block 2: Prompt governance schema changes
-- 1. Allow global (workspace_id = NULL) prompt templates
-- 2. Unique index on prompt_templates(prompt_name) for global templates — enables
--    ON CONFLICT (prompt_name) DO NOTHING in seed migration (idempotency)
-- 3. Fix RLS on prompt_templates: drop old "ws access" FOR ALL policy; add split policies
--    that correctly allow SELECT/write on global rows (workspace_id IS NULL)
-- 4. Fix RLS on prompt_versions: allow access to versions of global templates
-- 5. Allow global routing rules (workspace_id = NULL) in ai_routing_rules
-- 6. Add prompt_version_id to log tables for traceability

-- ── prompt_templates: allow global (workspace_id = NULL) ─────────────────────
ALTER TABLE prompt_templates ALTER COLUMN workspace_id DROP NOT NULL;

-- Unique index so the seed migration can conflict on prompt_name for global rows
CREATE UNIQUE INDEX IF NOT EXISTS prompt_templates_global_name_idx
  ON prompt_templates (prompt_name)
  WHERE workspace_id IS NULL;

-- Drop ALL existing prompt_templates policies (including old "ws access" FOR ALL)
-- and replace with correct split policies that handle NULL workspace_id
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "ws access" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can manage workspace prompt_templates" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view global or workspace prompt_templates" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can insert prompt templates" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update prompt templates" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete prompt templates" ON prompt_templates';
END $$;

CREATE POLICY "Users can view global or workspace prompt_templates"
  ON prompt_templates FOR SELECT TO authenticated
  USING (workspace_id IS NULL OR public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Users can insert prompt templates"
  ON prompt_templates FOR INSERT TO authenticated
  WITH CHECK (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

CREATE POLICY "Users can update prompt templates"
  ON prompt_templates FOR UPDATE TO authenticated
  USING (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

CREATE POLICY "Users can delete prompt templates"
  ON prompt_templates FOR DELETE TO authenticated
  USING (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

-- ── prompt_versions: allow access to versions of global templates ─────────────
-- The existing "access via template" policy uses has_workspace_access_hybrid(t.workspace_id, ...)
-- which fails when t.workspace_id IS NULL (global template). Replace it.
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "access via template" ON prompt_versions';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view global or workspace prompt_versions" ON prompt_versions';
END $$;

CREATE POLICY "Users can view global or workspace prompt_versions"
  ON prompt_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prompt_templates t
      WHERE t.id = template_id
        AND (
          t.workspace_id IS NULL
          OR public.has_workspace_access(t.workspace_id, 'viewer')
        )
    )
  );

-- ── ai_routing_rules: allow global (workspace_id = NULL) ─────────────────────
ALTER TABLE ai_routing_rules ALTER COLUMN workspace_id DROP NOT NULL;

-- The existing UNIQUE(workspace_id, task_type) constraint requires both NOT NULL.
-- Drop it and replace with two partial unique indexes that handle NULLs correctly.
ALTER TABLE ai_routing_rules
  DROP CONSTRAINT IF EXISTS ai_routing_rules_workspace_id_task_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS ai_routing_rules_global_task_type_idx
  ON ai_routing_rules (task_type)
  WHERE workspace_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_routing_rules_workspace_task_type_idx
  ON ai_routing_rules (workspace_id, task_type)
  WHERE workspace_id IS NOT NULL;

-- Update RLS on ai_routing_rules
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Users can manage workspace ai_routing_rules" ON ai_routing_rules';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view global or workspace ai_routing_rules" ON ai_routing_rules';
  EXECUTE 'DROP POLICY IF EXISTS "Users can manage ai_routing_rules" ON ai_routing_rules';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update ai_routing_rules" ON ai_routing_rules';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete ai_routing_rules" ON ai_routing_rules';
END $$;

CREATE POLICY "Users can view global or workspace ai_routing_rules"
  ON ai_routing_rules FOR SELECT TO authenticated
  USING (workspace_id IS NULL OR public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Users can manage ai_routing_rules"
  ON ai_routing_rules FOR INSERT TO authenticated
  WITH CHECK (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

CREATE POLICY "Users can update ai_routing_rules"
  ON ai_routing_rules FOR UPDATE TO authenticated
  USING (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

CREATE POLICY "Users can delete ai_routing_rules"
  ON ai_routing_rules FOR DELETE TO authenticated
  USING (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

-- ── optimization_logs: add prompt_version_id for traceability ────────────────
-- NOTE: chunks_used and rag_match_types already exist (added in a prior migration).
ALTER TABLE optimization_logs
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid REFERENCES prompt_versions(id);

-- ── ai_usage_logs: add prompt_version_id for traceability ────────────────────
ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid REFERENCES prompt_versions(id);
```

- [ ] **Step 2: Apply the migration locally**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npx supabase db push 2>&1 | tail -20
```

Expected: migration applied without errors. If `supabase db push` is unavailable, run:
```bash
npx supabase migration up
```

- [ ] **Step 3: Verify schema changes**

```bash
npx supabase db diff --use-migra 2>&1 | grep -E "(prompt_version_id|workspace_id|chunks_used|rag_match_types)" | head -20
```

Expected: no diff for these columns (they're now in the DB).

Alternatively verify by checking if the migration file is accepted when applying.

- [ ] **Step 4: Run tests**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npm run test
```

Expected: 16/16 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260320000011_prompt_governance_schema.sql
git commit -m "feat: schema migration for global prompt governance + add prompt_version_id to log tables"
```

---

## Task 2: Seed global prompt templates + versions + routing rules

**Context:** With nullable `workspace_id`, we can now create global (system-wide) prompt templates that apply to all workspaces. This seeds the 6 task types that have a single system prompt and a single caller:
- `product_enrichment` (caller: enrich-products)
- `knowledge_reranking` (caller: optimize-product)
- `variation_attribute_extraction` (caller: optimize-product — prompt is currently EN, will be translated in Block 3)
- `pdf_text_extraction` (caller: parse-catalog — note: parse-catalog passes `workspaceId: "system"` which is not a valid UUID; the global rule will be found via the new fallback path)
- `pdf_product_extraction` (caller: parse-catalog)
- `product_optimization` — template seeded for reference but **NO routing rule** yet (both optimize-product and run-ai-comparison use this task type with different system prompts; adding a global rule now would silently replace run-ai-comparison's prompt — fix deferred to Block 5)

**Files:**
- Create: `supabase/migrations/20260320000012_seed_global_prompt_versions.sql`

- [ ] **Step 1: Write the seed migration file**

Create `supabase/migrations/20260320000012_seed_global_prompt_versions.sql`:

```sql
-- Block 2: Seed global prompt templates + versions + routing rules.
-- These are the system prompts currently hardcoded in edge functions.
-- Seeding them into DB enables editing without code deploy.
-- The edge function hardcoded values remain as fallback if DB lookup fails.
--
-- IDEMPOTENCY NOTE: Each INSERT uses ON CONFLICT (prompt_name) DO NOTHING,
-- relying on the unique index prompt_templates_global_name_idx created in the
-- schema migration. When the conflict fires (row already exists), RETURNING
-- produces no row and t_id stays NULL — the subsequent IF t_id IS NOT NULL
-- block is then skipped. This is correct: on re-run, the version and routing
-- rule already exist from the first run, so skipping re-insertion is safe.
--
-- NOTE: product_optimization template is seeded but has NO routing rule yet.
--       Both optimize-product and run-ai-comparison use that task_type with
--       different system prompts. Routing rule added in Block 5 after
--       run-ai-comparison gets its own task_type.
--
-- NOTE: variation_attribute_extraction prompt is currently in English.
--       It will be translated to PT-PT in Block 3 via a new prompt_version.

DO $$
DECLARE
  -- Template IDs
  t_product_optimization   UUID;
  t_product_enrichment     UUID;
  t_knowledge_reranking    UUID;
  t_variation_extraction   UUID;
  t_pdf_text_extraction    UUID;
  t_pdf_product_extraction UUID;
BEGIN

  -- ── product_optimization ─────────────────────────────────────────────────
  INSERT INTO prompt_templates
    (workspace_id, prompt_name, prompt_type, base_prompt, description, is_active)
  VALUES (
    NULL,
    'product_optimization_global',
    'system',
    'És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional. Mantém sempre as características técnicas do produto NUMA TABELA HTML separada do texto comercial. Traduz tudo para português europeu.',
    'Global system prompt for product optimization (optimize-product). No routing rule yet — see Block 5.',
    true
  )
  ON CONFLICT (prompt_name) DO NOTHING
  RETURNING id INTO t_product_optimization;

  IF t_product_optimization IS NOT NULL THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_product_optimization, 1,
      'És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional. Mantém sempre as características técnicas do produto NUMA TABELA HTML separada do texto comercial. Traduz tudo para português europeu.',
      true,
      'v1 — migrated from hardcoded optimize-product system prompt (2026-03-20)'
    );
    -- No routing rule for product_optimization yet (see note above)
  END IF;

  -- ── product_enrichment ───────────────────────────────────────────────────
  INSERT INTO prompt_templates
    (workspace_id, prompt_name, prompt_type, base_prompt, description, is_active)
  VALUES (
    NULL,
    'product_enrichment_global',
    'system',
    E'És um especialista em extração de dados de produtos. Analisas páginas web de fornecedores/fabricantes e extraís dados estruturados.\n\nREGRAS PARA IMAGENS:\n- Extrai APENAS imagens que pertencem a ESTE produto específico visualizado na página\n- Foca em: foto principal do produto, imagens de galeria/carrossel, ângulos alternativos, vistas de detalhe, zoom\n- Estas encontram-se tipicamente dentro de um contentor de galeria de imagens, lightbox ou carrossel — geralmente o primeiro conjunto de imagens na página\n- EXCLUI ESTRITAMENTE: ícones de navegação, miniaturas de categoria, logótipos de rodapé, banners de newsletter, ícones de redes sociais, imagens de popup de cookies, imagens de "produtos relacionados", imagens de "também pode gostar", logótipos de marca, ícones de métodos de pagamento, ícones de envio, selos de confiança, ícones SVG, qualquer imagem com menos de 100px\n- NÃO incluas imagens de "produtos relacionados", "produtos recomendados", "produtos da mesma série", ou qualquer secção que mostre OUTROS produtos\n- Um produto típico tem 1-8 imagens. Se encontrares mais de 10, provavelmente estás a incluir imagens não relacionadas com o produto — sê mais seletivo\n- Em caso de dúvida, EXCLUI a imagem\n\nREGRAS PARA VARIAÇÕES:\n- Deteta variações APENAS se a página mostrar claramente um seletor (seletor de tamanho, de cor, dropdown) para ESTE produto\n- CRÍTICO: Reporta apenas variações que tenham SKUs REAIS visíveis na página (em URLs, atributos onclick, atributos data, ou valores de opção)\n- NUNCA inventes ou adivinhes SKUs — se não encontrares um código SKU real para uma variação, NÃO a incluas no array "skus"\n- Se vires valores de variação (ex: tamanhos) mas NENHUM SKU associado, devolve os valores SEM o array skus\n- O array "skus" DEVE conter apenas códigos alfanuméricos curtos (ex: "80020", "UD12345"), NUNCA URLs completos\n- Se o link de uma variação for "https://fornecedor.com/nome-produto/80020", o SKU é "80020"\n\nREGRAS PARA ESPECIFICAÇÕES:\n- Extrai especificações técnicas como pares chave-valor estruturados\n- Identifica o nome da série/família do produto se visível',
    'Global system prompt for product enrichment (enrich-products).',
    true
  )
  ON CONFLICT (prompt_name) DO NOTHING
  RETURNING id INTO t_product_enrichment;

  IF t_product_enrichment IS NOT NULL THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_product_enrichment, 1,
      E'És um especialista em extração de dados de produtos. Analisas páginas web de fornecedores/fabricantes e extraís dados estruturados.\n\nREGRAS PARA IMAGENS:\n- Extrai APENAS imagens que pertencem a ESTE produto específico visualizado na página\n- Foca em: foto principal do produto, imagens de galeria/carrossel, ângulos alternativos, vistas de detalhe, zoom\n- Estas encontram-se tipicamente dentro de um contentor de galeria de imagens, lightbox ou carrossel — geralmente o primeiro conjunto de imagens na página\n- EXCLUI ESTRITAMENTE: ícones de navegação, miniaturas de categoria, logótipos de rodapé, banners de newsletter, ícones de redes sociais, imagens de popup de cookies, imagens de "produtos relacionados", imagens de "também pode gostar", logótipos de marca, ícones de métodos de pagamento, ícones de envio, selos de confiança, ícones SVG, qualquer imagem com menos de 100px\n- NÃO incluas imagens de "produtos relacionados", "produtos recomendados", "produtos da mesma série", ou qualquer secção que mostre OUTROS produtos\n- Um produto típico tem 1-8 imagens. Se encontrares mais de 10, provavelmente estás a incluir imagens não relacionadas com o produto — sê mais seletivo\n- Em caso de dúvida, EXCLUI a imagem\n\nREGRAS PARA VARIAÇÕES:\n- Deteta variações APENAS se a página mostrar claramente um seletor (seletor de tamanho, de cor, dropdown) para ESTE produto\n- CRÍTICO: Reporta apenas variações que tenham SKUs REAIS visíveis na página (em URLs, atributos onclick, atributos data, ou valores de opção)\n- NUNCA inventes ou adivinhes SKUs — se não encontrares um código SKU real para uma variação, NÃO a incluas no array "skus"\n- Se vires valores de variação (ex: tamanhos) mas NENHUM SKU associado, devolve os valores SEM o array skus\n- O array "skus" DEVE conter apenas códigos alfanuméricos curtos (ex: "80020", "UD12345"), NUNCA URLs completos\n- Se o link de uma variação for "https://fornecedor.com/nome-produto/80020", o SKU é "80020"\n\nREGRAS PARA ESPECIFICAÇÕES:\n- Extrai especificações técnicas como pares chave-valor estruturados\n- Identifica o nome da série/família do produto se visível',
      true,
      'v1 — migrated from hardcoded enrich-products system prompt after Block 1 PT-PT translation (2026-03-20)'
    );

    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'product_enrichment', 'Enriquecimento de Produto (Global)', t_product_enrichment, true);
  END IF;

  -- ── knowledge_reranking ──────────────────────────────────────────────────
  INSERT INTO prompt_templates
    (workspace_id, prompt_name, prompt_type, base_prompt, description, is_active)
  VALUES (
    NULL,
    'knowledge_reranking_global',
    'system',
    'Responde APENAS com a tool call. Seleciona os excertos mais relevantes.',
    'Global system prompt for knowledge chunk reranking (optimize-product RAG step).',
    true
  )
  ON CONFLICT (prompt_name) DO NOTHING
  RETURNING id INTO t_knowledge_reranking;

  IF t_knowledge_reranking IS NOT NULL THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_knowledge_reranking, 1,
      'Responde APENAS com a tool call. Seleciona os excertos mais relevantes.',
      true,
      'v1 — migrated from hardcoded optimize-product reranking prompt (2026-03-20)'
    );

    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'knowledge_reranking', 'Reranking de Conhecimento (Global)', t_knowledge_reranking, true);
  END IF;

  -- ── variation_attribute_extraction ───────────────────────────────────────
  -- NOTE: This prompt is currently in English. Block 3 will add a v2 in PT-PT.
  INSERT INTO prompt_templates
    (workspace_id, prompt_name, prompt_type, base_prompt, description, is_active)
  VALUES (
    NULL,
    'variation_attribute_extraction_global',
    'system',
    'You extract variation attributes from product titles. Compare the parent title with each child title to identify the differentiating attribute (e.g. Color, Size, Material, Capacity, Dimensions). Return structured data via the tool. CRITICAL: NEVER use EAN codes, barcodes, numeric references (8+ digit numbers), brand names, or SKU codes as attribute values. Only use meaningful physical attributes like size, color, capacity, material.',
    'Global system prompt for variation attribute extraction. NOTE: EN — will be translated to PT-PT in Block 3 as v2.',
    true
  )
  ON CONFLICT (prompt_name) DO NOTHING
  RETURNING id INTO t_variation_extraction;

  IF t_variation_extraction IS NOT NULL THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_variation_extraction, 1,
      'You extract variation attributes from product titles. Compare the parent title with each child title to identify the differentiating attribute (e.g. Color, Size, Material, Capacity, Dimensions). Return structured data via the tool. CRITICAL: NEVER use EAN codes, barcodes, numeric references (8+ digit numbers), brand names, or SKU codes as attribute values. Only use meaningful physical attributes like size, color, capacity, material.',
      true,
      'v1 — migrated from hardcoded optimize-product variation extraction prompt (EN, 2026-03-20). Block 3 adds v2 in PT-PT.'
    );

    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'variation_attribute_extraction', 'Extração de Atributos de Variação (Global)', t_variation_extraction, true);
  END IF;

  -- ── pdf_text_extraction ──────────────────────────────────────────────────
  INSERT INTO prompt_templates
    (workspace_id, prompt_name, prompt_type, base_prompt, description, is_active)
  VALUES (
    NULL,
    'pdf_text_extraction_global',
    'system',
    'És um extrator de conteúdo de documentos técnicos e catálogos de produtos. Extrai TODO o texto relevante do PDF, incluindo nomes de produtos, especificações técnicas, tabelas de preços, descrições e códigos de referência. Mantém a estrutura organizada. Responde APENAS com o texto extraído.',
    'Global system prompt for PDF text extraction (parse-catalog).',
    true
  )
  ON CONFLICT (prompt_name) DO NOTHING
  RETURNING id INTO t_pdf_text_extraction;

  IF t_pdf_text_extraction IS NOT NULL THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_pdf_text_extraction, 1,
      'És um extrator de conteúdo de documentos técnicos e catálogos de produtos. Extrai TODO o texto relevante do PDF, incluindo nomes de produtos, especificações técnicas, tabelas de preços, descrições e códigos de referência. Mantém a estrutura organizada. Responde APENAS com o texto extraído.',
      true,
      'v1 — migrated from hardcoded parse-catalog extractPdfText system prompt (2026-03-20)'
    );

    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'pdf_text_extraction', 'Extração de Texto de PDF (Global)', t_pdf_text_extraction, true);
  END IF;

  -- ── pdf_product_extraction ───────────────────────────────────────────────
  INSERT INTO prompt_templates
    (workspace_id, prompt_name, prompt_type, base_prompt, description, is_active)
  VALUES (
    NULL,
    'pdf_product_extraction_global',
    'system',
    E'És um especialista em extração de dados de catálogos de produtos industriais e comerciais.\n\nREGRAS DE EXTRAÇÃO:\n1. CABEÇALHOS DE PÁGINA: Identifica o nome da COLEÇÃO/MODELO que aparece no topo ou cabeçalho de cada página (ex: "Mica", "Gema", "Ópera"). Este nome aplica-se a TODOS os produtos listados nessa página.\n2. TÍTULO: Compõe o título como "{Descrição do item} {Coleção/Modelo} {Marca}" (ex: "Cuchara mesa Mica JAY", "Cazo Ópera Lacor").\n3. MARCA: Identifica a marca do catálogo pelo nome do ficheiro, logótipo ou cabeçalho (ex: "JAY", "Lacor").\n4. SKU/REFERÊNCIA: Extrai o código de referência de cada produto (coluna "Ref", "Código", "Art.", etc).\n5. PREÇO: Extrai o preço unitário (coluna "€", "PVP", "Precio", etc). Usa ponto como separador decimal.\n6. ESPECIFICAÇÕES TÉCNICAS: Extrai dimensões como comprimento (L), espessura (e), diâmetro (Ø), capacidade (cl/L), etc. Formata como "L: 202mm | e: 4.0mm".\n7. CATEGORIA: Identifica a categoria geral dos produtos (ex: "Cubiertos INOX 18/10", "Utensilios de cocina").\n8. DESCRIÇÃO CURTA: Se existir texto descritivo sobre o produto ou coleção, extrai-o.\n9. PRODUTOS VARIÁVEIS: Se vários produtos pertencem à mesma coleção/modelo (ex: colher, garfo, faca da coleção "Mica"), marca-os como variações:\n   - O produto "pai" (a coleção) tem product_type="variable" e parent_title vazio\n   - Cada item individual tem product_type="variation" e parent_title="Coleção {Modelo} {Marca}"\n   - Se não pertencem a uma coleção, usa product_type="simple"\n10. IMAGENS: Se encontrares URLs ou referências de imagens, inclui-as.\n11. Extrai TODOS os produtos — não ignores nenhuma linha de tabela.\n\nResponde APENAS com a tool call.',
    'Global system prompt for PDF product extraction (parse-catalog parsePdfWithAI).',
    true
  )
  ON CONFLICT (prompt_name) DO NOTHING
  RETURNING id INTO t_pdf_product_extraction;

  IF t_pdf_product_extraction IS NOT NULL THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_pdf_product_extraction, 1,
      E'És um especialista em extração de dados de catálogos de produtos industriais e comerciais.\n\nREGRAS DE EXTRAÇÃO:\n1. CABEÇALHOS DE PÁGINA: Identifica o nome da COLEÇÃO/MODELO que aparece no topo ou cabeçalho de cada página (ex: "Mica", "Gema", "Ópera"). Este nome aplica-se a TODOS os produtos listados nessa página.\n2. TÍTULO: Compõe o título como "{Descrição do item} {Coleção/Modelo} {Marca}" (ex: "Cuchara mesa Mica JAY", "Cazo Ópera Lacor").\n3. MARCA: Identifica a marca do catálogo pelo nome do ficheiro, logótipo ou cabeçalho (ex: "JAY", "Lacor").\n4. SKU/REFERÊNCIA: Extrai o código de referência de cada produto (coluna "Ref", "Código", "Art.", etc).\n5. PREÇO: Extrai o preço unitário (coluna "€", "PVP", "Precio", etc). Usa ponto como separador decimal.\n6. ESPECIFICAÇÕES TÉCNICAS: Extrai dimensões como comprimento (L), espessura (e), diâmetro (Ø), capacidade (cl/L), etc. Formata como "L: 202mm | e: 4.0mm".\n7. CATEGORIA: Identifica a categoria geral dos produtos (ex: "Cubiertos INOX 18/10", "Utensilios de cocina").\n8. DESCRIÇÃO CURTA: Se existir texto descritivo sobre o produto ou coleção, extrai-o.\n9. PRODUTOS VARIÁVEIS: Se vários produtos pertencem à mesma coleção/modelo (ex: colher, garfo, faca da coleção "Mica"), marca-os como variações:\n   - O produto "pai" (a coleção) tem product_type="variable" e parent_title vazio\n   - Cada item individual tem product_type="variation" e parent_title="Coleção {Modelo} {Marca}"\n   - Se não pertencem a uma coleção, usa product_type="simple"\n10. IMAGENS: Se encontrares URLs ou referências de imagens, inclui-as.\n11. Extrai TODOS os produtos — não ignores nenhuma linha de tabela.\n\nResponde APENAS com a tool call.',
      true,
      'v1 — migrated from hardcoded parse-catalog parsePdfWithAI system prompt (2026-03-20)'
    );

    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'pdf_product_extraction', 'Extração de Produtos de PDF (Global)', t_pdf_product_extraction, true);
  END IF;

END $$;
```

- [ ] **Step 2: Apply the seed migration**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npx supabase db push 2>&1 | tail -20
```

Expected: seed applied without errors.

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: 16/16 pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260320000012_seed_global_prompt_versions.sql
git commit -m "feat: seed global prompt templates + versions for 5 task types; routing rules activate DB governance"
```

---

## Task 3: Update resolvePromptTemplate() to support global rules + return versionId

**Context:** The current `resolvePromptTemplate()` in `resolve-ai-route/index.ts` only queries `ai_routing_rules WHERE workspace_id = workspaceId`. With the schema change, global rules have `workspace_id IS NULL`. We need to: (1) add a second lookup for global rules as fallback, (2) change the return type from `Promise<string>` to `Promise<{ text: string; versionId: string | null }>`, (3) include `promptVersionId` in the HTTP response `meta`.

**Files:**
- Modify: `supabase/functions/resolve-ai-route/index.ts`

- [ ] **Step 1: Rewrite resolvePromptTemplate() and update the handler**

Open `supabase/functions/resolve-ai-route/index.ts`. Replace the entire file content with:

```typescript
// supabase/functions/resolve-ai-route/index.ts
// Thin HTTP wrapper (~80 lines). All AI logic lives in _shared/ai/.
// HTTP contract is identical to the previous implementation (backward compatible).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runPrompt } from "../_shared/ai/prompt-runner.ts";
import { mapTaskTypeToCapability } from "../_shared/ai/capability-matrix.ts";
import { toLegacyResponse } from "./legacy-compat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { taskType, workspaceId, messages, systemPrompt, options, modelOverride } =
      await req.json();
    if (!taskType || !workspaceId) throw new Error("taskType and workspaceId required");

    // Resolve system prompt from prompt_templates/prompt_versions if a routing rule
    // specifies one. Checks workspace-specific rule first, then global (workspace_id IS NULL).
    const { text: resolvedPrompt, versionId: promptVersionId } = await resolvePromptTemplate(
      supabase,
      workspaceId,
      taskType,
      systemPrompt,
    );

    const { result, meta } = await runPrompt(supabase, {
      workspaceId,
      capability: mapTaskTypeToCapability(taskType),
      taskType,
      systemPrompt: resolvedPrompt,
      messages,
      temperature: options?.temperature,
      maxTokens: options?.max_tokens,
      jsonMode: !!options?.response_format,
      modelOverride,
      tools: options?.tools,
      toolChoice: options?.tool_choice,
      promptVersionId: promptVersionId ?? undefined,
    });

    return new Response(
      JSON.stringify({
        result: toLegacyResponse(result),
        meta: {
          usedProvider: meta.provider,
          usedModel: meta.model,
          fallbackUsed: meta.fallbackUsed,
          latencyMs: meta.latencyMs,
          taskType,
          promptVersionId: promptVersionId ?? null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Resolves the system prompt via prompt_templates / prompt_versions.
// Precedence: workspace-specific active version > global active version >
//             base_prompt from template > caller's systemPrompt.
// Returns { text, versionId } — versionId is null when falling back to
// base_prompt or the caller's hardcoded systemPrompt.
async function resolvePromptTemplate(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  taskType: string,
  fallbackPrompt: string,
): Promise<{ text: string; versionId: string | null }> {
  try {
    // 1. Workspace-specific rule
    const { data: wsRule } = await supabase
      .from("ai_routing_rules")
      .select("prompt_template_id, prompt:prompt_template_id(base_prompt)")
      .eq("workspace_id", workspaceId)
      .eq("task_type", taskType)
      .eq("is_active", true)
      .maybeSingle();

    // 2. Global rule (workspace_id IS NULL) — checked only if no workspace rule found
    const { data: globalRule } = wsRule?.prompt_template_id
      ? { data: null }
      : await supabase
          .from("ai_routing_rules")
          .select("prompt_template_id, prompt:prompt_template_id(base_prompt)")
          .is("workspace_id", null)
          .eq("task_type", taskType)
          .eq("is_active", true)
          .maybeSingle();

    const rule = wsRule?.prompt_template_id ? wsRule : globalRule;

    if (rule?.prompt_template_id) {
      const { data: version } = await supabase
        .from("prompt_versions")
        .select("id, prompt_text")
        .eq("template_id", rule.prompt_template_id)
        .eq("is_active", true)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (version?.prompt_text) {
        return { text: version.prompt_text, versionId: version.id as string };
      }

      const basePrompt = (rule.prompt as { base_prompt?: string } | null)?.base_prompt;
      if (basePrompt) return { text: basePrompt, versionId: null };
    }
  } catch {
    /* no rule or template — use caller's prompt */
  }

  return { text: fallbackPrompt || "", versionId: null };
}
```

- [ ] **Step 2: Run tests**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npm run test
```

Expected: 16/16 pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/resolve-ai-route/index.ts
git commit -m "feat: resolvePromptTemplate checks global rules + returns promptVersionId; response meta includes promptVersionId"
```

---

## Task 4: Thread prompt_version_id through RunPromptParams → logUsage → ai_usage_logs

**Context:** `resolvePromptTemplate()` now returns a `versionId`. We pass it into `runPrompt()` via a new `promptVersionId` field in `RunPromptParams`. `prompt-runner.ts` passes it to `logUsage()` via a new `promptVersionId` field in `UsageLogEntry`. `usage-logger.ts` writes it to the `prompt_version_id` column in `ai_usage_logs`.

**Files:**
- Modify: `supabase/functions/_shared/ai/provider-types.ts` (lines 104–118 RunPromptParams, lines 135–149 UsageLogEntry)
- Modify: `supabase/functions/_shared/ai/prompt-runner.ts` (lines 77–91 logUsage call)
- Modify: `supabase/functions/_shared/ai/usage-logger.ts`

- [ ] **Step 1: Add promptVersionId to RunPromptParams in provider-types.ts**

Open `supabase/functions/_shared/ai/provider-types.ts`. Find the `RunPromptParams` interface (around line 104). Add `promptVersionId?: string;` as the last field:

```typescript
// BEFORE (RunPromptParams, lines 104–118):
export interface RunPromptParams {
  workspaceId: string;
  capability: CapabilityType;
  taskType?: string;
  systemPrompt: string;
  userPrompt?: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  modelOverride?: string;
  providerOverride?: string;
  tools?: unknown[];
  toolChoice?: unknown;
}
```

```typescript
// AFTER:
export interface RunPromptParams {
  workspaceId: string;
  capability: CapabilityType;
  taskType?: string;
  systemPrompt: string;
  userPrompt?: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  modelOverride?: string;
  providerOverride?: string;
  tools?: unknown[];
  toolChoice?: unknown;
  promptVersionId?: string;
}
```

Find the `UsageLogEntry` interface (around line 135). Add `promptVersionId?: string;` as the last field:

```typescript
// BEFORE (UsageLogEntry, lines 135–149):
export interface UsageLogEntry {
  workspaceId: string;
  taskType?: string;
  capability: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  fallbackUsed: boolean;
  decisionSource: string;
  latencyMs: number;
  errorCategory?: string;
  isShadow: boolean;
}
```

```typescript
// AFTER:
export interface UsageLogEntry {
  workspaceId: string;
  taskType?: string;
  capability: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  fallbackUsed: boolean;
  decisionSource: string;
  latencyMs: number;
  errorCategory?: string;
  isShadow: boolean;
  promptVersionId?: string;
}
```

- [ ] **Step 2: Pass promptVersionId through prompt-runner.ts**

Open `supabase/functions/_shared/ai/prompt-runner.ts`. Find the `logUsage()` call (lines 77–91). Add `promptVersionId: params.promptVersionId,` as the last field:

```typescript
// BEFORE (lines 77–91):
  logUsage(supabase, {
    workspaceId: params.workspaceId,
    taskType: params.taskType,
    capability: params.capability,
    provider: raw.provider,
    model: raw.model,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd,
    fallbackUsed: raw.fallbackUsed,
    decisionSource: route.decisionSource,
    latencyMs: raw.latencyMs,
    errorCategory: meta.errorCategory,
    isShadow: shadowMode,
  });
```

```typescript
// AFTER:
  logUsage(supabase, {
    workspaceId: params.workspaceId,
    taskType: params.taskType,
    capability: params.capability,
    provider: raw.provider,
    model: raw.model,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd,
    fallbackUsed: raw.fallbackUsed,
    decisionSource: route.decisionSource,
    latencyMs: raw.latencyMs,
    errorCategory: meta.errorCategory,
    isShadow: shadowMode,
    promptVersionId: params.promptVersionId,
  });
```

- [ ] **Step 3: Write prompt_version_id in usage-logger.ts**

Open `supabase/functions/_shared/ai/usage-logger.ts`. Add `prompt_version_id: entry.promptVersionId ?? null,` to the insert:

```typescript
// BEFORE (the insert object, lines 11–25):
    const { error } = await supabase.from("ai_usage_logs").insert({
      workspace_id: entry.workspaceId,
      task_type: entry.taskType ?? null,
      capability: entry.capability,
      provider_id: entry.provider,
      model_name: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      estimated_cost: entry.estimatedCostUsd,
      fallback_used: entry.fallbackUsed,
      decision_source: entry.decisionSource,
      latency_ms: entry.latencyMs,
      error_category: entry.errorCategory ?? null,
      is_shadow: entry.isShadow,
    });
```

```typescript
// AFTER:
    const { error } = await supabase.from("ai_usage_logs").insert({
      workspace_id: entry.workspaceId,
      task_type: entry.taskType ?? null,
      capability: entry.capability,
      provider_id: entry.provider,
      model_name: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      estimated_cost: entry.estimatedCostUsd,
      fallback_used: entry.fallbackUsed,
      decision_source: entry.decisionSource,
      latency_ms: entry.latencyMs,
      error_category: entry.errorCategory ?? null,
      is_shadow: entry.isShadow,
      prompt_version_id: entry.promptVersionId ?? null,
    });
```

- [ ] **Step 4: Run tests**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npm run test
```

Expected: 16/16 pass. TypeScript type errors would show up here if the interface changes are incorrect.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/provider-types.ts \
        supabase/functions/_shared/ai/prompt-runner.ts \
        supabase/functions/_shared/ai/usage-logger.ts
git commit -m "feat: thread promptVersionId through RunPromptParams → logUsage → ai_usage_logs"
```

---

## Task 5: Log prompt_version_id in optimize-product optimization_logs

**Context:** `optimize-product` calls `resolve-ai-route` via HTTP fetch and reads back `aiWrapper.result` for the AI response and `aiWrapper.meta` for routing metadata. Task 3 added `promptVersionId` to `aiWrapper.meta`. Now we need to: (a) read it from the response, (b) pass it to the `optimization_logs` insert. The insert already uses `as any` cast so the new column works without type changes.

**Files:**
- Modify: `supabase/functions/optimize-product/index.ts` (around lines 1233–1247 and 1677–1694)

- [ ] **Step 1: Capture promptVersionId from response meta**

Open `supabase/functions/optimize-product/index.ts`. Find the block that reads the AI response (around line 1233):

```typescript
// BEFORE (lines 1233–1247):
        const aiWrapper = await aiResponse.json();
        const aiData = aiWrapper.result || aiWrapper;
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) {
          await supabase.from("products").update({ status: "error" }).eq("id", product.id);
          return { id: product.id, status: "error" as const, error: "No tool call in response" };
        }

        // Capture token usage from AI response
        const usage = aiData.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = usage.total_tokens || (promptTokens + completionTokens);
```

```typescript
// AFTER (add promptVersionId capture):
        const aiWrapper = await aiResponse.json();
        const aiData = aiWrapper.result || aiWrapper;
        const promptVersionId: string | null = aiWrapper.meta?.promptVersionId ?? null;
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) {
          await supabase.from("products").update({ status: "error" }).eq("id", product.id);
          return { id: product.id, status: "error" as const, error: "No tool call in response" };
        }

        // Capture token usage from AI response
        const usage = aiData.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = usage.total_tokens || (promptTokens + completionTokens);
```

- [ ] **Step 2: Include promptVersionId in optimization_logs insert**

Find the `optimization_logs` insert (around line 1677). Add `prompt_version_id: promptVersionId,` to the insert object:

```typescript
// BEFORE (lines 1677–1694):
        await supabase.from("optimization_logs").insert({
          product_id: product.id,
          user_id: userId,
          model: chosenModel,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          knowledge_sources: knowledgeSources,
          supplier_name: matchedForLog?.name || matchedForLog?.prefix || null,
          supplier_url: logSupplierUrl,
          had_knowledge: !!knowledgeContext,
          had_supplier: !!supplierContext,
          had_catalog: !!catalogContext,
          fields_optimized: fields,
          prompt_length: finalPrompt.length,
          chunks_used: topChunks.length,
          rag_match_types: ragMatchTypeCounts,
        } as any);
```

```typescript
// AFTER:
        await supabase.from("optimization_logs").insert({
          product_id: product.id,
          user_id: userId,
          model: chosenModel,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          knowledge_sources: knowledgeSources,
          supplier_name: matchedForLog?.name || matchedForLog?.prefix || null,
          supplier_url: logSupplierUrl,
          had_knowledge: !!knowledgeContext,
          had_supplier: !!supplierContext,
          had_catalog: !!catalogContext,
          fields_optimized: fields,
          prompt_length: finalPrompt.length,
          chunks_used: topChunks.length,
          rag_match_types: ragMatchTypeCounts,
          prompt_version_id: promptVersionId,
        } as any);
```

- [ ] **Step 3: Run tests**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npm run test
```

Expected: 16/16 pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/optimize-product/index.ts
git commit -m "feat: log prompt_version_id in optimization_logs; fix chunks_used + rag_match_types now persisted via proper columns"
```

---

## Validation checklist

After all 5 tasks:

- [ ] `prompt_templates.workspace_id` is nullable — verify: `SELECT workspace_id FROM prompt_templates WHERE workspace_id IS NULL LIMIT 1;`
- [ ] `ai_routing_rules.workspace_id` is nullable — verify: `SELECT task_type FROM ai_routing_rules WHERE workspace_id IS NULL;` — should return 5 rows
- [ ] `optimization_logs` has `prompt_version_id`, `chunks_used`, `rag_match_types` columns
- [ ] `ai_usage_logs` has `prompt_version_id` column
- [ ] 6 `prompt_templates` rows with `workspace_id IS NULL` and `is_active = true`
- [ ] 6 `prompt_versions` rows with `version_number = 1` and `is_active = true`
- [ ] 5 `ai_routing_rules` rows with `workspace_id IS NULL` (product_optimization excluded)
- [ ] `resolve-ai-route` HTTP response includes `meta.promptVersionId`
- [ ] `ai_usage_logs` rows after AI calls include `prompt_version_id` (not null when global rule matched)
- [ ] `optimization_logs` rows after optimize-product runs include `prompt_version_id`

---

## Summary report

**Files changed:** 7
- `supabase/migrations/20260320000011_prompt_governance_schema.sql` (new)
- `supabase/migrations/20260320000012_seed_global_prompt_versions.sql` (new)
- `supabase/functions/resolve-ai-route/index.ts`
- `supabase/functions/_shared/ai/provider-types.ts`
- `supabase/functions/_shared/ai/prompt-runner.ts`
- `supabase/functions/_shared/ai/usage-logger.ts`
- `supabase/functions/optimize-product/index.ts`

**Remaining for later blocks:**
- Routing rule for `product_optimization` (Block 5, after run-ai-comparison gets its own task_type)
- `variation_attribute_extraction` v2 PT-PT translation (Block 3)
- DB-driven prompt governance for `extract-pdf-pages` + `analyze-product-page` (Block 5 — these bypass resolve-ai-route)
- Per-field user prompt governance (requires different table design, not in scope)
