import { ArrowRight, Lock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function PublicLandingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-10 px-6 py-16 lg:px-10">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          Hotelequip Product Optimizer
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,420px)] lg:items-center">
          <div className="space-y-6">
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                Plataforma de otimização de catálogo com acesso público ao site e área privada para operação.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                O site já pode ser aberto por qualquer visitante, enquanto as áreas internas de gestão continuam protegidas por autenticação.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/login">
                  Entrar na área privada
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#overview">Ver resumo</a>
              </Button>
            </div>
          </div>

          <Card className="border-border bg-card shadow-sm">
            <CardContent className="space-y-5 p-6">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-4">
                <Lock className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Área interna protegida</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Produtos, workspaces, membros e automações continuam acessíveis apenas após login.
                  </p>
                </div>
              </div>

              <div id="overview" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <div className="rounded-xl border border-border p-4">
                  <p className="text-sm font-medium">Ingestão</p>
                  <p className="mt-1 text-sm text-muted-foreground">Importação de WooCommerce, PDF e scraping assistido.</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-sm font-medium">Otimização</p>
                  <p className="mt-1 text-sm text-muted-foreground">Enriquecimento de conteúdo, SEO e media com IA.</p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="text-sm font-medium">Controlo</p>
                  <p className="mt-1 text-sm text-muted-foreground">Governance, aprovação e operação multi-workspace.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}