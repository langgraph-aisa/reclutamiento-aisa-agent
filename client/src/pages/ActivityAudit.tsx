import { activityOutcomeClass } from "@/components/ActivityAuditBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  ACTIVITY_OUTCOME_LABELS,
  countWords,
  type ActivityOutcome,
} from "@shared/activityAudit";
import { ACTIVITY_SUMMARY_WORD_LIMIT, ACTIVITY_TITLE_WORD_LIMIT } from "@shared/agentConfig";
import { CalendarDays, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

function guatemalaYear() {
  return Number(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "America/Guatemala",
    }).format(new Date())
  );
}

function daysInYear(year: number) {
  const count = new Date(Date.UTC(year + 1, 0, 1)).getTime() - new Date(Date.UTC(year, 0, 1)).getTime();
  return Array.from({ length: count / 86_400_000 }, (_, index) => {
    const date = new Date(Date.UTC(year, 0, index + 1));
    return date.toISOString().slice(0, 10);
  });
}

function calendarCells(year: number) {
  const mondayOffset = (new Date(Date.UTC(year, 0, 1)).getUTCDay() + 6) % 7;
  return [
    ...Array.from({ length: mondayOffset }, (_, index) => `blank-${index}`),
    ...daysInYear(year),
  ];
}

function intensity(count: number) {
  if (count <= 0) return "bg-muted/55";
  if (count <= 2) return "bg-emerald-200";
  if (count <= 5) return "bg-emerald-400";
  if (count <= 9) return "bg-emerald-600";
  return "bg-emerald-800";
}

export default function ActivityAudit() {
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const overview = trpc.activity.overview.useQuery(
    { limit: 100, date: selectedDate },
    {
      refetchInterval: 5_000,
      refetchIntervalInBackground: false,
    }
  );
  const year = guatemalaYear();
  const days = useMemo(() => calendarCells(year), [year]);
  const counts = useMemo(
    () => new Map((overview.data?.heatmap ?? []).map(day => [day.day, day.count])),
    [overview.data?.heatmap]
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
            Auditoría operativa
          </p>
          <h1 className="mt-2 text-4xl font-800 tracking-[-.04em] text-primary">
            Contribuciones a Talento AISA este año
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Eventos humanos, automáticos y de sistema con fecha de Guatemala,
            correlación y detalle minimizado para revisión autorizada.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => overview.refetch()}
          disabled={overview.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />
          Actualizar ahora
        </Button>
      </header>

      <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-primary">
            <CalendarDays className="h-5 w-5" /> Mapa anual {year}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada celda abre el drilldown del día. Las vistas y estados en curso
            no inflan el conteo de contribuciones terminales.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto pb-2">
            <div className="grid w-max grid-flow-col grid-rows-7 gap-1" role="grid" aria-label={`Contribuciones de ${year}`}>
              {days.map(day => {
                if (day.startsWith("blank-")) {
                  return <span key={day} aria-hidden="true" className="h-3 w-3" />;
                }
                const count = counts.get(day) ?? 0;
                return (
                  <button
                    key={day}
                    type="button"
                    role="gridcell"
                    title={`${day}: ${count} contribuciones`}
                    aria-label={`${day}: ${count} contribuciones`}
                    aria-pressed={selectedDate === day}
                    onClick={() => setSelectedDate(current => current === day ? undefined : day)}
                    className={`h-3 w-3 rounded-[3px] border border-black/5 outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring ${intensity(count)} ${selectedDate === day ? "ring-2 ring-primary" : ""}`}
                  />
                );
              })}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Zona horaria: {overview.data?.timezone ?? "America/Guatemala"}</span>
            {selectedDate ? (
              <Button size="sm" variant="ghost" onClick={() => setSelectedDate(undefined)}>
                Mostrar todos los días
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-primary">
            <ShieldCheck className="h-5 w-5" /> Actividad verificable
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(overview.data?.events ?? []).map(event => (
            <article key={`${event.source}:${event.sourceId}`} className="rounded-2xl border border-border/70 p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`rounded-full ${activityOutcomeClass(event.outcome as ActivityOutcome)}`}>
                      {ACTIVITY_OUTCOME_LABELS[event.outcome as ActivityOutcome]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString("es-GT", { timeZone: "America/Guatemala" })}
                    </span>
                    <span className="text-xs text-muted-foreground">{event.pageLabel}</span>
                  </div>
                  <h2 className="mt-2 font-bold text-primary">{event.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{event.summary}</p>
                </div>
                <p className="shrink-0 text-xs text-muted-foreground">{event.actorLabel}</p>
              </div>
              <details className="mt-3 rounded-xl bg-muted/50 p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-primary">Ver dónde inició el control ISO</summary>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Detail label="Inicio" value={new Date(event.controlStartedAt).toLocaleString("es-GT", { timeZone: "America/Guatemala" })} />
                  <Detail label="Correlación" value={event.correlationId} />
                  <Detail label="Acción esperada" value={event.expectedAction ?? "No aplica"} />
                  <Detail label="Acción real" value={event.actualAction ?? event.action} />
                  <Detail label="Título" value={`${countWords(event.title)}/${ACTIVITY_TITLE_WORD_LIMIT} palabras`} />
                  <Detail label="Resumen" value={`${countWords(event.summary)}/${ACTIVITY_SUMMARY_WORD_LIMIT} palabras`} />
                </dl>
              </details>
            </article>
          ))}
          {!overview.isLoading && !overview.data?.events.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No existen eventos para el filtro seleccionado.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-mono text-primary">{value}</dd></div>;
}
