const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/pages/ProductsPage.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const anchor = `                #{product.woocommerce_id}
              </span>
            </div>
          )}`;

const replacement = `${anchor}
          {product.published_to_url && (
            <Badge 
              variant="outline" 
              className={cn(
                "text-[10px] gap-0.5",
                product.published_to_url.includes("hotelequip.pt") ? "bg-green-500/10 text-green-600 border-green-500/20" :
                (product.published_to_url.includes("staging") || product.published_to_url.includes("mainart")) ? "bg-orange-500/10 text-orange-600 border-orange-500/20" :
                "bg-gray-500/10 text-gray-600 border-gray-500/20"
              )}
              title={\`Publicado em: \${product.published_to_url}\`}
            >
              <Globe className="w-2.5 h-2.5" />
              {product.published_to_url.replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '')}
            </Badge>
          )}`;

if (content.includes(anchor)) {
    content = content.replace(anchor, replacement);
    fs.writeFileSync(filePath, content);
    console.log('Successfully updated ProductsPage.tsx');
} else {
    console.error('Could not find anchor in ProductsPage.tsx');
    process.exit(1);
}
