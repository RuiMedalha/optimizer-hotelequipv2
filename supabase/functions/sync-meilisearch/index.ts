const MEILISEARCH_URL = "https://search.palamenta.com.pt";
const MEILISEARCH_ADMIN_KEY = "782e05539beac4bd4dacc44393ded86fa43c7b409ad43a109479c3274b434efd";
const INDEX = "products_hotelequip";

const WC_URL = Deno.env.get("WC_SYNC_URL") || "https://hotelequipnew.mainart.com.br";
const WC_KEY = Deno.env.get("WC_CONSUMER_KEY")!;
const WC_SECRET = Deno.env.get("WC_CONSUMER_SECRET")!;

Deno.serve(async (req) => {
  const { fullSync, modifiedAfter } = await req.json().catch(() => ({}));
  const wcAuth = btoa(`${WC_KEY}:${WC_SECRET}`);
  const wcBase = WC_URL.replace(/\/$/, "");

  let page = 1;
  let allProducts: any[] = [];

  while (true) {
    let url = `${wcBase}/wp-json/wc/v3/products?status=publish&per_page=100&page=${page}&_fields=id,sku,name,short_description,categories,attributes,date_modified`;
    if (modifiedAfter && !fullSync) url += `&modified_after=${modifiedAfter}`;

    const resp = await fetch(url, { headers: { "Authorization": `Basic ${wcAuth}` } });
    if (!resp.ok) break;

    const products = await resp.json();
    if (!products.length) break;

    allProducts = allProducts.concat(products);

    const totalPages = parseInt(resp.headers.get("X-WP-TotalPages") || "1");
    if (page >= totalPages) break;
    page++;
  }

  if (!allProducts.length) {
    return new Response(JSON.stringify({ synced: 0, message: "Nenhum produto encontrado" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  const docs = allProducts.map(p => ({
    woocommerce_id: p.id,
    sku: p.sku || "",
    name: p.name || "",
    short_description: (p.short_description || "").replace(/<[^>]*>/g, " ").trim(),
    category: p.categories?.map((c: any) => c.name).join(" > ") || "",
    categories: p.categories?.map((c: any) => ({ id: c.id, name: c.name, slug: c.slug })) || [],
    brand: p.attributes?.find((a: any) =>
      a.name.toLowerCase().includes("marca") ||
      a.name.toLowerCase().includes("brand")
    )?.options?.[0] || "",
    date_modified: p.date_modified || "",
  }));

  let synced = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = docs.slice(i, i + 500);
    const r = await fetch(`${MEILISEARCH_URL}/indexes/${INDEX}/documents`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MEILISEARCH_ADMIN_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });
    if (r.ok) synced += batch.length;
  }

  return new Response(JSON.stringify({
    synced,
    total: allProducts.length,
    index: INDEX,
    message: `${synced} produtos indexados no Meilisearch`
  }), { headers: { "Content-Type": "application/json" } });
});