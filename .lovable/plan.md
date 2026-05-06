Implement performance optimizations and data consistency fixes across three Supabase Edge Functions.

### User Review Required
> [!IMPORTANT]
> This plan implements 5 specific fixes to improve scalability and prevent product duplication during ingestion. No UI or database schema changes will be made.

### Technical Details

#### 1. Pagination of Product Queries
Update `run-ingestion-job` and `reconcile-history-jobs` to fetch products in batches of 1000 instead of a single query. This prevents failures when a workspace has more than 1000 products (Supabase default limit).

#### 2. Optimized Job Configuration Loading
In `batch-process-staging`, replace multiple per-item database queries for job configurations with a single bulk fetch before the processing loop starts.

#### 3. Unified SKU Normalization
Standardize `normalizeSKU` across all three functions to handle slashes/backslashes as hyphens and preserve leading zeros (essential for many supplier formats).

#### 4. Duplicate Prevention (Race Condition Fix)
Add a "check-before-insert" pattern in `run-ingestion-job` using `.maybeSingle()`. If another process inserts the same SKU between the initial check and the insertion, the system will now update the existing product instead of creating a duplicate.

### Implementation Steps

1.  **Update `supabase/functions/run-ingestion-job/index.ts`**
    *   Replace `normalizeSKU` with the new version.
    *   Implement paginated product fetching.
    *   Add the pre-insert check to prevent duplicates.

2.  **Update `supabase/functions/reconcile-history-jobs/index.ts`**
    *   Replace `normalizeSKU` with the new version.
    *   Implement paginated product fetching.

3.  **Update `supabase/functions/batch-process-staging/index.ts`**
    *   Replace `normalizeSKU` with the new version.
    *   Fetch all relevant `ingestion_jobs` once before the loop.
    *   Use the cached configurations inside the loop.
