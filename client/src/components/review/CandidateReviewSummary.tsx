import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExpedienteSignalBadges } from "@/components/review/ExpedienteSignalBadges";
import { trpc } from "@/lib/trpc";
import {
  APPLICATION_STATUS_OPTIONS,
  applicationStatusLabel,
  applicationStatusTone,
} from "@shared/applicationStatus";
import { institutionalStamp } from "@shared/expedienteSignal";
import {
  Banknote,
  Check,
  Loader2,
  MapPin,
  MessageCircle,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

export type Answer = {
  fieldKey: string;
  label: string;
  value: unknown;
  formId?: number | null;
  normalizedValue?: string | null;
  deterministicResult?: string | null;
};

/**
 * Encabezado de identidad de una postulación para la decisión humana: persona,
 * plaza, contacto, ubicación declarada, expectativa salarial, punteo de IA y
 * control de estado con comentario.
 *
 * Vive en Revisión Humana, que es donde se revisa y se decide. La búsqueda de
 * Candidatos no lo monta: allí se busca y se abre la ficha.
 */
export function CandidateReviewSummary({ candidate }: { candidate: any }) {
  const utils = trpc.useUtils();
  const [nextStatus, setNextStatus] = useState(candidate.status);
  const [comment, setComment] = useState("");
  const updateStatus = trpc.candidates.setStatus.useMutation({
    onSuccess: async result => {
      setComment("");
      await Promise.all([
        utils.candidates.reviewWorkspace.invalidate(),
        utils.candidates.list.invalidate(),
        utils.candidates.detail.invalidate({ id: result.application.id }),
        utils.dashboard.summary.invalidate(),
        utils.reports.overview.invalidate(),
      ]);
      toast.success("Cambio guardado");
    },
    onError: error => toast.error(`No fue posible guardar: ${error.message}`),
  });
  const salary = salaryLabel(candidate);
  const disabled =
    updateStatus.isPending ||
    (nextStatus === candidate.status && comment.trim().length === 0);

  return (
    <section className="shrink-0 rounded-2xl border border-border/60 bg-card px-3 py-3 shadow-soft sm:px-4">
      <div className="human-review-summary-grid">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-primary sm:h-12 sm:w-12 sm:rounded-2xl">
            <UserRound className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-800 text-primary sm:text-xl">
                {candidate.full_name ?? "Postulación sin nombre"}
              </h1>
              <StatusBadge status={candidate.status} />
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                {(candidate.submissions ?? []).length} formularios
              </span>
              <Link href={`/admin/inbox?application=${candidate.id}`}>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-full border-emerald-300 text-emerald-800"
                  aria-label={`Abrir conversación de WhatsApp de ${candidate.full_name ?? "la persona"}`}
                >
                  <MessageCircle className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {candidate.position_title} · {candidate.phone_international}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span
                className="inline-flex min-w-0 items-center gap-1 text-muted-foreground"
                title="Ubicación declarada por la persona"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-700" />
                <span className="truncate">
                  {declaredLocationLabel(candidate)}
                </span>
              </span>
              <span
                className={`inline-flex min-w-0 items-center gap-1 ${salary.declared ? "font-semibold text-emerald-800" : "text-muted-foreground"}`}
                title="Expectativa de remuneración registrada únicamente con evidencia literal"
              >
                <Banknote className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{salary.text}</span>
              </span>
            </div>
            <p
              className="mt-1 max-w-full truncate text-xs text-muted-foreground"
              title={candidate.profile_summary ?? undefined}
            >
              {candidate.profile_summary ??
                "Sin nota inicial de IA registrada todavía."}
            </p>
          </div>
        </div>
        <div className="human-review-score-actions flex items-center gap-3">
          <div className="text-center">
            <p className="text-3xl font-800 tracking-tight text-primary sm:text-4xl">
              {scoreFor(candidate) ?? "—"}
              <span className="text-lg font-semibold text-muted-foreground">
                /100
              </span>
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[.16em] text-muted-foreground">
              Punteo IA
            </p>
          </div>
          {/* La señalización acompaña al punteo porque es su fecha de validez:
              un puntaje sin el estado de la revisión ni de los cambios
              posteriores no dice si sigue vigente. */}
          <ExpedienteSignalBadges
            candidate={candidate}
            className="max-w-[220px] justify-center"
            max={4}
          />
        </div>
        <div className="human-review-quick-grid min-w-0">
          <Select value={nextStatus} onValueChange={setNextStatus}>
            <SelectTrigger className="w-full min-w-0 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPLICATION_STATUS_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={comment}
            onChange={event => setComment(event.target.value)}
            placeholder="Comentario de revisión"
            maxLength={1000}
            className="w-full min-w-0 rounded-xl"
          />
          <Button
            type="button"
            disabled={disabled}
            className="w-full rounded-xl sm:w-auto"
            onClick={() =>
              updateStatus.mutate({
                id: candidate.id,
                status: nextStatus as any,
                comment: comment.trim() || undefined,
              })
            }
          >
            {updateStatus.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" /> Guardar
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = {
    neutral: "border-slate-200 bg-slate-50 text-slate-800",
    priority: "border-violet-200 bg-violet-50 text-violet-800",
    positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
    conditional: "border-sky-200 bg-sky-50 text-sky-800",
    review: "border-amber-200 bg-amber-50 text-amber-800",
    negative: "border-red-200 bg-red-50 text-red-800",
    interview: "border-cyan-200 bg-cyan-50 text-cyan-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  }[applicationStatusTone(status)];
  return (
    <Badge
      variant="outline"
      className={`rounded-full dark:border-[#2A3949] dark:bg-[#162333] dark:text-[#E6EDF3] ${tone}`}
    >
      {applicationStatusLabel(status)}
    </Badge>
  );
}

export function answersFor(candidate: any): Answer[] {
  return Array.isArray(candidate?.answers) ? candidate.answers : [];
}

export function scoreFor(candidate: any) {
  const value = candidate?.evaluation_score ?? candidate?.ai_payload?.score;
  if (
    (value === null || value === undefined) &&
    candidate?.ai_payload?.criticalDisqualification === true
  ) {
    return 0;
  }
  const score = Number(value);
  return Number.isFinite(score) ? Math.round(score) : null;
}

export function formatAnswer(answer: Answer) {
  if (answer.normalizedValue?.trim()) return answer.normalizedValue;
  const value = answer.value;
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map(String).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

/**
 * Sello de la última revisión guardada por una persona.
 *
 * Su fuente es el asiento de auditoría de la revisión —`status_changed` o
 * `comment_added` con actor identificado—, no la fecha del último cambio de la
 * postulación. Esa distinción importa: una escritura del agente o del
 * sincronizador no es una revisión humana, y presentarla como tal haría creer
 * que un expediente fue evaluado por una persona cuando nadie lo abrió.
 *
 * La zona horaria es la de la institución: la hora visible debe ser la del
 * turno que revisó, no la del navegador que consulta.
 */
export function humanReviewStamp(value: string | Date | null | undefined) {
  return institutionalStamp(value, "America/Guatemala");
}

/** Ubicación declarada: zona, municipio, departamento y país. */
export function declaredLocationLabel(candidate: any) {
  const parts = [
    candidate?.location_zone,
    candidate?.location_municipality,
    candidate?.location_department,
    candidate?.location_country,
  ].filter((value: unknown) => Boolean(String(value ?? "").trim()));
  return parts.length ? parts.join(" · ") : "Ubicación sin confirmar";
}

const SALARY_SOURCE_LABELS: Record<string, string> = {
  message: "mensaje de la persona",
  cv: "CV recibido",
  human: "registro humano",
};

/** Expectativa de remuneración: solo se muestra con evidencia literal. */
export function salaryLabel(candidate: any) {
  const amount = Number(candidate?.salary_expectation_gtq ?? 0);
  const source = String(candidate?.salary_expectation_source ?? "no_declarada");
  const declared = amount > 0 && source !== "no_declarada";
  if (!declared) {
    return { declared, text: "Expectativa salarial: no declarada" };
  }
  const formatted = new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
    minimumFractionDigits: 2,
  }).format(amount);
  return {
    declared,
    text: `Expectativa salarial: ${formatted} · ${
      SALARY_SOURCE_LABELS[source] ?? source
    }`,
  };
}
