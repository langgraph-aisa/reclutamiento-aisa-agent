import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReviewEvidencePanels } from "@/components/review/ReviewEvidencePanels";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import {
  APPLICATION_STATUS_OPTIONS,
  applicationStatusLabel,
} from "@shared/applicationStatus";

const statuses = APPLICATION_STATUS_OPTIONS;

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

      <CandidateDetail
        data={detail.data}
        onClose={() => setLocation("/admin/candidates")}
      />

      <ReviewEvidencePanels
        applicationId={applicationId}
        positionId={null}
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
  const [nextStatus, setNextStatus] = useState(data.application.status);
  const [comment, setComment] = useState("");
  const setStatus = trpc.candidates.setStatus.useMutation({
    onSuccess: async result => {
      setNextStatus(result.application.status);
      setComment("");
      await Promise.all([
        utils.candidates.detail.invalidate({ id: data.application.id }),
        utils.candidates.list.invalidate(),
      ]);
      if (result.whatsapp?.status === "sent") {
        toast.success("Estado guardado y solicitud de CV enviada por WhatsApp");
      } else if (result.whatsapp?.status === "failed") {
        toast.error(
          "Estado guardado, pero ApiChat no pudo enviar el mensaje. Puede reintentarlo."
        );
      } else if (result.whatsapp?.status === "unknown") {
        toast.warning(
          "ApiChat aceptó la solicitud, pero el resultado debe verificarse antes de otro envío."
        );
      } else {
        toast.success("Estado y comentario guardados");
      }
    },
    onError: error => {
      toast.error(`No fue posible guardar: ${error.message}`);
    },
  });
  const retryCvRequest = trpc.candidates.retryCvRequest.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.candidates.detail.invalidate({ id: data.application.id }),
        utils.candidates.list.invalidate(),
      ]);
      if (result.whatsapp.status === "sent")
        toast.success("Solicitud de CV enviada por WhatsApp");
      else if (result.whatsapp.status === "already_sent")
        toast.info("La solicitud de CV ya había sido enviada");
      else if (result.whatsapp.status === "in_progress")
        toast.info("El envío ya está siendo procesado");
      else if (result.whatsapp.status === "unknown")
        toast.warning(
          "El resultado del envío debe verificarse en WhatsApp antes de intentarlo nuevamente"
        );
      else
        toast.error(
          "ApiChat no pudo enviar el mensaje. Revise la configuración e inténtelo nuevamente."
        );
    },
    onError: error =>
      toast.error(`No fue posible reintentar: ${error.message}`),
  });
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

  useEffect(() => {
    setNextStatus(data.application.status);
  }, [data.application.id, data.application.status]);

  const save = () => {
    setStatus.mutate({
      id: data.application.id,
      status: nextStatus,
      comment: comment.trim() || undefined,
    });
  };
  return (
    <Card className="rounded-3xl border-0 bg-[#0b2d4b] text-white shadow-lift dark:bg-[#162333]">
      <CardHeader className="flex flex-row items-start justify-between">
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
        <Button
          variant="ghost"
          onClick={onClose}
          className="rounded-full text-white hover:bg-white/10 hover:text-white"
        >
          Cerrar
        </Button>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl bg-white/8 p-4">
            <p className="text-xs uppercase tracking-[.14em] text-white/55">
              Resumen de perfil
            </p>
            <p className="mt-3 text-sm leading-6 text-white/80">
              {data.application.profile_summary ?? "Sin resumen todavía."}
            </p>
          </div>
          <div className="rounded-2xl bg-white/8 p-4">
            <p className="text-xs uppercase tracking-[.14em] text-white/55">
              Motivo de evaluación
            </p>
            <p className="mt-3 text-sm leading-6 text-white/80">
              {data.application.evaluation_reason ?? "Pendiente de evaluación."}
            </p>
          </div>
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
        </div>
        <div className="rounded-2xl bg-card p-5 text-card-foreground shadow-sm">
          <p className="text-sm font-semibold">Cambio humano</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Al seleccionar “Solicitar CV por WhatsApp”, Talento AISA solicitará
            el CV directamente por ApiChat, una sola vez por postulación.
          </p>
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Estado registrado: {statusLabel(data.application.status)}
            </p>
            <Select
              value={nextStatus}
              onValueChange={value => {
                setNextStatus(value);
                setStatus.reset();
              }}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={comment}
              onChange={e => {
                setComment(e.target.value);
                setStatus.reset();
              }}
              placeholder="Comentario opcional"
              className="rounded-xl"
            />
            <Button
              onClick={save}
              disabled={setStatus.isPending}
              className="w-full rounded-xl"
            >
              {setStatus.isPending ? "Guardando…" : "Guardar cambio"}
            </Button>
            {setStatus.isSuccess && (
              <p
                className="text-xs font-semibold text-emerald-700"
                aria-live="polite"
              >
                Cambio confirmado en PostgreSQL.
              </p>
            )}
            {setStatus.error && (
              <p
                className="flex items-start gap-2 text-xs font-semibold text-red-700"
                role="alert"
              >
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {setStatus.error.message}
              </p>
            )}
            {data.application.status === "calificado" &&
              data.application.whatsapp_status !== "enviado" && (
                <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
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
                  {data.application.whatsapp_status === "desconocido" ? (
                    <p className="mt-2 font-semibold">
                      Verifique la conversación de la persona postulante antes
                      de realizar otro envío.
                    </p>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        retryCvRequest.mutate({ id: data.application.id })
                      }
                      disabled={retryCvRequest.isPending}
                      className="mt-3 w-full rounded-xl"
                    >
                      <RefreshCw
                        className={`mr-2 h-3.5 w-3.5 ${retryCvRequest.isPending ? "animate-spin" : ""}`}
                      />
                      {retryCvRequest.isPending
                        ? "Enviando…"
                        : data.application.whatsapp_status === "error"
                          ? "Reintentar solicitud de CV"
                          : "Enviar solicitud de CV"}
                    </Button>
                  )}
                </div>
              )}
          </div>
        </div>
        {typeof agentPayload?.score === "number" && (
          <div className="lg:col-span-2 rounded-2xl bg-white/8 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs uppercase tracking-[.14em] text-white/55">
                  Matriz de evaluación IA
                </p>
                <p className="mt-2 text-sm text-white/70">
                  {agentPayload.classification ?? "Resultado ponderado"} ·{" "}
                  {latestEvaluation.ai_model ?? "Modelo no informado"}
                </p>
              </div>
              <p className="text-3xl font-bold text-white">
                {agentPayload.score}
                <span className="text-base font-medium text-white/55">
                  /100
                </span>
              </p>
            </div>
            {Array.isArray(agentPayload.blocks) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {agentPayload.blocks.map((block: any) => (
                  <div key={block.id} className="rounded-xl bg-white/6 p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-semibold text-white/80">
                        {evaluationBlockLabel(block.id)}
                      </span>
                      <span className="text-white/60">
                        {Math.round(block.score)}/100
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-emerald-300"
                        style={{
                          width: `${Math.max(0, Math.min(100, Number(block.score) || 0))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/55">
                      {block.rationale}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="lg:col-span-2 rounded-2xl bg-white/8 p-4">
          <p className="text-xs uppercase tracking-[.14em] text-white/55">
            Formularios y anuncios · respuestas
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
        </div>
        <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white/8 p-4">
            <p className="text-xs uppercase tracking-[.14em] text-white/55">
              Conversación WhatsApp
            </p>
            {data.messages?.length ? (
              <div className="mt-3 space-y-2">
                {data.messages.slice(-5).map((message: any) => (
                  <div
                    key={message.id}
                    className="rounded-xl bg-white/6 p-3 text-sm text-white/80"
                  >
                    <span className="mr-2 text-xs text-white/45">
                      {message.direction === "outbound"
                        ? message.delivery_status === "failed"
                          ? "Fallido"
                          : message.delivery_status === "unknown"
                            ? "Por confirmar"
                            : message.delivery_status === "pending" ||
                                message.delivery_status === "sending"
                              ? "Pendiente"
                              : "Enviado"
                        : "Recibido"}
                    </span>
                    {message.body ?? "Mensaje sin texto"}
                    {message.last_error && (
                      <p className="mt-2 text-xs text-red-200">
                        {message.last_error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/60">
                Aún no hay mensajes asociados.
              </p>
            )}
          </div>
          <div className="rounded-2xl bg-white/8 p-4">
            <p className="text-xs uppercase tracking-[.14em] text-white/55">
              Bitácora
            </p>
            {data.audit?.length ? (
              <div className="mt-3 space-y-2">
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
              <p className="mt-3 text-sm text-white/60">
                Sin cambios registrados.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function statusLabel(value: string | null | undefined) {
  return applicationStatusLabel(value);
}
function evaluationBlockLabel(value: string) {
  const labels: Record<string, string> = {
    identificacion_ajuste: "Identificación del ajuste",
    evidencia_experiencia: "Evidencia de experiencia",
    competencias: "Competencias técnicas/comerciales",
    disponibilidad_logistica: "Disponibilidad y logística",
    riesgos_brechas: "Riesgos o brechas",
    dictamen_ia: "Dictamen IA",
  };
  return labels[value] ?? value;
}
