import { useState, useEffect, useCallback, useMemo } from "react";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BookOpen, Check, Loader2, Sparkles, Eye, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Product } from "@/hooks/useProducts";

interface UsoContent {
  intro: string;
  useCases: Array<{ context: string; description: string }>;
  professionalTips: string[];
  targetProfiles: string[];
}

interface Props {
  product: Product;
  workspaceId: string;
}

export function UsoProfissionalTab({ product, workspaceId }: Props) {
  const [usoContent, setUsoContent] = useState<UsoContent | null>(null);
  const [usoLoading, setUsoLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [publishEnabled, setPublishEnabled] = useState(false);
  const [placement, setPlacement] = useState<"before_faq" | "after_faq" | "end_description">("before_faq");
  const [showPreview, setShowPreview] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const loadUsoContent = useCallback(async () => {
    setLoadingData(true);
    try {
      const { data, error } = await supabase
        .from("product_uso_profissional" as any)
        .select("*")
        .eq("product_id", product.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const d = data as any;
        setUsoContent({
          intro: d.intro || "",
          useCases: Array.isArray(d.use_cases) ? d.use_cases : [],
          professionalTips: Array.isArray(d.professional_tips) ? d.professional_tips : [],
          targetProfiles: Array.isArray(d.target_profiles) ? d.target_profiles : [],
        });
        setPublishEnabled(d.publish_enabled ?? false);
        setPlacement(d.placement ?? "before_faq");
        setSavedId(d.id);
      } else {
        setUsoContent(null);
        setSavedId(null);
      }
    } catch (err) {
      console.error("Error loading uso profissional:", err);
    } finally {
      setLoadingData(false);
    }
  }, [product.id, workspaceId]);

  useEffect(() => {
    void loadUsoContent();
  }, [loadUsoContent]);

  useEffect(() => {
    const onUsoUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ productId?: string; workspaceId?: string }>).detail;
      if (detail?.productId === product.id && detail?.workspaceId === workspaceId) {
        void loadUsoContent();
      }
    };

    window.addEventListener("uso-profissional-updated", onUsoUpdated as EventListener);
    return () => window.removeEventListener("uso-profissional-updated", onUsoUpdated as EventListener);
  }, [loadUsoContent, product.id, workspaceId]);

  useEffect(() => {
    if (usoContent) return;
    const intervalId = window.setInterval(() => {
      void loadUsoContent();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [loadUsoContent, usoContent]);

  const generateUsoContent = useCallback(async () => {
    setUsoLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-uso-profissional", {
        body: {
          workspaceId,
          productId: product.id,
          productTitle: product.optimized_title || product.original_title || "",
          productDescription: product.optimized_description || product.original_description || "",
          productCategory: product.category || "",
          productAttributes: Array.isArray((product as any).attributes) ? (product as any).attributes : [],
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setUsoContent(data);
      toast.success("Conteúdo gerado com sucesso!");
    } catch (err) {
      toast.error("Erro ao gerar conteúdo: " + (err as Error).message);
    }
    setUsoLoading(false);
  }, [product, workspaceId]);

  const saveAndPublish = useCallback(async () => {
    if (!usoContent) return;
    try {
      const payload = {
        product_id: product.id,
        workspace_id: workspaceId,
        intro: usoContent.intro,
        use_cases: usoContent.useCases,
        professional_tips: usoContent.professionalTips,
        target_profiles: usoContent.targetProfiles,
        publish_enabled: publishEnabled,
        placement,
        routing_in_description: publishEnabled,
        routing_in_custom_field: false,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: savedRow, error } = await supabase
        .from("product_uso_profissional" as any)
        .upsert(payload as any, { onConflict: "product_id,workspace_id" })
        .select("id")
        .maybeSingle();

      if (error) throw error;

      if (savedRow) {
        setSavedId((savedRow as any).id);
      }
      await loadUsoContent();

      if (publishEnabled) {
        // Build HTML and publish via existing publish-woocommerce
        const usoHtml = buildUsoHtml(usoContent);
        const currentDesc = product.optimized_description || product.original_description || "";
        const newDesc = buildDescriptionWithUso(currentDesc, usoHtml, placement);

        // Update product description in DB
        const { error: updateErr } = await supabase
          .from("products")
          .update({ optimized_description: newDesc })
          .eq("id", product.id);

        if (updateErr) {
          console.warn("Failed to update product description:", updateErr);
        }

        toast.success("Conteúdo guardado e descrição atualizada!");
      } else {
        toast.success("Conteúdo guardado!");
      }

      window.dispatchEvent(new CustomEvent("uso-profissional-updated", {
        detail: { productId: product.id, workspaceId },
      }));
    } catch (err) {
      toast.error("Erro ao guardar: " + (err as Error).message);
    }
  }, [usoContent, product, workspaceId, publishEnabled, placement, loadUsoContent]);

  // Content update helpers
  const updateIntro = (v: string) => setUsoContent((c) => c ? { ...c, intro: v } : c);
  const updateUseCase = (idx: number, field: "context" | "description", v: string) =>
    setUsoContent((c) => {
      if (!c) return c;
      const useCases = [...c.useCases];
      useCases[idx] = { ...useCases[idx], [field]: v };
      return { ...c, useCases };
    });
  const addUseCase = () =>
    setUsoContent((c) => c ? { ...c, useCases: [...c.useCases, { context: "", description: "" }] } : c);
  const removeUseCase = (idx: number) =>
    setUsoContent((c) => c ? { ...c, useCases: c.useCases.filter((_, i) => i !== idx) } : c);
  const updateTip = (idx: number, v: string) =>
    setUsoContent((c) => {
      if (!c) return c;
      const tips = [...c.professionalTips];
      tips[idx] = v;
      return { ...c, professionalTips: tips };
    });
  const addTip = () =>
    setUsoContent((c) => c ? { ...c, professionalTips: [...c.professionalTips, ""] } : c);
  const removeTip = (idx: number) =>
    setUsoContent((c) => c ? { ...c, professionalTips: c.professionalTips.filter((_, i) => i !== idx) } : c);
  const addProfile = (name: string) =>
    setUsoContent((c) => c ? { ...c, targetProfiles: [...c.targetProfiles, name] } : c);
  const removeProfile = (idx: number) =>
    setUsoContent((c) => c ? { ...c, targetProfiles: c.targetProfiles.filter((_, i) => i !== idx) } : c);

  const [newProfile, setNewProfile] = useState("");

  const usoHtml = useMemo(() => usoContent ? buildUsoHtml(usoContent) : "", [usoContent]);

  if (loadingData) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-medium text-sm">Como é usado por profissionais</h3>
          <p className="text-xs text-muted-foreground">
            Conteúdo editorial gerado por IA — não são reviews de clientes
          </p>
        </div>
        <div className="flex gap-2">
          {usoContent && (
            <Button size="sm" variant="outline" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="w-3 h-3 mr-1" />
              {showPreview ? "Fechar" : "Pré-visualizar"}
            </Button>
          )}
          <Button size="sm" onClick={generateUsoContent} disabled={usoLoading}>
            {usoLoading ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3 mr-1" />
            )}
            {usoContent ? "Regenerar" : "Gerar conteúdo"}
          </Button>
        </div>
      </div>

      {/* Preview */}
      {showPreview && usoContent && (
        <div className="border rounded-lg p-4 bg-muted/30 text-sm prose max-w-none">
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(usoHtml) }} />
        </div>
      )}

      {/* Empty state */}
      {!usoContent && (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Ainda sem conteúdo de uso profissional</p>
          <p className="text-xs mt-1">
            Clica em "Gerar conteúdo" para criar descrições de uso para profissionais de hotelaria
          </p>
        </div>
      )}

      {/* Content editing */}
      {usoContent && (
        <>
          {/* Intro */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <h4 className="text-sm font-medium">Introdução</h4>
              <Textarea
                value={usoContent.intro}
                onChange={(e) => updateIntro(e.target.value)}
                rows={3}
                className="text-sm"
              />
            </CardContent>
          </Card>

          {/* Use Cases */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Casos de uso</h4>
                <Button size="sm" variant="ghost" onClick={addUseCase}>
                  <Plus className="w-3 h-3 mr-1" /> Adicionar
                </Button>
              </div>
              {usoContent.useCases.map((uc, idx) => (
                <div key={idx} className="space-y-2 p-3 rounded-lg bg-muted/30 relative">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute top-1 right-1 h-6 w-6 p-0"
                    onClick={() => removeUseCase(idx)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                  <Input
                    value={uc.context}
                    onChange={(e) => updateUseCase(idx, "context", e.target.value)}
                    placeholder="Contexto (ex: Restaurante de Fine Dining)"
                    className="text-sm h-8"
                  />
                  <Textarea
                    value={uc.description}
                    onChange={(e) => updateUseCase(idx, "description", e.target.value)}
                    rows={2}
                    placeholder="Descrição de como é usado neste contexto..."
                    className="text-sm"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Professional Tips */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Dicas profissionais</h4>
                <Button size="sm" variant="ghost" onClick={addTip}>
                  <Plus className="w-3 h-3 mr-1" /> Adicionar dica
                </Button>
              </div>
              {usoContent.professionalTips.map((tip, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">•</span>
                  <Input
                    value={tip}
                    onChange={(e) => updateTip(idx, e.target.value)}
                    className="text-sm h-8 flex-1"
                  />
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeTip(idx)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Target Profiles */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <h4 className="text-sm font-medium">Perfis profissionais</h4>
              <div className="flex flex-wrap gap-1.5">
                {usoContent.targetProfiles.map((profile, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs gap-1 pr-1">
                    {profile}
                    <button onClick={() => removeProfile(idx)} className="ml-0.5 hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newProfile}
                  onChange={(e) => setNewProfile(e.target.value)}
                  placeholder="Novo perfil..."
                  className="text-sm h-8"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newProfile.trim()) {
                      addProfile(newProfile.trim());
                      setNewProfile("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => {
                    if (newProfile.trim()) {
                      addProfile(newProfile.trim());
                      setNewProfile("");
                    }
                  }}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Publication settings */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <p className="text-sm font-medium">Opções de publicação no WooCommerce</p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Incluir no produto</p>
                  <p className="text-xs text-muted-foreground">
                    Ativa para adicionar este conteúdo à página do produto
                  </p>
                </div>
                <Switch checked={publishEnabled} onCheckedChange={setPublishEnabled} />
              </div>

              {publishEnabled && (
                <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Posição na página do produto
                  </p>
                  <RadioGroup value={placement} onValueChange={(v: any) => setPlacement(v)}>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="before_faq" id="before_faq" className="mt-0.5" />
                      <Label htmlFor="before_faq" className="cursor-pointer">
                        <p className="text-sm">Antes das FAQ</p>
                        <p className="text-xs text-muted-foreground">
                          Recomendado — aparece na descrição antes do bloco de perguntas frequentes
                        </p>
                      </Label>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="after_faq" id="after_faq" className="mt-0.5" />
                      <Label htmlFor="after_faq" className="cursor-pointer">
                        <p className="text-sm">Depois das FAQ</p>
                        <p className="text-xs text-muted-foreground">
                          Adiciona o bloco de uso profissional a seguir às FAQ
                        </p>
                      </Label>
                    </div>
                    <div className="flex items-start gap-2">
                      <RadioGroupItem value="end_description" id="end_description" className="mt-0.5" />
                      <Label htmlFor="end_description" className="cursor-pointer">
                        <p className="text-sm">No final da descrição</p>
                        <p className="text-xs text-muted-foreground">
                          Adiciona no final de todo o conteúdo da descrição
                        </p>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              )}

              <Button className="w-full" onClick={saveAndPublish} disabled={!usoContent || usoLoading}>
                <Check className="w-3.5 h-3.5 mr-1.5" />
                {publishEnabled ? "Guardar e publicar no WooCommerce" : "Guardar sem publicar"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── HTML Builder ──────────────────────────────────────────────────────────

function buildUsoHtml(content: UsoContent): string {
  return `
<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->
<div class="uso-profissional-hotelequip" style="margin-top:2em;padding-top:1.5em;border-top:1px solid #e5e7eb;">
  <h3 style="font-size:1.1em;font-weight:600;margin-bottom:0.75em;color:#00526d;">
    Como é usado por profissionais
  </h3>
  <p>${content.intro}</p>
  
  <h4 style="font-weight:600;margin:1em 0 0.5em;color:#00526d;">Contextos de utilização</h4>
  <ul style="padding-left:1.25em;">
    ${content.useCases
      .map(
        (uc) =>
          `<li style="margin-bottom:0.5em;">
        <strong>${uc.context}:</strong> ${uc.description}
      </li>`
      )
      .join("")}
  </ul>
  
  <h4 style="font-weight:600;margin:1em 0 0.5em;color:#00526d;">Dicas de profissionais</h4>
  <ul style="padding-left:1.25em;">
    ${content.professionalTips.map((tip) => `<li style="margin-bottom:0.25em;">${tip}</li>`).join("")}
  </ul>
</div>
<!-- HOTELEQUIP:USO_PROFISSIONAL_END -->`.trim();
}

function buildDescriptionWithUso(
  currentDescription: string,
  usoHtml: string,
  placement: "before_faq" | "after_faq" | "end_description"
): string {
  // First, remove any existing uso block using markers
  const markerRegex =
    /<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->[\s\S]*?<!-- HOTELEQUIP:USO_PROFISSIONAL_END -->/g;
  let cleanDesc = currentDescription.replace(markerRegex, "").trim();

  // Also remove legacy class-based blocks
  const legacyRegex = /<div class="uso-profissional-hotelequip"[\s\S]*?<\/div>/g;
  cleanDesc = cleanDesc.replace(legacyRegex, "").trim();

  const faqMarkers = [
    '<div class="product-faq',
    '<div class="faq',
    "<h3>Perguntas Frequentes",
    "<h3>FAQ",
    '<section class="faq',
    "Perguntas Frequentes",
  ];

  const faqIndex = faqMarkers.reduce((found, marker) => {
    if (found !== -1) return found;
    const idx = cleanDesc.toLowerCase().indexOf(marker.toLowerCase());
    return idx !== -1 ? idx : -1;
  }, -1);

  if (placement === "before_faq" && faqIndex !== -1) {
    return cleanDesc.slice(0, faqIndex) + usoHtml + "\n" + cleanDesc.slice(faqIndex);
  }

  if (placement === "after_faq" && faqIndex !== -1) {
    // Find the closing marker of the FAQ section
    const afterFaq = cleanDesc.indexOf("</div>", faqIndex);
    const insertAt = afterFaq !== -1 ? afterFaq + 6 : cleanDesc.length;
    return cleanDesc.slice(0, insertAt) + "\n" + usoHtml + cleanDesc.slice(insertAt);
  }

  // Default: append at end
  return cleanDesc + "\n" + usoHtml;
}
