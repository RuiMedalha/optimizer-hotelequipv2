# Plano de Otimização de Palavras-Chave e Contexto de Negócio

Este plano visa resolver a insatisfação com os títulos gerados (ex: "Campânula de Exaustã") e garantir que o sistema utiliza a terminologia mais profissional e relevante para o setor HORECA em Portugal, baseando-se em tendências reais de pesquisa.

## 1. Pesquisa e Análise de Mercado (Google Keywords)
- Realizar uma análise de mercado utilizando ferramentas de pesquisa web para identificar os termos com maior volume de procura em Portugal (PT-PT) para as categorias principais.
- Exemplo: Determinar se "Hotte Industrial", "Exaustor de Cozinha Profissional" ou "Campânula de Exaustão" é o termo preferencial dos compradores.

## 2. Dicionário de Terminologia de Negócio (Base de Dados)
- Ativar e popular a tabela `technical_symbol_dictionary` ou criar uma estrutura dedicada para "Termos Preferenciais" vs "Termos a Evitar".
- Centralizar o mapeamento de sinónimos (exaustor, hotte, coifa, campânula) na base de dados em vez de estarem "hardcoded" nos prompts, permitindo uma gestão mais ágil.

## 3. Refinação dos Motores de IA (Edge Functions)
- **Título**: Ajustar o prompt de geração de títulos para garantir que não ocorram truncagens e que a estrutura siga as melhores práticas de SEO (Tipo + Característica + Dimensão).
- **Contexto**: Injetar automaticamente os "Termos Preferenciais" do dicionário no contexto de cada otimização.
- **Validação**: Adicionar uma etapa de "Revisão de Qualidade" onde a IA verifica se o título gerado utiliza as palavras-chave de alto valor identificadas.

## 4. Melhoria da Tradução e Adaptação
- Reforçar as regras para eliminar definitivamente termos residuais em Espanhol (como "Campana") ou traduções literais que não se aplicam ao mercado português.

## Detalhes Técnicos
- **Ficheiros afetados**: 
  - `supabase/functions/optimize-product/index.ts`
  - `supabase/functions/generate-product-description/index.ts`
- **Base de Dados**: Criação de uma migration para popular termos técnicos e sinónimos validados.
- **Ferramentas**: Utilização de `web_search` para simular análise de tendências do Google.
