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
import { trpc } from "@/lib/trpc";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  MessageCircle,
  RefreshCw,
  Search,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";
import {
  APPLICATION_STATUS_OPTIONS,
  applicationStatusLabel,
  applicationStatusTone,
} from "@shared/applicationStatus";

const statuses = APPLICATION_STATUS_OPTIONS;

export default function Candidates() {
  const locationSearch = useSearch();
  const [status, setStatus] = useState("all");
  const [positionId, setPositionId] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const positions = trpc.positions.list.useQuery();
  const query = trpc.candidates.list.useQuery({
    status: status === "all" ? undefined : (status as any),
    positionId: positionId === "all" ? undefined : Number(positionId),
    search: search || undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const detail = trpc.candidates.detail.useQuery(
    { id: selected! },
    { enabled: Boolean(selected) }
  );
  const candidates = query.data ?? [];
  useEffect(() => {
    const requested = Number(
      new URLSearchParams(locationSearch).get("application")
    );
    if (Number.isSafeInteger(requested) && requested > 0)
      setSelected(requested);
  }, [locationSearch]);
  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
            Seguimiento
          </p>
          <h1 className="mt-2 text-4xl font-800 tracking-[-.04em] text-primary">
            Candidatos
          </h1>
          <p className="mt-2 text-muted-foreground">
            Revisa respuestas, decisiones y el siguiente paso de cada
            postulación.
          </p>
        </div>
        <Badge variant="outline" className="w-fit rounded-full">
          <UsersRound className="mr-2 h-3.5 w-3.5" /> {candidates.length}{" "}
          visibles
        </Badge>
      </div>
      <Card className="rounded-3xl border-0 shadow-soft">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-2xl pl-10"
              placeholder="Nombre, teléfono o plaza"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full rounded-2xl">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {statuses.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select value={positionId} onValueChange={setPositionId}>
            <SelectTrigger className="w-full rounded-2xl">
              <SelectValue placeholder="Plaza" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las plazas</SelectItem>
              {(positions.data ?? []).map((position: any) => (
                <SelectItem key={position.id} value={String(position.id)}>
                  {position.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="rounded-2xl"
            aria-label="Desde"
          />
          <Input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="rounded-2xl"
            aria-label="Hasta"
          />
        </CardContent>
      </Card>
      {selected && detail.data ? (
        <CandidateDetail data={detail.data} onClose={() => setSelected(null)} />
      ) : candidates.length === 0 ? (
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-sky-50 text-sky-700">
              <UserRound className="h-6 w-6" />
            </div>
            <h2 className="mt-5 text-xl font-800 text-primary">
              No hay candidatos para este filtro
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Las postulaciones enviadas aparecerán aquí con su resultado,
              motivo de evaluación y resumen de perfil.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardHeader>
            <CardTitle className="text-xl text-primary">
              Bandeja de postulaciones
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {candidates.map((candidate: any) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                onOpen={() => setSelected(candidate.id)}
              />
            ))}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <InfoCard
          icon={MessageCircle}
          label="Solicitud de CV"
          text="Se envía una vez al calificar"
        />
        <InfoCard
          icon={CheckCircle2}
          label="Trazabilidad"
          text="Cada cambio queda registrado"
        />
        <InfoCard
          icon={ArrowUpRight}
          label="Siguiente fase"
          text="WhatsApp parametrizado"
        />
      </div>
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
          "Estado guardado, pero ApiChat no pudo enviar el mensaje. Puedes reintentarlo."
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
          "ApiChat no pudo enviar el mensaje. Revisa la configuración e inténtalo nuevamente."
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
    <Card className="rounded-3xl border-0 bg-primary text-white shadow-lift">
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
        <div className="rounded-2xl bg-white p-5 text-primary">
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
                      Verifica la conversación del postulante antes de realizar
                      otro envío.
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
            Respuestas
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {data.answers.map((answer: any) => (
              <div key={answer.field_key} className="rounded-xl bg-white/6 p-3">
                <p className="text-xs text-white/50">{answer.label}</p>
                <p className="mt-1 text-sm text-white/85">
                  {String(answer.normalized_value ?? answer.value_json ?? "—")}
                </p>
              </div>
            ))}
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
function CandidateRow({
  candidate,
  onOpen,
}: {
  candidate: any;
  onOpen: () => void;
}) {
  const status =
    statuses.find(item => item.value === candidate.status) ?? statuses[0];
  const tone = {
    neutral: "bg-slate-100 text-slate-800",
    priority: "bg-violet-100 text-violet-800",
    positive: "bg-emerald-100 text-emerald-800",
    conditional: "bg-sky-100 text-sky-800",
    review: "bg-amber-100 text-amber-800",
    negative: "bg-red-100 text-red-800",
    interview: "bg-cyan-100 text-cyan-800",
    error: "bg-rose-100 text-rose-800",
  }[applicationStatusTone(candidate.status)];
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/8 text-primary">
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-primary">
            {candidate.full_name ?? "Sin nombre"}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {candidate.position_title} · {candidate.phone_international}
          </p>
          <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
            {candidate.evaluation_reason ?? "Evaluación pendiente"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge className={`rounded-full ${tone}`}>{status.label}</Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpen}
          className="rounded-full"
        >
          <Eye className="mr-2 h-3.5 w-3.5" /> Detalle
        </Button>
      </div>
    </div>
  );
}
function InfoCard({
  icon: Icon,
  label,
  text,
}: {
  icon: typeof Clock3;
  label: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <Icon className="h-5 w-5 text-emerald-700" />
      <p className="mt-4 text-sm font-semibold text-primary">{label}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}
