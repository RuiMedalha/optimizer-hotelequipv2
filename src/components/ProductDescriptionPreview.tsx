import { useState } from "react";
import DOMPurify from "dompurify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Monitor, Smartphone, ShoppingCart, X } from "lucide-react";

interface Props {
  shortDescription?: string;
  longDescription?: string;
  title?: string;
  price?: string | number;
  category?: string;
  imageUrl?: string;
  seoKeywords?: string[];
  specs?: Record<string, string> | string;
  open: boolean;
  onClose: () => void;
}

export function ProductDescriptionPreview({
  shortDescription,
  longDescription,
  title = "Nome do Produto",
  price,
  category,
  imageUrl,
  seoKeywords,
  specs,
  open,
  onClose,
}: Props) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card className={`bg-background shadow-2xl overflow-hidden flex flex-col ${device === "desktop" ? "w-full max-w-4xl max-h-[90vh]" : "w-[420px] max-h-[90vh]"}`}>
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Preview — Como ficaria publicado</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={device === "desktop" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setDevice("desktop")}
            >
              <Monitor className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={device === "mobile" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setDevice("mobile")}
            >
              <Smartphone className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-2" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Simulated Product Page */}
        <div className="overflow-y-auto flex-1">
          <div className={`p-6 ${device === "desktop" ? "grid grid-cols-2 gap-8" : "space-y-4"}`}>
            {/* Left: Image */}
            <div className="bg-muted/20 rounded-xl border flex items-center justify-center aspect-square">
              {imageUrl ? (
                <img src={imageUrl} alt={title} className="object-contain w-full h-full rounded-xl" />
              ) : (
                <div className="text-center text-muted-foreground">
                  <ShoppingCart className="w-16 h-16 mx-auto mb-2 opacity-20" />
                  <p className="text-xs">Imagem do Produto</p>
                </div>
              )}
            </div>

            {/* Right: Product Info */}
            <div className="space-y-4">
              {category && (
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{category}</p>
              )}
              <h1 className="text-xl font-bold text-foreground leading-tight">{title}</h1>

              {price && (
                <p className="text-2xl font-bold text-primary">
                  €{typeof price === "number" ? price.toFixed(2) : price}
                </p>
              )}

              {shortDescription && (
                <p className="text-sm text-muted-foreground leading-relaxed">{shortDescription}</p>
              )}

              {/* Add to Cart (decorative) */}
              <div className="flex gap-2 pt-2">
                <Button disabled className="flex-1 opacity-60">
                  <ShoppingCart className="w-4 h-4 mr-2" /> Adicionar ao Carrinho
                </Button>
              </div>

              {seoKeywords && seoKeywords.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground mb-1">SEO Keywords:</p>
                  <div className="flex flex-wrap gap-1">
                    {seoKeywords.map((kw, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Description Tabs */}
          {longDescription && (
            <div className="px-6 pb-6">
              <Tabs defaultValue="description" className="w-full">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="description">Descrição</TabsTrigger>
                  <TabsTrigger value="specs">Especificações</TabsTrigger>
                </TabsList>
                <TabsContent value="description" className="mt-4">
                  <div
                    className="prose prose-sm max-w-none text-foreground
                      [&_.product-description]:text-[15px] [&_.product-description]:leading-relaxed
                      [&_h3]:text-[#00526d] [&_h3]:font-bold [&_h3]:text-lg [&_h3]:border-b-2 [&_h3]:border-[#e5e7eb] [&_h3]:pb-1.5 [&_h3]:mb-2.5 [&_h3]:mt-0
                      [&_h2]:text-[#00526d] [&_h2]:font-bold [&_h2]:text-lg [&_h2]:border-b-2 [&_h2]:border-[#e5e7eb] [&_h2]:pb-1.5 [&_h2]:mb-2.5 [&_h2]:mt-5 first:[&_h2]:mt-0
                      [&_p]:mb-3 [&_p]:leading-relaxed [&_p]:text-foreground/90
                      [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-4
                      [&_td]:border [&_td]:border-border [&_td]:px-4 [&_td]:py-2
                      [&_th]:border [&_th]:border-border [&_th]:px-4 [&_th]:py-2 [&_th]:bg-muted/50 [&_th]:font-bold [&_th]:text-left [&_th]:uppercase [&_th]:text-xs [&_th]:tracking-wider
                      [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
                      [&_li]:mb-1 [&_strong]:text-foreground [&_strong]:font-bold
                      [&_.product-faq]:bg-[#fcfcfd] [&_.product-faq]:border [&_.product-faq]:border-[#e5e7eb] [&_.product-faq]:rounded-lg [&_.product-faq]:p-4
                      [&_.specs-table]:bg-[#f9fafb] [&_.specs-table]:border [&_.specs-table]:border-[#e5e7eb] [&_.specs-table]:rounded-lg [&_.specs-table]:overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(longDescription) }}
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
