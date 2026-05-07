I will resolve the issue where nested attribute objects (e.g., `{ value: "850", unit: "mm" }`) are being implicitly stringified to `[object Object]` in previews and saved products.

### 1. Code-level Normalization Utility
I'll add a robust formatting utility in `src/lib/supplierConnector.ts` to handle both the internal JSON representation and the human-readable display string.

### 2. Edge Function Updates
I'll update the ingestion and reconciliation edge functions to use this formatter when generating previews or display strings, while ensuring the underlying data remains structured JSON.

### 3. UI Component Fixes
I'll update the `ReconciliationTab.tsx` and any relevant preview components to use a safe display formatter for attributes and other potentially nested objects.

### Technical Details

**`src/lib/supplierConnector.ts`**
- Add `formatAttributeValue(val: any): string` to convert `{value, unit}` objects or primitives into human-readable strings.
- Ensure `applyToRow` doesn't accidentally stringify the `attributes` object itself, only its primitive fields if necessary.

**`supabase/functions/run-ingestion-job/index.ts`**
- In `buildProductData`, ensure `attributes` are merged correctly as objects.
- Fix the logic that stringifies "string fields" to ensure it doesn't touch the `attributes` object.

**`supabase/functions/reconcile-history-jobs/index.ts`**
- Update the `proposed_changes` and `site_data` preparation logic to ensure attribute values are either properly structured JSON or formatted for display in `proposed_changes` if intended for UI consumption.

**`src/components/supplier/ReconciliationTab.tsx`**
- Update the rendering loop (around line 696) to use a safe formatter instead of `String(newVal || '—')`.

### User-facing explanation
This fix will ensure that product specifications like "Height: 850 mm" appear correctly in your dashboard instead of the generic "[object Object]". It preserves the technical data structure behind the scenes while showing you readable text during the review process.
