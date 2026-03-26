# CLAUDE.md

This file defines how Claude MUST work in this repository.

---

# 🚨 MANDATORY WORKFLOW (Superpowers)

Claude must ALWAYS follow this process:

## 1. Before coding

* Inspect current codebase
* Identify relevant files
* Understand existing logic (no assumptions)
* Use brainstorming or write a plan

## 2. Planning (REQUIRED)

* Explain what will change
* List files to modify
* Describe system impact
* Identify risks

## 3. Execution

* Use controlled, minimal changes
* DO NOT rewrite entire files unless necessary
* Respect existing architecture and patterns

## 4. Validation (REQUIRED)

* Validate logic
* Check edge cases
* Ensure no regressions
* Confirm compatibility with existing flows

---

# ❌ STRICT RULES

* Do NOT modify files outside scope
* Do NOT simplify logic without analysis
* Do NOT assume behavior without checking code
* Do NOT introduce breaking changes silently
* Do NOT refactor unrelated code

---

# 🧠 PROJECT CONTEXT

**Hotelequip Product Optimizer** — AI-powered WooCommerce product management platform.

Core capabilities:

* Product ingestion (WooCommerce, PDF, scraping)
* AI enrichment and optimization
* Multi-channel publishing
* Workflow automation

---

# 🏗 ARCHITECTURE

Stack:

* React 18 + TypeScript + Vite
* Supabase (PostgreSQL + Auth)
* React Query
* React Router v6
* Tailwind + shadcn/ui

Structure:

* `src/pages/` — feature pages
* `src/components/` — UI components
* `src/components/ui/` — shadcn primitives
* `src/hooks/` — business logic (React Query)
* `src/lib/` — pure utilities
* `src/integrations/supabase/` — DB types + client

---

# 🔑 KEY SYSTEMS

* document-intelligence → PDF extraction
* playbook-engine → ingestion workflows
* scraper → website extraction
* supplier → supplier intelligence
* prompt-governance → AI prompts + cost tracking

---

# ⚙️ MULTI-TENANCY

* All data is workspace-scoped
* Always consider active workspace context
* Never query or mutate data without workspace awareness

---

# 🔌 ENVIRONMENT

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

---

# 🧩 DOMAIN RULES (IMPORTANT)

## WooCommerce integration

* Always preserve `woocommerce_id`
* Use SKU only as fallback
* Never break deduplication logic

## Product ingestion

* Must preserve:

  * attributes
  * categories (hierarchical)
  * SEO data
  * meta_data

## Data integrity

* Never overwrite existing valid data blindly
* Always use safe merge strategies

---

# 🔄 GIT + LOVABLE WORKFLOW (CRITICAL)

## If changes come from Lovable:

```bash
git checkout main
git pull origin main
```

## If changes are made locally (Claude):

```bash
git status
git diff --stat
git add .
git commit -m "..."
git pull --rebase origin main
git push origin main
```

* Always rebase before push
* Never force push to main
* Avoid merge commits

---

# 🧪 TESTING

```bash
npm run test
npm run test:watch
```

Single test:

```bash
npx vitest run src/path/to/file.test.ts
```

---

# 🎯 DEVELOPMENT STYLE

* Small, iterative changes
* Clear reasoning
* Explicit decisions
* Production-ready mindset

---

# 🧠 FINAL RULE

Claude is acting as a **senior engineer**, not a code generator.

Every change must be:

* intentional
* scoped
* validated
