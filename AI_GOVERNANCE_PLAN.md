# AI Governance Plan

## Objetivo
Organizar o sistema de IA para que:
- o modelo escolhido seja respeitado
- o provider usado seja claro
- o fallback seja visível
- prompts, templates e execução não se confundam
- o sistema deixe de ter decisões silenciosas

---

## 1. Fonte de verdade por área

### 1.1 Provider Center
Responsável por:
- providers ativos
- API keys
- modelos disponíveis
- custo
- capacidades
- health
- retry/fallback base

Não é responsável por:
- prompts
- template HTML
- FAQ
- SEO do conteúdo

---

### 1.2 Prompt Governance
Responsável por:
- prompts de sistema
- versões de prompts
- regras de escrita
- regras de idioma
- regras de comportamento da IA

Não é responsável por:
- providers
- modelos
- templates HTML
- API keys

---

### 1.3 Optimization Settings
Responsável por:
- description_template
- placeholders
- FAQ dentro da descrição
- estrutura HTML
- regras de composição final
- settings de otimização por utilizador

Não é responsável por:
- fallback
- escolha de provider
- gestão de credenciais

---

### 1.4 Runtime
Responsável por:
- executar o modelo pedido
- fazer retry
- fazer fallback se necessário
- guardar logs da execução real

Não deve:
- remapear silenciosamente
- trocar modelo sem registar
- substituir template sem rastreabilidade

---

## 2. Regras obrigatórias

### 2.1 Regra do modelo
Se o utilizador escolher um modelo:
- o sistema deve tentar usar esse modelo
- se não puder, deve avisar ou registar fallback
- nunca pode trocar silenciosamente

### 2.2 Regra do log
Cada execução deve guardar:
- requested_model_raw
- requested_model_resolved
- used_model
- used_provider
- fallback_used
- fallback_reason
- decision_source

### 2.3 Regra do template
Se existir description_template com FAQ, o runtime deve respeitá-lo.
Se a FAQ vier em fase posterior, a descrição final deve ser rehidratada/recomposta.

---

## 3. Estrutura do sistema

### Core
- optimize-batch
- optimize-product
- resolve-ai-route
- provider-registry
- prompt-runner
- fallback-policy
- invoke-provider

### Auxiliares
- parse-catalog
- enrich-products
- process-product-images
- translate-product
- scraping/PDF/document intelligence

### Administração
- test-ai-provider
- run-ai-comparison
- health/monitorização

### Legado / Arquivo
- optimize-product-seo
- generate-product-description
- extract-product-attributes
- classify-product
- detect-product-variations
- learn-supplier-patterns
- route-ai-executor
- create-execution-plan
- evaluate-execution-plan

---

## 4. Ordem de estabilização

1. Proteger o estado atual com backup
2. Confirmar o core
3. Confirmar o legado
4. Alinhar Provider Center com runtime
5. Alinhar UI de modelos com catálogo real
6. Corrigir logs para refletirem a verdade
7. Validar prompts e templates
8. Arquivar functions antigas
9. Só depois implementar melhorias novas
