import { useChannelPayloads } from "@/hooks/useChannelPayloads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, CheckCircle, AlertTriangle, RefreshCw, Camera, History, Loader2 } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "Na fila", variant: "outline" },
  building: { label: "A construir", variant: "secondary" },
  built: { label: "Construído", variant: "secondary" },
  validated: { label: "Validado", variant: "default" },
  invalid: { label: "Inválido", variant: "destructive" },
  published: { label: "Publicado", variant: "default" },
  error: { label: "Erro", variant: "destructive" },
};

export default function ChannelPayloadBuilderPage() {
  const { payloads, snapshots, isLoading, validatePayload } = useChannelPayloads();

  const validatedCount = payloads.filter((p: any) => p.payload_status === "validated").length;
  const invalidCount = payloads.filter((p: any) => p.payload_status === "invalid").length;
  const publishedCount = payloads.filter((p: any) => p.payload_status === "published").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Channel Payload Builder</h1>
        <p className="text-muted-foreground mt-1">Transformação e validação de payloads por canal</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Package className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold text-foreground">{payloads.length}</p>
                <p className="text-sm text-muted-foreground">Payloads</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/50"><CheckCircle className="w-5 h-5 text-accent-foreground" /></div>
              <div>
                <p className="text-2xl font-bold text-foreground">{validatedCount}</p>
                <p className="text-sm text-muted-foreground">Validados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
              <div>
                <p className="text-2xl font-bold text-foreground">{invalidCount}</p>
                <p className="text-sm text-muted-foreground">Inválidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Camera className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold text-foreground">{publishedCount}</p>
                <p className="text-sm text-muted-foreground">Publicados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="payloads">
        <TabsList>
          <TabsTrigger value="payloads"><Package className="w-4 h-4 mr-1" /> Payloads</TabsTrigger>
          <TabsTrigger value="snapshots"><History className="w-4 h-4 mr-1" /> Snapshots</TabsTrigger>
        </TabsList>

        <TabsContent value="payloads" className="space-y-3">
          {payloads.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Sem payloads gerados.</CardContent></Card>
          ) : (
            payloads.map((p: any) => {
              const cfg = STATUS_CONFIG[p.payload_status] || STATUS_CONFIG.queued;
              const errors = (p.validation_errors as any[]) || [];
              return (
                <Card key={p.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">
                          Payload v{p.payload_version}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Canal: {p.channel_id?.substring(0, 8) || "—"} • {new Date(p.created_at).toLocaleDateString()}
                        </p>
                        {errors.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {errors.slice(0, 3).map((e: string, i: number) => (
                              <p key={i} className="text-xs text-destructive">{e}</p>
                            ))}
                            {errors.length > 3 && <p className="text-xs text-muted-foreground">+{errors.length - 3} mais</p>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        {p.payload_status === "built" && (
                          <Button size="sm" variant="outline" onClick={() => validatePayload.mutate(p.id)}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Validar
                          </Button>
                        )}
                        {p.payload_status === "invalid" && (
                          <Button size="sm" variant="outline" onClick={() => validatePayload.mutate(p.id)}>
                            <RefreshCw className="w-3 h-3 mr-1" /> Re-validar
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="snapshots" className="space-y-3">
          {snapshots.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Sem snapshots registados.</CardContent></Card>
          ) : (
            snapshots.map((s: any) => (
              <Card key={s.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{s.snapshot_type?.replace(/_/g, " ")}</p>
                      <p className="text-sm text-muted-foreground">
                        Canal: {s.channel_id?.substring(0, 8) || "—"} • {new Date(s.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline">{s.snapshot_type}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
