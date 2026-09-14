import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, Eye, GitBranch, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "sin registro";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Guatemala",
  }).format(new Date(value));
}

export default function GovernanceObservability() {
  const utils = trpc.useUtils();
  const catalog = trpc.governance.catalog.useQuery();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const verify = trpc.governance.verify.useMutation({
    onSuccess: async result => {
      await utils.governance.catalog.invalidate();
      toast.success(
        `Verificación registrada con la traza ${result.traceId ?? "sin identificador"}.`
      );
    },
    onError: error => toast.error(error.message),
  });

  function verifyRules(ruleIds: string[], key: string) {
    setPendingKey(key);
    verify.mutate({ ruleIds }, { onSettled: () => setPendingKey(null) });
  }

  const domains = catalog.data?.domains ?? [];
  const totalVerifications = catalog.data?.totalVerifications ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
            Auditoría de sistemas
          </p>
          <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold tracking-[-.04em] text-primary">
            <Eye className="h-8 w-8 text-emerald-700" aria-hidden="true" />
            Gobierno, Observabilidad y Monitoreo
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Políticas de gobierno agrupadas por categoría, con su resumen y la
            superficie observable de LangGraph que permite verificarlas. Cada
            registro conserva su identificador de traza para auditoría interna.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => catalog.refetch()}
          disabled={catalog.isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${catalog.isFetching ? "animate-spin" : ""}`}
          />
          Actualizar cobertura
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="flex items-center gap-3 pt-6">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-100 text-emerald-800">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Categorías de gobierno
              </p>
              <p className="text-2xl font-semibold text-primary">
                {domains.length}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="flex items-center gap-3 pt-6">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-sky-100 text-sky-800">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Trazas auditadas
              </p>
              <p className="text-2xl font-semibold text-primary">
                {totalVerifications}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="flex items-center gap-3 pt-6">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-100 text-amber-800">
              <GitBranch className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Última verificación
              </p>
              <p className="text-sm font-semibold text-primary">
                {formatTimestamp(catalog.data?.lastVerifiedAt)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border-0 bg-amber-50/70 shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-amber-900">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Límite académico
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-amber-900/90">
          {catalog.data?.notice ??
            "Cada política describe un criterio de gobierno y declara la superficie observable que permite verificarla."}
        </CardContent>
      </Card>

      {catalog.data && !catalog.data.tableReady ? (
        <Card className="rounded-3xl border-red-300/70 bg-red-50/60 shadow-soft">
          <CardContent className="pt-6 text-sm leading-6 text-red-900">
            El registro de verificaciones todavía no existe en este ambiente.
            Aplique la migración
            <span className="mx-1 font-mono text-xs">
              0020_governance_rule_verifications.sql
            </span>
            para habilitar el conteo de trazas auditadas.
          </CardContent>
        </Card>
      ) : null}

      {catalog.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Cargando cobertura de gobierno…
        </p>
      ) : null}

      <div className="space-y-6">
        {domains.map(domain => {
          const domainPending = pendingKey === domain.code;
          return (
            <section
              key={domain.code}
              className={`rounded-3xl border p-1.5 ${domain.accent.frame}`}
            >
              <div className="rounded-[1.35rem] bg-card/85">
                <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${domain.accent.dot}`}
                      aria-hidden="true"
                    />
                    <div>
                      <p
                        className={`text-[11px] font-semibold uppercase tracking-[.18em] ${domain.accent.header}`}
                      >
                        {domain.code} · Categoría de gobierno
                      </p>
                      <h2
                        className={`text-xl font-semibold ${domain.accent.header}`}
                      >
                        {domain.label}
                      </h2>
                      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                        {domain.summary}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={domain.accent.chip}>
                      Trazas auditadas No. {domain.verifications}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={domainPending}
                      onClick={() =>
                        verifyRules(
                          domain.rules.map(rule => rule.id),
                          domain.code
                        )
                      }
                    >
                      {domainPending ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                      )}
                      Verificar categoría
                    </Button>
                  </div>
                </header>
                <div className="grid gap-3 p-5 lg:grid-cols-2 xl:grid-cols-3">
                  {domain.rules.map(rule => {
                    const rulePending = pendingKey === rule.id;
                    return (
                      <article
                        key={rule.id}
                        className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/60 p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p
                              className={`text-[10px] font-semibold uppercase tracking-wider ${domain.accent.header}`}
                            >
                              {rule.id}
                            </p>
                            <h3 className="mt-1 text-sm font-semibold text-primary">
                              {rule.label}
                            </h3>
                          </div>
                          <Badge
                            variant="outline"
                            className={domain.accent.chip}
                          >
                            No. {rule.verifications}
                          </Badge>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {rule.summary}
                        </p>
                        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                          <GitBranch
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Verificación LangGraph · {rule.traceSurface}</span>
                        </p>
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                          <span className="text-[11px] text-muted-foreground">
                            Trazas auditadas No. {rule.verifications} ·{" "}
                            {formatTimestamp(rule.lastVerifiedAt)}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-full"
                            disabled={rulePending}
                            onClick={() =>
                              verifyRules([rule.id], rule.id)
                            }
                          >
                            {rulePending ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Verificar
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
