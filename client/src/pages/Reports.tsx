import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  PieChart,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import {
  applicationStatusLabel,
  applicationStatusTone,
} from "@shared/applicationStatus";

export default function Reports() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = trpc.reports.overview.useQuery({
    from: from || undefined,
    to: to || undefined,
  });
  const report = query.data ?? {
    byStatus: [],
    byPosition: [],
    reasons: [],
    responseTime: { average_hours: null },
  };
  const total = report.byStatus.reduce(
    (sum: number, row: any) => sum + Number(row.count ?? 0),
    0
  );
  const qualified = Number(
    report.byStatus.find((x: any) => x.status === "calificado")?.count ?? 0
  );
  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
            Inteligencia operativa
          </p>
          <h1 className="mt-2 text-4xl font-800 tracking-[-.04em] text-primary">
            Informes
          </h1>
          <p className="mt-2 text-muted-foreground">
            Convierta el movimiento de postulaciones en decisiones de equipo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="w-36 rounded-full"
            aria-label="Desde"
          />
          <span className="text-xs text-muted-foreground">a</span>
          <Input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="w-36 rounded-full"
            aria-label="Hasta"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric icon={UsersRound} label="Postulaciones" value={total} />
        <Metric
          icon={TrendingUp}
          label="Conversión a solicitud de CV por WhatsApp"
          value={total ? `${Math.round((qualified / total) * 100)}%` : "0%"}
        />
        <Metric
          icon={Clock3}
          label="Tiempo promedio"
          value={
            report.responseTime?.average_hours
              ? `${report.responseTime.average_hours} h`
              : "—"
          }
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportCard icon={PieChart} title="Resultado por estado">
          <div className="space-y-4">
            {report.byStatus.length ? (
              report.byStatus.map((row: any) => (
                <Bar
                  key={row.status}
                  label={applicationStatusLabel(row.status)}
                  value={Number(row.count)}
                  total={total}
                  tone={
                    {
                      neutral: "bg-slate-500",
                      priority: "bg-violet-500",
                      positive: "bg-emerald-500",
                      conditional: "bg-sky-500",
                      review: "bg-amber-500",
                      negative: "bg-red-500",
                      interview: "bg-cyan-500",
                      error: "bg-rose-500",
                    }[applicationStatusTone(row.status)]
                  }
                />
              ))
            ) : (
              <Empty text="Los resultados aparecerán al recibir postulaciones." />
            )}
          </div>
        </ReportCard>
        <ReportCard icon={BarChart3} title="Postulaciones por plaza">
          <div className="space-y-4">
            {report.byPosition.length ? (
              report.byPosition.map((row: any) => (
                <Bar
                  key={row.title}
                  label={row.title}
                  value={Number(row.count)}
                  total={Math.max(
                    ...report.byPosition.map((item: any) => Number(item.count)),
                    1
                  )}
                  tone="bg-emerald-500"
                />
              ))
            ) : (
              <Empty text="Cree una plaza y publique su formulario para comenzar." />
            )}
          </div>
        </ReportCard>
      </div>
      <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-50 text-amber-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-primary">
                Motivos de evaluación
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Resumen de los criterios que más influyen en cada decisión.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {report.reasons.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {report.reasons.map((row: any) => (
                <div key={row.reason} className="rounded-2xl bg-muted/65 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-6 text-primary">
                      {row.reason}
                    </p>
                    <Badge variant="outline" className="rounded-full">
                      {row.count}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Aún no hay motivos registrados." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UsersRound;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="rounded-3xl border-0 shadow-soft">
      <CardContent className="p-5">
        <Icon className="h-5 w-5 text-emerald-700" />
        <p className="mt-5 text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-800 text-primary">{value}</p>
      </CardContent>
    </Card>
  );
}
function ReportCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof PieChart;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-3xl border-0 shadow-soft">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl text-primary">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
function Bar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
}) {
  const width = `${Math.max(5, Math.round((value / Math.max(total, 1)) * 100))}%`;
  return (
    <div>
      <div className="mb-2 flex justify-between gap-3 text-sm">
        <span className="text-primary">{label}</span>
        <span className="font-semibold text-muted-foreground">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width }} />
      </div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-2xl bg-muted/60 p-5 text-sm leading-6 text-muted-foreground">
      {text}
    </p>
  );
}
