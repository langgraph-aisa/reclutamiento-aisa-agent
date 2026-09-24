import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CandidateReviewSummary } from "@/components/review/CandidateReviewSummary";
import { RecruiterAgentPanel } from "@/components/review/RecruiterAgentPanel";
import { CandidateCvAnalysisPanel } from "@/components/review/CandidateCvAnalysisPanel";
import { CandidateViewerPanel } from "@/components/review/CandidateViewerPanel";
import { CollapsibleSection } from "@/components/review/CollapsibleSection";
import {
  CandidateConversationFeed,
  CandidatePersonalKnowledgePanel,
} from "@/components/review/ReviewEvidencePanels";
import { AgentAiLogPanel } from "@/components/review/AgentAiLogPanel";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { applicationStatusLabel } from "@shared/applicationStatus";

/**
 * Revisión Humana: ficha completa de una postulación.
 * La búsqueda vive en /admin/candidates y abre esta hoja con
 * ?application=<id>. Aquí se concentran la matriz de evaluación IA, el
 * motivo, el resumen de perfil, las respuestas de formularios y los
 * expedientes de conocimiento y conversación del candidato.
 */
export default function HumanReview() {
  const locationSearch = useSearch();
  const [, setLocation] = useLocation();
  const requestedApplicationId = (() => {
    const parsed = Number(
      new URLSearchParams(locationSearch).get("application")
    );
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  })();
  const detail = trpc.candidates.detail.useQuery(
    { id: requestedApplicationId ?? 0 },
    { enabled: Boolean(requestedApplicationId) }
  );
  const workspace = trpc.candidates.reviewWorkspace.useQuery(
    { applicationId: requestedApplicationId ?? 0 },
    { enabled: Boolean(requestedApplicationId) }
  );

  if (!requestedApplicationId) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
            Decisión humana
          </p>
          <h1 className="mt-2 text-4xl font-800 tracking-[-.04em] text-primary">
            Revisión Humana
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            La ficha se abre desde la búsqueda de Candidatos con el botón
            «Detalle».
          </p>
        </header>
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Seleccione una postulación en Candidatos para revisar su matriz de
              evaluación, su motivo, su expediente documental y su conversación
              de WhatsApp.
            </p>
            <Button
              className="rounded-full"
              onClick={() => setLocation("/admin/candidates")}
            >
              Ir a la búsqueda de Candidatos
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (detail.isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparando la ficha del candidato
        </span>
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-4 pb-10">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => setLocation("/admin/candidates")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Candidatos
        </Button>
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            No fue posible cargar la postulación solicitada.
          </CardContent>
        </Card>
      </div>
    );
  }

  const applicationId = detail.data.application.id;
  const workspaceRow = workspace.data?.[0];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => setLocation("/admin/candidates")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Candidatos
        </Button>
        <p className="text-xs text-muted-foreground">
          Ficha de evaluación · postulación No. {applicationId}
        </p>
      </div>

      {workspaceRow ? (
        <CandidateReviewSummary candidate={workspaceRow} />
      ) : null}

      {/* El feed de WhatsApp va inmediatamente después del encabezado de
          identidad: es el contexto de la persona antes de leer su matriz. */}
      <CandidateConversationFeed
        applicationId={applicationId}
        candidateName={detail.data.application.full_name ?? null}
      />

      {/* La bitácora de la IA va justo debajo de la conversación: es la traza
          de las etapas del agente, con la acción y su justificación, para
          auditar si el flujo determinista se cumplió en el orden administrado. */}
      <AgentAiLogPanel
        applicationId={applicationId}
        candidateName={detail.data.application.full_name ?? null}
      />

      {/* El detalle de la postulación conserva la matriz de evaluación arriba y
          los cinco bloques de lectura plegados debajo. */}
      <CandidateDetail
        data={detail.data}
        onClose={() => setLocation("/admin/candidates")}
      />

      {/* El agente se lee después del detalle: analiza **este** expediente y no
          otro, y su respuesta se apoya en lo que se acaba de leer. */}
      <RecruiterAgentPanel applicationId={applicationId} />

      {/* El RAG Personal cierra la hoja: es el conocimiento que la conversación
          y el agente alimentan, y el que sostiene ambos. */}
      <CandidatePersonalKnowledgePanel
        applicationId={applicationId}
        candidateName={detail.data.application.full_name ?? null}
      />
    </div>
  );
}

