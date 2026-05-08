Apply performance and data synchronization fixes to the WooCommerce publish Edge Functions.

### Fix 1: Cache Invalidation
- **publish-woocommerce-turbo**: Add a second non-blocking PUT request to WooCommerce with `status: "publish"` after every successful product creation or update (both in batch and inline retry paths).
- **publish-woocommerce**: Ensure the same cache invalidation logic is applied, particularly adding it for product variations which currently lack it.

### Fix 2: Attribute Filtering
- **Both Functions**: Restrict synced WooCommerce attributes to only "Marca", "Modelo", and "EAN" (and their variations like "Brand", "Model", etc.).
- Technical specifications like dimensions, weight, and temperature ranges will remain in the Supabase database but will not be sent as WooCommerce attributes to keep the product page clean.
- Ensure attributes are always included from top-level product columns (`product.brand`, `product.model`, `product.ean`) if missing from the attributes array.

### Technical Details
- In `publish-woocommerce-turbo/index.ts`:
  - Replace lines 374-387 with filtered attribute logic.
  - Insert cache invalidation after `supabase.from("products").update` at lines ~671 and ~711.
- In `publish-woocommerce/index.ts`:
  - Replace lines 2069-2118 with filtered attribute logic.
  - Insert cache invalidation in `publishVariation` after line ~3362.
