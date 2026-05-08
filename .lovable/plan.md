The error "WooCommerce 400: woocommerce_product_image_upload_error" occurs because WordPress/WooCommerce is unable to fetch remote images directly from certain supplier domains (like `eutron.es`), likely due to SSL verification issues on the hosting server or anti-bot protections on the supplier's side.

I will implement a more robust image handling strategy in both the classic and turbo publish functions:
1. **Classic Publish (`publish-woocommerce`):** Extend image resolution to attempt uploading *all* external images to the WordPress Media Library, not just those from Supabase. This bypasses the need for WooCommerce to fetch remote URLs.
2. **Turbo Publish (`publish-woocommerce-turbo`):** Enhance the pre-upload logic with a common browser User-Agent to ensure supplier sites don't block the image download.
3. **Common Fetch Improvement:** Add a browser User-Agent to all image fetch requests in Edge Functions to improve success rates when downloading from supplier catalogs.

### Technical Details

#### `supabase/functions/publish-woocommerce/index.ts`
- Update `uploadImageToWPMedia` to include a `User-Agent` header in the `fetch` call.
- Update `resolveImageRef` to check if a URL is external (not starting with `baseUrl`) and attempt a Media Library upload if so.
- Update log messages to accurately reflect that any external image is being uploaded, not just Supabase ones.

#### `supabase/functions/publish-woocommerce-turbo/index.ts`
- Update `preuploadMedia` to include a `User-Agent` header in its `fetch` call.

This change ensures that WooCommerce receives a local Media ID instead of a remote URL, which is significantly more reliable for synchronization.

### Verification Plan
1. Check build logs for any syntax errors in Edge Functions.
2. (Manual) The user can retry publishing the product "Estante Dupla em Inox" and verify the image error is resolved.