function CandidateDetail({
  data,
  onClose,
}: {
  data: any;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const latestEvaluation = data.evaluations?.[0];
  const agentPayload = latestEvaluation?.ai_payload;
  const evaluateWithAgent = trpc.agent.evaluateApplication.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.candidates.detail.invalidate({ id: data.application.id }),
        utils.candidates.list.invalidate(),
      ]);
      toast.success(
        `Evaluación completada: ${result.classification} (${result.score}/100)`
      );
    },
    onError: error => toast.error(`No fue posible evaluar: ${error.message}`),
  });

  // La prueba psicométrica ya no es un flujo determinista: se activa y apaga
  // únicamente desde la ficha, y exige que el candidato haya concluido las
  // nueve etapas de la IA.
  const assessmentCycle = trpc.assessments.applicationCycle.useQuery(
    { applicationId: data.application.id },
    { enabled: Boolean(data.application.id) }
  );
  const cycle = assessmentCycle.data?.cycle ?? null;
  const cycleEnabled = Boolean(cycle && cycle.state !== "concluido");
  const toggleAssessment =
    trpc.assessments.toggleForApplication.useMutation({
      onSuccess: async () => {
        toast.success(
          cycleEnabled
            ? "Prueba psicométrica desactivada."
            : "Prueba psicométrica activada para el candidato."
        );
        await assessmentCycle.refetch();
      },
      onError: error => toast.error(error.message),
    });

  return (
    <Card className="rounded-3xl border-0 bg-[#0b2d4b] text-white shadow-lift dark:bg-[#162333]">
      <CardHeader className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
        <div>
          <Badge className="rounded-full bg-emerald-200 text-emerald-950 hover:bg-emerald-200">
            Detalle de postulación
          </Badge>
          <CardTitle className="mt-4 text-2xl text-white">
            {data.application.full_name ?? "Sin nombre"}
          </CardTitle>
          <p className="mt-1 text-sm text-white/65">
            {data.application.position_title} ·{" "}
            {data.application.phone_international}
          </p>
        </div>
        {/* La re-evaluación se decide en el encabezado, sobre la identidad del
            expediente: es una acción sobre la postulación completa y no sobre
            un bloque de lectura. */}
        <div className="flex flex-col gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            className="self-end rounded-full text-white hover:bg-white/10 hover:text-white"
          >
            Cerrar
          </Button>
          <Button
            variant="outline"
            className="w-full rounded-xl border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            disabled={evaluateWithAgent.isPending}
            onClick={() =>
              evaluateWithAgent.mutate({ applicationId: data.application.id })
            }
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${evaluateWithAgent.isPending ? "animate-spin" : ""}`}
            />
            {evaluateWithAgent.isPending
              ? "Evaluando postulación…"
              : data.evaluations?.length
                ? "Reevaluar con agente IA"
                : "Evaluar con agente IA"}
          </Button>
          <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
            <Label className="text-sm font-medium text-white">
              Prueba psicométrica
            </Label>
            <Switch
              checked={cycleEnabled}
              disabled={
                toggleAssessment.isPending || assessmentCycle.isLoading
              }
              onCheckedChange={value =>
                toggleAssessment.mutate({
                  applicationId: data.application.id,
                  enabled: value,
                })
              }
              aria-label="Activar la prueba psicométrica del candidato"
            />
          </div>
          {!assessmentCycle.data?.stagesCompleted && (
            <p className="text-xs leading-5 text-white/65">
              Solo puede activarse cuando el candidato concluye las nueve
              etapas de la IA.
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <CandidateViewerPanel
          candidate={{
            id: data.application.id,
            position_title: data.application.position_title,
            profile_summary: data.application.profile_summary,
            submitted_at: data.application.submitted_at,
            evaluation_reason: data.application.evaluation_reason,
            classification: agentPayload?.classification ?? null,
            ai_model: latestEvaluation?.ai_model ?? null,
            ai_payload: agentPayload ?? null,
          }}
        />
        {/* Los cinco bloques de lectura comparten una grilla de dos columnas y
            las mismas barras plegables: la matriz de evaluación queda a la
            vista y el detalle se despliega solo cuando se necesita. */}
        <div className="grid gap-5 lg:grid-cols-2">
          <CollapsibleSection id="resumen-perfil" title="Resumen de perfil">
            <p className="text-sm leading-6 text-white/80">
              {data.application.profile_summary ?? "Sin resumen todavía."}
            </p>
          </CollapsibleSection>
          <CollapsibleSection id="bitacora" title="Bitácora">
            {data.audit?.length ? (
              <div className="space-y-2">
                {data.audit.slice(0, 5).map((event: any) => (
                  <div key={event.id} className="rounded-xl bg-white/6 p-3">
                    <p className="text-sm font-semibold text-white/85">
                      {event.action === "comment_added"
                        ? "Comentario agregado"
                        : "Estado actualizado"}
                    </p>
                    {event.before_json?.status !== event.after_json?.status && (
                      <p className="mt-1 text-xs text-white/65">
                        {statusLabel(event.before_json?.status)} →{" "}
                        {statusLabel(event.after_json?.status)}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-white/80">
                      {event.comment || "Sin comentario"}
                    </p>
                    <p className="mt-1 text-xs text-white/50">
                      {event.actor_name ?? "Sistema"}
                      {event.created_at
                        ? ` · ${new Date(event.created_at).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/60">
                Sin cambios registrados.
              </p>
            )}
            {data.application.status === "calificado" &&
              data.application.whatsapp_status !== "enviado" && (
                <div className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">
                    WhatsApp:{" "}
                    {data.application.whatsapp_status === "error"
                      ? "envío fallido"
                      : data.application.whatsapp_status === "pendiente"
                        ? "pendiente"
                        : data.application.whatsapp_status === "desconocido"
                          ? "por confirmar"
                          : "no enviado"}
                  </p>
                  {data.application.last_whatsapp_error && (
                    <p className="mt-1 leading-5">
                      {data.application.last_whatsapp_error}
                    </p>
                  )}
                  <p className="mt-2 leading-5">
                    La solicitud del currículum es exclusiva de la etapa
                    «Solicitud del currículum» del ciclo del agente: no se
                    despacha desde la revisión humana.
                  </p>
                </div>
              )}
          </CollapsibleSection>
          <CollapsibleSection id="motivo-evaluacion" title="Motivo de evaluación">
            <p className="text-sm leading-6 text-white/80">
              {data.application.evaluation_reason ?? "Pendiente de evaluación."}
            </p>
          </CollapsibleSection>
          <CollapsibleSection id="analisis-cv" title="Análisis de CV de Agente IA">
            <CandidateCvAnalysisPanel
              applicationId={data.application.id}
              reevaluating={evaluateWithAgent.isPending}
              onReevaluate={() =>
                evaluateWithAgent.mutate({ applicationId: data.application.id })
              }
            />
          </CollapsibleSection>
          <CollapsibleSection
            id="formularios-respuestas"
            title="Formularios y anuncios · respuestas"
          >
            <div className="grid gap-3 sm:grid-cols-2">
            {(data.submissions ?? []).map((submission: any) => {
              const formAnswers = (data.answers ?? []).filter(
                (answer: any) =>
                  Number(answer.form_id) === Number(submission.form_id)
              );
              return (
                <div
                  key={submission.form_id}
                  className="rounded-xl bg-white/6 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-white/80">
                      {submission.title}
                    </p>
                    <Badge className="shrink-0 rounded-full bg-sky-100 text-sky-800">
                      {submission.source === "importado"
                        ? "Importado"
                        : "Anuncio"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-white/45">
                    Formulario No. {submission.version} ·{" "}
                    {formAnswers.length}{" "}
                    {formAnswers.length === 1 ? "respuesta" : "respuestas"}
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    {submission.submitted_at
                      ? new Date(
                          submission.submitted_at
                        ).toLocaleString("es-GT")
                      : ""}
                  </p>
                  <div className="mt-2 space-y-1">
                    {formAnswers.length ? (
                      formAnswers.map((answer: any) => (
                        <p
                          key={answer.field_key}
                          className="text-xs leading-5 text-white/80"
                        >
                          <span className="text-white/45">
                            {answer.label}:{" "}
                          </span>
                          {String(
                            answer.normalized_value ??
                              answer.value_json ??
                              "—"
                          )}
                        </p>
                      ))
                    ) : (
                      <p className="text-xs text-white/45">
                        Sin respuestas registradas.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {!(data.submissions ?? []).length && (
              <p className="text-sm text-white/60 sm:col-span-2">
                {data.answers?.length
                  ? "El formulario de origen no registra participación."
                  : "Sin respuestas registradas."}
              </p>
            )}
          </div>
          </CollapsibleSection>
        </div>
      </CardContent>
    </Card>
  );
}

function statusLabel(value: string | null | undefined) {
  return applicationStatusLabel(value);
}
