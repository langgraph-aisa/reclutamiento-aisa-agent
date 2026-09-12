import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  ACTIVITY_OUTCOME_LABELS,
  normalizeAdminPath,
  type ActivityOutcome,
} from "@shared/activityAudit";
import { Activity, ArrowRight, Clock3, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "wouter";

function sessionCorrelation(path: string) {
  const normalized = normalizeAdminPath(path).replace(/[^a-z0-9]+/gi, "-");
  const storageKey = `jarvi-activity-session:${normalized}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const correlation = `view:${crypto.randomUUID()}:${normalized}`.slice(0, 80);
  sessionStorage.setItem(storageKey, correlation);
  return correlation;
}

export function activityOutcomeClass(outcome: ActivityOutcome) {
  if (outcome === "guardado")
    return "border-emerald-300 bg-emerald-100 text-emerald-900";
  if (outcome === "configuracion")
    return "border-red-300 bg-red-100 text-red-900";
  if (outcome === "error")
    return "border-rose-300 bg-rose-100 text-rose-900";
  return "border-amber-300 bg-amber-100 text-amber-950";
}

export function ActivityAuditBar() {
  const [location] = useLocation();
  const pagePath = normalizeAdminPath(location);
  const overview = trpc.activity.overview.useQuery(
    { pagePath, limit: 1 },
    {
      refetchInterval: 5_000,
      refetchIntervalInBackground: false,
      retry: false,
    }
  );
  const record = trpc.activity.record.useMutation({
    onSuccess: () => overview.refetch(),
  });
  const recorded = useRef(new Set<string>());
  const correlationId = useMemo(
    () => sessionCorrelation(pagePath),
    [pagePath]
  );

  useEffect(() => {
    if (recorded.current.has(correlationId)) return;
    recorded.current.add(correlationId);
    record.mutate(
      { pagePath, eventType: "page_opened", correlationId },
      { onError: () => recorded.current.delete(correlationId) }
    );
  }, [correlationId, pagePath, record]);

  const event = overview.data?.events[0];
  if (!event) return null;

  return (
    <section
      aria-label="Resumen de actividad y control ISO"
      className="mb-4 rounded-2xl border border-border/70 bg-card px-3 py-3 shadow-sm sm:px-4"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">
                {overview.data?.title}
              </p>
              <Badge
                variant="outline"
                className={`rounded-full ${activityOutcomeClass(event.outcome)}`}
              >
                {ACTIVITY_OUTCOME_LABELS[event.outcome]}
              </Badge>
            </div>
            <p className="mt-1 truncate text-sm font-bold text-primary">
              {event.title}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> {event.pageLabel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" />
            {new Date(event.createdAt).toLocaleString("es-GT", {
              timeZone: "America/Guatemala",
            })}
          </span>
          <Link href="/admin/activity">
            <Button size="sm" variant="outline" className="rounded-full">
              Ver control ISO <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
