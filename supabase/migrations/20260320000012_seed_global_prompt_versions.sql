-- Block 2: Seed global prompt templates + versions + routing rules.
-- These are the system prompts currently hardcoded in edge functions.
-- Seeding them into DB enables editing without code deploy.
-- The edge function hardcoded values remain as fallback if DB lookup fails.
--
-- IDEMPOTENCY: Each block first SELECTs the existing row by (workspace_id IS NULL,
-- prompt_name). If found, the id is captured and all dependent inserts are skipped
-- (they already exist from a prior run). If not found, INSERT and RETURNING id
-- captures the new id. prompt_versions and ai_routing_rules each have their own
-- EXISTS guards so they are never duplicated on re-run either.
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

  SELECT id INTO t_product_optimization
  FROM prompt_templates
  WHERE workspace_id IS NULL AND prompt_name = 'product_optimization_global';

  IF t_product_optimization IS NULL THEN
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
    RETURNING id INTO t_product_optimization;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE template_id = t_product_optimization AND version_number = 1
  ) THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_product_optimization, 1,
      'És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional. Mantém sempre as características técnicas do produto NUMA TABELA HTML separada do texto comercial. Traduz tudo para português europeu.',
      true,
      'v1 — migrated from hardcoded optimize-product system prompt (2026-03-20)'
    );
  END IF;
  -- No routing rule for product_optimization yet (see note above)


  -- ── product_enrichment ───────────────────────────────────────────────────

  SELECT id INTO t_product_enrichment
  FROM prompt_templates
  WHERE workspace_id IS NULL AND prompt_name = 'product_enrichment_global';

  IF t_product_enrichment IS NULL THEN
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
    RETURNING id INTO t_product_enrichment;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE template_id = t_product_enrichment AND version_number = 1
  ) THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_product_enrichment, 1,
      E'És um especialista em extração de dados de produtos. Analisas páginas web de fornecedores/fabricantes e extraís dados estruturados.\n\nREGRAS PARA IMAGENS:\n- Extrai APENAS imagens que pertencem a ESTE produto específico visualizado na página\n- Foca em: foto principal do produto, imagens de galeria/carrossel, ângulos alternativos, vistas de detalhe, zoom\n- Estas encontram-se tipicamente dentro de um contentor de galeria de imagens, lightbox ou carrossel — geralmente o primeiro conjunto de imagens na página\n- EXCLUI ESTRITAMENTE: ícones de navegação, miniaturas de categoria, logótipos de rodapé, banners de newsletter, ícones de redes sociais, imagens de popup de cookies, imagens de "produtos relacionados", imagens de "também pode gostar", logótipos de marca, ícones de métodos de pagamento, ícones de envio, selos de confiança, ícones SVG, qualquer imagem com menos de 100px\n- NÃO incluas imagens de "produtos relacionados", "produtos recomendados", "produtos da mesma série", ou qualquer secção que mostre OUTROS produtos\n- Um produto típico tem 1-8 imagens. Se encontrares mais de 10, provavelmente estás a incluir imagens não relacionadas com o produto — sê mais seletivo\n- Em caso de dúvida, EXCLUI a imagem\n\nREGRAS PARA VARIAÇÕES:\n- Deteta variações APENAS se a página mostrar claramente um seletor (seletor de tamanho, de cor, dropdown) para ESTE produto\n- CRÍTICO: Reporta apenas variações que tenham SKUs REAIS visíveis na página (em URLs, atributos onclick, atributos data, ou valores de opção)\n- NUNCA inventes ou adivinhes SKUs — se não encontrares um código SKU real para uma variação, NÃO a incluas no array "skus"\n- Se vires valores de variação (ex: tamanhos) mas NENHUM SKU associado, devolve os valores SEM o array skus\n- O array "skus" DEVE conter apenas códigos alfanuméricos curtos (ex: "80020", "UD12345"), NUNCA URLs completos\n- Se o link de uma variação for "https://fornecedor.com/nome-produto/80020", o SKU é "80020"\n\nREGRAS PARA ESPECIFICAÇÕES:\n- Extrai especificações técnicas como pares chave-valor estruturados\n- Identifica o nome da série/família do produto se visível',
      true,
      'v1 — migrated from hardcoded enrich-products system prompt after Block 1 PT-PT translation (2026-03-20)'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ai_routing_rules
    WHERE workspace_id IS NULL AND task_type = 'product_enrichment'
  ) THEN
    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'product_enrichment', 'Enriquecimento de Produto (Global)', t_product_enrichment, true);
  END IF;


  -- ── knowledge_reranking ──────────────────────────────────────────────────

  SELECT id INTO t_knowledge_reranking
  FROM prompt_templates
  WHERE workspace_id IS NULL AND prompt_name = 'knowledge_reranking_global';

  IF t_knowledge_reranking IS NULL THEN
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
    RETURNING id INTO t_knowledge_reranking;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE template_id = t_knowledge_reranking AND version_number = 1
  ) THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_knowledge_reranking, 1,
      'Responde APENAS com a tool call. Seleciona os excertos mais relevantes.',
      true,
      'v1 — migrated from hardcoded optimize-product reranking prompt (2026-03-20)'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ai_routing_rules
    WHERE workspace_id IS NULL AND task_type = 'knowledge_reranking'
  ) THEN
    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'knowledge_reranking', 'Reranking de Conhecimento (Global)', t_knowledge_reranking, true);
  END IF;


  -- ── variation_attribute_extraction ───────────────────────────────────────
  -- NOTE: This prompt is currently in English. Block 3 will add a v2 in PT-PT.

  SELECT id INTO t_variation_extraction
  FROM prompt_templates
  WHERE workspace_id IS NULL AND prompt_name = 'variation_attribute_extraction_global';

  IF t_variation_extraction IS NULL THEN
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
    RETURNING id INTO t_variation_extraction;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE template_id = t_variation_extraction AND version_number = 1
  ) THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_variation_extraction, 1,
      'You extract variation attributes from product titles. Compare the parent title with each child title to identify the differentiating attribute (e.g. Color, Size, Material, Capacity, Dimensions). Return structured data via the tool. CRITICAL: NEVER use EAN codes, barcodes, numeric references (8+ digit numbers), brand names, or SKU codes as attribute values. Only use meaningful physical attributes like size, color, capacity, material.',
      true,
      'v1 — migrated from hardcoded optimize-product variation extraction prompt (EN, 2026-03-20). Block 3 adds v2 in PT-PT.'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ai_routing_rules
    WHERE workspace_id IS NULL AND task_type = 'variation_attribute_extraction'
  ) THEN
    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'variation_attribute_extraction', 'Extração de Atributos de Variação (Global)', t_variation_extraction, true);
  END IF;


  -- ── pdf_text_extraction ──────────────────────────────────────────────────

  SELECT id INTO t_pdf_text_extraction
  FROM prompt_templates
  WHERE workspace_id IS NULL AND prompt_name = 'pdf_text_extraction_global';

  IF t_pdf_text_extraction IS NULL THEN
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
    RETURNING id INTO t_pdf_text_extraction;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE template_id = t_pdf_text_extraction AND version_number = 1
  ) THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_pdf_text_extraction, 1,
      'És um extrator de conteúdo de documentos técnicos e catálogos de produtos. Extrai TODO o texto relevante do PDF, incluindo nomes de produtos, especificações técnicas, tabelas de preços, descrições e códigos de referência. Mantém a estrutura organizada. Responde APENAS com o texto extraído.',
      true,
      'v1 — migrated from hardcoded parse-catalog extractPdfText system prompt (2026-03-20)'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ai_routing_rules
    WHERE workspace_id IS NULL AND task_type = 'pdf_text_extraction'
  ) THEN
    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'pdf_text_extraction', 'Extração de Texto de PDF (Global)', t_pdf_text_extraction, true);
  END IF;


  -- ── pdf_product_extraction ───────────────────────────────────────────────

  SELECT id INTO t_pdf_product_extraction
  FROM prompt_templates
  WHERE workspace_id IS NULL AND prompt_name = 'pdf_product_extraction_global';

  IF t_pdf_product_extraction IS NULL THEN
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
    RETURNING id INTO t_pdf_product_extraction;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE template_id = t_pdf_product_extraction AND version_number = 1
  ) THEN
    INSERT INTO prompt_versions
      (template_id, version_number, prompt_text, is_active, version_notes)
    VALUES (
      t_pdf_product_extraction, 1,
      E'És um especialista em extração de dados de catálogos de produtos industriais e comerciais.\n\nREGRAS DE EXTRAÇÃO:\n1. CABEÇALHOS DE PÁGINA: Identifica o nome da COLEÇÃO/MODELO que aparece no topo ou cabeçalho de cada página (ex: "Mica", "Gema", "Ópera"). Este nome aplica-se a TODOS os produtos listados nessa página.\n2. TÍTULO: Compõe o título como "{Descrição do item} {Coleção/Modelo} {Marca}" (ex: "Cuchara mesa Mica JAY", "Cazo Ópera Lacor").\n3. MARCA: Identifica a marca do catálogo pelo nome do ficheiro, logótipo ou cabeçalho (ex: "JAY", "Lacor").\n4. SKU/REFERÊNCIA: Extrai o código de referência de cada produto (coluna "Ref", "Código", "Art.", etc).\n5. PREÇO: Extrai o preço unitário (coluna "€", "PVP", "Precio", etc). Usa ponto como separador decimal.\n6. ESPECIFICAÇÕES TÉCNICAS: Extrai dimensões como comprimento (L), espessura (e), diâmetro (Ø), capacidade (cl/L), etc. Formata como "L: 202mm | e: 4.0mm".\n7. CATEGORIA: Identifica a categoria geral dos produtos (ex: "Cubiertos INOX 18/10", "Utensilios de cocina").\n8. DESCRIÇÃO CURTA: Se existir texto descritivo sobre o produto ou coleção, extrai-o.\n9. PRODUTOS VARIÁVEIS: Se vários produtos pertencem à mesma coleção/modelo (ex: colher, garfo, faca da coleção "Mica"), marca-os como variações:\n   - O produto "pai" (a coleção) tem product_type="variable" e parent_title vazio\n   - Cada item individual tem product_type="variation" e parent_title="Coleção {Modelo} {Marca}"\n   - Se não pertencem a uma coleção, usa product_type="simple"\n10. IMAGENS: Se encontrares URLs ou referências de imagens, inclui-as.\n11. Extrai TODOS os produtos — não ignores nenhuma linha de tabela.\n\nResponde APENAS com a tool call.',
      true,
      'v1 — migrated from hardcoded parse-catalog parsePdfWithAI system prompt (2026-03-20)'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ai_routing_rules
    WHERE workspace_id IS NULL AND task_type = 'pdf_product_extraction'
  ) THEN
    INSERT INTO ai_routing_rules
      (workspace_id, task_type, display_name, prompt_template_id, is_active)
    VALUES (NULL, 'pdf_product_extraction', 'Extração de Produtos de PDF (Global)', t_pdf_product_extraction, true);
  END IF;

END $$;
