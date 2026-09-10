import { useAuth } from "@/_core/hooks/useAuth";
import { AppBrand } from "@/components/AppBrand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PRIVACY_TERMS_PATH } from "@shared/applicationConsent";
import { STANDARD_WORK_SCHEDULE } from "@shared/jobPresentation";
import {
  ArrowRight,
  BriefcaseBusiness,
  ClipboardCheck,
  Clock3,
  Database,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Sparkles,
  SunMedium,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const emptyStats = {
  total: 0,
  enRevision: 0,
  calificados: 0,
  calificadosAisa: 0,
  entrevistas: 0,
  positions: 0,
};

export default function Home() {
  const { user, loading } = useAuth();
  const statsQuery = trpc.dashboard.summary.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const publishedJobsQuery = trpc.publicJobs.listPublished.useQuery(undefined, {
    enabled: !loading && !user,
  });
  const stats = statsQuery.data ?? emptyStats;

  if (loading)
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        Cargando espacio de trabajo…
      </div>
    );

  if (!user) {
    return (
      <main className="min-h-screen overflow-hidden grid-paper">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-7 sm:py-7 lg:px-8">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AppBrand className="h-12" />
              <p className="hidden text-xs text-muted-foreground sm:block">
                Reclutamiento por evidencia
              </p>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <Link href="/login">
                <Button variant="outline" className="rounded-full px-5">
                  Acceso Administrativo
                </Button>
              </Link>
            </div>
          </header>
          <section className="grid gap-8 pb-12 pt-10 sm:pt-14 lg:grid-cols-[1.03fr_.97fr] lg:items-center lg:pt-16">
            <div className="min-w-0">
              <Badge className="mb-4 rounded-full bg-accent text-accent-foreground hover:bg-accent">
                Operación más humana, decisiones más claras
              </Badge>
              <h1 className="max-w-2xl text-balance text-5xl font-800 leading-[1.02] tracking-[-0.06em] text-primary sm:text-6xl xl:text-7xl">
                Cada candidato merece una evaluación{" "}
                <span className="text-emerald-700">a su medida.</span>
              </h1>
              <div className="mt-5 max-w-2xl">
                <h2 className="text-lg font-800 text-primary">
                  ¿Qué es Talento AISA?
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  Talento AISA representa una comunidad de profesionales
                  orientados a soluciones inteligentes en energías renovables,
                  refrigeración, bombeo y calentamiento solar, combinando
                  conocimiento técnico, experiencia práctica, servicio al
                  cliente, innovación y crecimiento profesional para transformar
                  necesidades.
                </p>
              </div>
              <div className="relative mt-5 min-h-[25rem] sm:min-h-[28rem] lg:min-h-[29rem]">
                <div className="relative z-10 max-w-sm pt-2 sm:pt-5">
                  <div className="flex flex-wrap gap-3">
                    <Button asChild size="lg" className="rounded-full px-5">
                      <a
                        href="https://www.aisa.com.gt/productos-solares-en-guatemala/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Conocer nuestros productos
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      size="lg"
                      className="rounded-full px-5"
                    >
                      <a
                        href="https://www.aisa.com.gt/contactoaisa/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Contactar a AISA
                      </a>
                    </Button>
                  </div>
                  <div className="mt-6 space-y-3 text-xs text-muted-foreground sm:text-sm">
                    <a
                      href={PRIVACY_TERMS_PATH}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-fit items-start gap-2 rounded-lg underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <span>Privacidad, Términos y Condiciones</span>
                    </a>
                    <span className="flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 shrink-0 text-emerald-700" />
                      Plataforma Laboral No.1
                    </span>
                  </div>
                </div>
                <img
                  src="/brand/talento-aisa-personaje.png"
                  alt="JARVI, personaje de Talento AISA"
                  width="640"
                  height="960"
                  className="absolute bottom-0 right-[-1rem] z-0 max-h-[28rem] w-48 object-contain object-bottom drop-shadow-[0_18px_24px_rgba(3,36,62,.22)] sm:right-0 sm:w-72 lg:right-[-2rem] lg:w-[24rem]"
                  loading="eager"
                  decoding="async"
                />
              </div>
            </div>
            <div id="plazas-online" className="relative scroll-mt-6">
              <div className="absolute -inset-6 rounded-[2rem] bg-emerald-100/60 blur-3xl" />
              <PublicOpportunityCard
                jobs={publishedJobsQuery.data ?? []}
                loading={publishedJobsQuery.isLoading}
              />
            </div>
          </section>
          <section className="grid gap-4 border-t border-primary/10 py-7 sm:grid-cols-3">
            <Feature
              icon={SunMedium}
              title="Construya su carrera transformando energía en oportunidades."
            />
            <Feature
              icon={GraduationCap}
              title="Crezca profesionalmente con tecnología, propósito y aprendizaje."
            />
            <Feature
              icon={Lightbulb}
              title="Convierta sus habilidades en soluciones que transforman."
            />
          </section>
          <footer className="border-t border-primary/10 py-5 text-center text-xs text-muted-foreground sm:text-left">
            Todos los derechos reservados por Alternativas Inteligentes, S.A.
          </footer>
        </div>
      </main>
    );
  }

  const metrics = [
    {
      label: "Postulaciones",
      value: stats.total,
      note: "Todas las plazas",
      icon: UsersRound,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "En revisión",
      value: stats.enRevision,
      note: "Requieren atención",
      icon: ClipboardCheck,
      tone: "bg-amber-50 text-amber-700",
    },
    {
      label: "Solicitar CV por WhatsApp",
      value: stats.calificados,
      note: "Acciones registradas",
      icon: Sparkles,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Calificado por AISA",
      value: stats.calificadosAisa,
      note: "Sin evento automático",
      icon: ClipboardCheck,
      tone: "bg-violet-50 text-violet-700",
    },
    {
      label: "Entrevistas",
      value: stats.entrevistas,
      note: "En cualquier estado",
      icon: MessageCircle,
      tone: "bg-fuchsia-50 text-fuchsia-700",
    },
  ];
  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
            Centro de mando
          </p>
          <h1 className="mt-2 text-4xl font-800 tracking-[-.04em] text-primary">
            Buenos días, {user.name?.split(" ")[0] ?? "equipo"}.
          </h1>
          <p className="mt-2 text-muted-foreground">
            Una vista rápida de la operación de selección.
          </p>
        </div>
        <Link href="/admin/jobs">
          <Button className="rounded-full">
            Gestionar plazas <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(metric => (
          <Card key={metric.label} className="rounded-3xl border-0 shadow-soft">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {metric.label}
                  </p>
                  <p className="mt-3 text-4xl font-800 tracking-tight text-primary">
                    {metric.value}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {metric.note}
                  </p>
                </div>
                <div
                  className={`grid h-11 w-11 place-items-center rounded-2xl ${metric.tone}`}
                >
                  <metric.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl text-primary">
                Su operación
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Atajos para las tareas más frecuentes.
              </p>
            </div>
            <Badge variant="outline" className="rounded-full">
              {stats.positions} plazas
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Quick
              href="/admin/jobs"
              icon={LayoutDashboard}
              title="Configurar plazas"
              text="Publique enlaces seguros y asigne un agente."
            />
            <Quick
              href="/admin/candidates"
              icon={UsersRound}
              title="Revisar candidatos"
              text="Filtre estados y registre decisiones humanas."
            />
            <Quick
              href="/admin/reports"
              icon={Database}
              title="Ver informes"
              text="Convierta el flujo en señales accionables."
            />
            <Quick
              href="/admin/config"
              icon={MessageCircle}
              title="Integraciones"
              text="Administre receptores y variables de conexión."
            />
          </CardContent>
        </Card>
        <Card className="rounded-3xl border-0 bg-[#0b2d4b] text-white shadow-soft dark:bg-[#162333]">
          <CardHeader>
            <CardTitle className="text-xl text-white">
              Principio operativo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-800 leading-tight">
              Reglas claras. Contexto completo. Siguiente paso oportuno.
            </p>
            <p className="mt-5 text-sm leading-6 text-white/65">
              La acción “Solicitar CV por WhatsApp” conserva una ventana de 30
              segundos antes de activar la continuación.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof LayoutDashboard;
  title: string;
  text?: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/8 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-sm font-semibold leading-5 text-primary">{title}</p>
        {text && (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{text}</p>
        )}
      </div>
    </div>
  );
}
function Quick({
  href,
  icon: Icon,
  title,
  text,
}: {
  href: string;
  icon: typeof LayoutDashboard;
  title: string;
  text: string;
}) {
  return (
    <Link href={href}>
      <div className="group flex gap-4 rounded-2xl border border-border/70 p-4 hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50/40">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-primary group-hover:text-emerald-800">
            {title}
          </p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{text}</p>
        </div>
      </div>
    </Link>
  );
}

type PublishedJob = {
  id: number;
  token: string;
  title: string;
  department: string | null;
  locationLabel: string | null;
  description: string | null;
  profileName: string | null;
  profileObjective: string;
  requiredRequirements: string[];
  academicLevel: string | null;
  displayLocation: string;
};

function PublicOpportunityCard({
  jobs,
  loading,
}: {
  jobs: PublishedJob[];
  loading: boolean;
}) {
  const [selectedToken, setSelectedToken] = useState("");
  const selectedJob = jobs.find(job => job.token === selectedToken) ?? jobs[0];

  return (
    <Card className="relative overflow-hidden rounded-[2rem] border-white/70 bg-primary text-primary-foreground shadow-lift dark:bg-[#162333] dark:text-white">
      <CardHeader className="px-4 pb-2 pt-4 sm:px-5 sm:pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-white/55">Invitación de Talento AISA</p>
            <CardTitle className="mt-1 text-xl font-800 uppercase tracking-[.04em] text-white sm:text-2xl">
              OPORTUNIDADES DISPONIBLES
            </CardTitle>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-semibold text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Online
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
        {loading ? (
          <div className="space-y-3" aria-live="polite">
            <div className="h-11 animate-pulse rounded-xl bg-white/10" />
            <div className="h-28 animate-pulse rounded-2xl bg-white/8" />
            <p className="text-center text-sm text-white/60">
              Cargando plazas publicadas…
            </p>
          </div>
        ) : selectedJob ? (
          <>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[.14em] text-white/55">
                Seleccionar plaza
              </label>
              <Select
                value={selectedJob.token}
                onValueChange={setSelectedToken}
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-white/20 bg-white/10 text-left text-white shadow-none hover:bg-white/15 focus:ring-emerald-300/40">
                  <SelectValue placeholder="Seleccione una plaza" />
                </SelectTrigger>
                <SelectContent align="start">
                  {jobs.map(job => (
                    <SelectItem key={job.id} value={job.token}>
                      {job.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-2xl bg-white/8 p-4">
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-200">
                Objetivo del puesto
              </p>
              <h2 className="mt-2 text-2xl font-800 tracking-[-.03em] text-white">
                {selectedJob.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/70">
                {selectedJob.profileObjective}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <OpportunityDetail
                icon={BriefcaseBusiness}
                label="Perfil"
                value={selectedJob.profileName || selectedJob.title}
              />
              <OpportunityDetail
                icon={GraduationCap}
                label="Nivel académico"
                value={
                  selectedJob.academicLevel ||
                  "Según los requisitos de la plaza"
                }
              />
              <OpportunityDetail
                icon={MapPin}
                label="Ubicación"
                value={selectedJob.displayLocation}
              />
              <OpportunityDetail
                icon={Clock3}
                label="Horario de trabajo"
                value={STANDARD_WORK_SCHEDULE}
              />
            </div>

            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-emerald-200">
                Requisitos del puesto
              </p>
              <ul className="mt-2 space-y-1.5 text-sm leading-5 text-white/80">
                {selectedJob.requiredRequirements.map((requirement, index) => (
                  <li
                    key={`${selectedJob.id}-requirement-${index}`}
                    className="flex gap-2"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-200"
                    />
                    <span>{requirement}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Link href={`/apply/${selectedJob.token}`}>
              <Button
                size="lg"
                className="w-full rounded-2xl bg-white text-[#0B2945] hover:bg-white/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
              >
                Aplicar ahora <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/8 p-6 text-center">
            <BriefcaseBusiness className="mx-auto h-7 w-7 text-emerald-200" />
            <p className="mt-3 font-semibold text-white">
              No hay plazas en línea por el momento
            </p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              Cuando se publique una nueva oportunidad con formulario, aparecerá
              aquí automáticamente.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpportunityDetail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BriefcaseBusiness;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 rounded-2xl bg-white/8 p-3.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
      <div className="min-w-0">
        <p className="text-xs text-white/50">{label}</p>
        <p className="mt-1 text-sm font-medium leading-5 text-white/90">
          {value}
        </p>
      </div>
    </div>
  );
}
