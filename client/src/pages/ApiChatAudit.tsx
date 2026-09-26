import { Badge } from "@/components/ui/badge";
import { ApiChatPlatformCredentialCard } from "@/components/ApiChatPlatformCredentialCard";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, HelpCircle, Inbox, Send } from "lucide-react";

/**
 * Auditoría del canal de ApiChat.
 *
 * Consolida, en una sola lectura, lo que hoy está disperso: las pérdidas de
 * recepción asentadas por el webhook, los fallos de entrega de la cola y las
 * entregas detenidas. El **informe** es solo lectura: su función es que el
 * fallo del conducto deje de ser invisible, no corregirlo desde aquí. Las dos
 * escrituras de la hoja están declaradas y acotadas: la recuperación del
 * adjunto conservado, que restituye trabajo a la cola, y la credencial de
 * plataforma, que es la pieza cuyo estado explica los fallos que aquí se miden.
 *
 * La clasificación distingue tres cosas que no son la misma: lo **verificado**,
 * lo que tiene **pérdidas** y lo que **no tiene evidencia** —porque la falta de
 * pérdidas sin recepciones no es salud, es una incógnita—.
 */
const STATE_LABELS: Record<string, string> = {
  verificado: "Conducto verificado",
  con_perdidas: "Con pérdidas",
  con_fallos_de_envio: "Con fallos de envío",
  sin_evidencia: "Sin evidencia",
  observabilidad_no_disponible: "Observación no disponible",
  recepcion_no_confirmada: "Recepción sin confirmar",
  procesamiento_detenido: "Procesamiento detenido",
  derivacion_fallida: "Derivación fallida",
  derivacion_requerida: "Derivación requerida",
  ingreso_rechazado: "Ingreso rechazado",
  sin_actividad: "Sin actividad en la ventana",
  sin_pendientes: "Sin pendientes",
};

const STATE_CLASSES: Record<string, string> = {
  verificado: "border-emerald-300 bg-emerald-100 text-emerald-900",
  sin_pendientes: "border-emerald-300 bg-emerald-100 text-emerald-900",
  con_perdidas: "border-rose-300 bg-rose-100 text-rose-900",
  recepcion_no_confirmada: "border-rose-300 bg-rose-100 text-rose-900",
  observabilidad_no_disponible: "border-rose-300 bg-rose-100 text-rose-900",
  con_fallos_de_envio: "border-amber-300 bg-amber-100 text-amber-950",
  procesamiento_detenido: "border-amber-300 bg-amber-100 text-amber-950",
  derivacion_fallida: "border-amber-300 bg-amber-100 text-amber-950",
  derivacion_requerida: "border-sky-300 bg-sky-100 text-sky-900",
  ingreso_rechazado: "border-slate-300 bg-slate-100 text-slate-700",
  sin_evidencia: "border-slate-300 bg-slate-100 text-slate-700",
  sin_actividad: "border-slate-300 bg-slate-100 text-slate-700",
};

const STATE_ICONS: Record<string, typeof CheckCircle2> = {
  verificado: CheckCircle2,
  sin_pendientes: CheckCircle2,
  con_perdidas: AlertTriangle,
  recepcion_no_confirmada: AlertTriangle,
  observabilidad_no_disponible: AlertTriangle,
  con_fallos_de_envio: AlertTriangle,
  procesamiento_detenido: AlertTriangle,
  derivacion_fallida: AlertTriangle,
  derivacion_requerida: HelpCircle,
  ingreso_rechazado: HelpCircle,
  sin_evidencia: HelpCircle,
  sin_actividad: HelpCircle,
};

function formatMoment(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function ApiChatAudit() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const recover = trpc.config.recoverApiChatAttachments.useMutation({
    onSuccess: async () => {
      // La recuperación mueve la cola: releer es parte de la operación, no un
      // adorno. Un veredicto sin la lectura posterior describiría la intención.
      await Promise.all([
        utils.apiChatAudit.pipeline.invalidate(),
        utils.apiChatAudit.report.invalidate(),
      ]);
    },
  });
  const report = trpc.apiChatAudit.report.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const pipeline = trpc.apiChatAudit.pipeline.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const summary = report.data?.summary;
  const StateIcon = STATE_ICONS[summary?.state ?? "sin_evidencia"] ?? HelpCircle;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[.14em] text-muted-foreground">
          Comunicación operativa
        </p>
        <h1 className="mt-1 text-2xl font-bold text-primary">
          Auditoría de ApiChat
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Errores del mecanismo de comunicación: pérdidas de recepción, fallos
          de entrega y entregas detenidas. El informe es de solo lectura y la
          credencial de plataforma se administra aquí.
        </p>
      </div>

      <ApiChatPlatformCredentialCard />

      {report.isLoading ? (
        <p className="text-sm text-muted-foreground">Leyendo el canal…</p>
      ) : null}

      {summary ? (
        <>
          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StateIcon className="h-4 w-4 text-primary" aria-hidden="true" />
              <Badge
                variant="outline"
                className={`rounded-full text-[10px] ${STATE_CLASSES[summary.state] ?? ""}`}
              >
                {STATE_LABELS[summary.state] ?? summary.state}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                ventana de {report.data?.windowHours} horas
              </span>
            </div>
            <p className="mt-2 text-sm leading-6">{summary.verdict}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Recibidos
                </p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-lg font-semibold">
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                  {summary.inboundReceived}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Pérdidas de recepción
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {summary.inboundLosses}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Fallos de envío
                </p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-lg font-semibold">
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {summary.outboundFailures}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Entregas detenidas
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {summary.stuckDeliveries}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              Pérdidas de recepción por causa
            </h2>
            {(report.data?.losses ?? []).length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {(report.data?.losses ?? []).map(loss => (
                  <li key={loss.cause} className="flex flex-wrap gap-2">
                    <span className="font-mono">{loss.cause}</span>
                    <span className="text-muted-foreground">
                      {loss.total} · última {formatMoment(loss.lastAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Sin pérdidas asentadas en la ventana.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              Fallos de entrega
            </h2>
            {(report.data?.failures ?? []).length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Fecha</th>
                      <th className="py-1 pr-3">Tipo</th>
                      <th className="py-1 pr-3">Archivo</th>
                      <th className="py-1 pr-3">Intentos</th>
                      <th className="py-1">Detalle del proveedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.data?.failures ?? []).map(failure => (
                      <tr key={failure.id} className="border-t border-border/60">
                        <td className="py-1 pr-3">{formatMoment(failure.at)}</td>
                        <td className="py-1 pr-3">{failure.messageType}</td>
                        <td className="py-1 pr-3">{failure.fileName ?? "—"}</td>
                        <td className="py-1 pr-3">{failure.attempts}</td>
                        <td className="py-1">
                          {failure.lastError ?? "sin detalle del proveedor"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Ningún envío quedó sin confirmar en la ventana.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              CONDUCTO DEL ADJUNTO · RECEPCIÓN, DERIVACIÓN Y EVALUACIÓN
            </h2>
            <p className="mt-1 text-xs leading-5">
              {pipeline.data?.summary.verdict ??
                "Sin lectura del conducto de adjuntos."}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={`rounded-full text-[10px] ${
                  STATE_CLASSES[pipeline.data?.summary.state ?? "sin_evidencia"] ??
                  ""
                }`}
              >
                {STATE_LABELS[pipeline.data?.summary.state ?? "sin_evidencia"] ??
                  pipeline.data?.summary.state}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                ventana de {pipeline.data?.windowHours} horas
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Notificaciones recibidas
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {pipeline.data?.summary.receiptsReceived ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Sin resolver
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {pipeline.data?.summary.receiptsOpen ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Intentos agotados
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {pipeline.data?.summary.receiptsDead ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Documentos sin análisis
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {(pipeline.data?.summary.documentsPending ?? 0) +
                    (pipeline.data?.summary.documentsFailed ?? 0)}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              NOTIFICACIONES SIN RESOLVER
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              El motivo de cada fallo consta aquí y no en la conducta del
              candidato: un archivo que no llegó a la bandeja es un hecho del
              transporte.
            </p>
            {(pipeline.data?.receipts ?? []).length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Recibida</th>
                      <th className="py-1 pr-3">Vía</th>
                      <th className="py-1 pr-3">Estado</th>
                      <th className="py-1 pr-3">Intentos</th>
                      <th className="py-1 pr-3">Desenlace</th>
                      <th className="py-1">Diagnóstico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pipeline.data?.receipts ?? []).map(receipt => (
                      <tr
                        key={receipt.receiptKey}
                        className="border-t border-border/60"
                      >
                        <td className="py-1 pr-3">
                          {formatMoment(receipt.receivedAt)}
                        </td>
                        <td className="py-1 pr-3">{receipt.origin}</td>
                        <td className="py-1 pr-3">{receipt.status}</td>
                        <td className="py-1 pr-3">{receipt.attempts}</td>
                        <td className="py-1 pr-3">
                          {receipt.outcome ?? "sin desenlace"}
                        </td>
                        <td className="py-1">
                          {receipt.lastError ?? "sin error registrado"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Ninguna notificación quedó sin resolver en la ventana.
                La cola vacía no demuestra que el proveedor no llamó: sólo
                afirma que no hay trabajo pendiente en este período.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              TRABAJOS DOCUMENTALES ABIERTOS
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Un archivo conservado con su trabajo en cola está recibido, no
              interpretado. La distinción importa: la ausencia de texto derivado
              no autoriza a declarar que el candidato no envió nada.
            </p>
            {(pipeline.data?.jobs ?? []).length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Postulación</th>
                      <th className="py-1 pr-3">Archivo</th>
                      <th className="py-1 pr-3">Formato</th>
                      <th className="py-1 pr-3">Trabajo</th>
                      <th className="py-1 pr-3">Análisis</th>
                      <th className="py-1">Causa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pipeline.data?.jobs ?? []).map(job => (
                      <tr key={job.fileId} className="border-t border-border/60">
                        <td className="py-1 pr-3">{job.applicationId}</td>
                        <td className="py-1 pr-3">{job.originalName}</td>
                        <td className="py-1 pr-3">{job.extension}</td>
                        <td className="py-1 pr-3">
                          {job.state} · {job.attempts}
                        </td>
                        <td className="py-1 pr-3">{job.analysisStatus}</td>
                        <td className="py-1">
                          {job.lastErrorCode ??
                            job.processingErrorCode ??
                            "sin causa registrada"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Sin trabajos documentales abiertos en la ventana.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              DOCUMENTOS POR DESENLACE
            </h2>
            {(pipeline.data?.documentsByError ?? []).length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {(pipeline.data?.documentsByError ?? []).map(row => (
                  <li
                    key={`${row.analysisStatus}-${row.processingErrorCode ?? "ok"}`}
                    className="flex flex-wrap gap-2"
                  >
                    <span className="font-mono">{row.analysisStatus}</span>
                    <span className="text-muted-foreground">
                      {row.total} · {row.processingErrorCode ?? "sin error"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Sin documentos registrados en la ventana.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              ADJUNTOS RECIBIDOS Y NO INGRESADOS
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Un archivo que consta en la bandeja y no entró al expediente es un
              rechazo declarado, no una ausencia. Omitirlo permitía afirmar que
              la ventana cerraba sin pendientes con un adjunto fuera del
              expediente.
            </p>
            {(pipeline.data?.refusedAttachments ?? []).length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {(pipeline.data?.refusedAttachments ?? []).map(row => (
                  <li key={row.reason} className="flex flex-wrap gap-2">
                    <span className="font-mono">{row.reason}</span>
                    <span className="text-muted-foreground">{row.total}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Ningún adjunto recibido quedó fuera del expediente en la ventana.
              </p>
            )}
            {(pipeline.data?.summary.receiptsNotMessage ?? 0) > 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {pipeline.data?.summary.receiptsNotMessage} notificación(es) de
                estado o de conversación quedaron excluidas de los rechazos: el
                contrato las declara distintas de la de mensajes y contarlas con
                ellas ocultaba las pérdidas reales entre notificaciones legítimas.
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              RECUPERACIÓN DEL ADJUNTO CONSERVADO
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              La notificación que agotó sus intentos está conservada en la cola,
              de modo que la pérdida es recuperable sin pedir un reenvío al
              candidato. La operación declara qué puede recuperar cada vía: el
              reproceso reproduce la carga conservada y la relectura del historial
              rescata las notificaciones que nunca llegaron a tener recibo.
            </p>
            {user?.role === "admin" ? (
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  disabled={recover.isPending}
                  onClick={() => recover.mutate()}
                  className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50"
                >
                  {recover.isPending
                    ? "Ejecutando la recuperación…"
                    : "Recuperar adjuntos conservados"}
                </button>
                {recover.data ? (
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    {recover.data.verdict}
                  </p>
                ) : null}
                {recover.error ? (
                  <p className="text-[11px] leading-5 text-rose-700">
                    {recover.error.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                La recuperación exige rol de administración. La operación
                restituye el trabajo a la cola y rebobina el cursor del
                historial, de modo que lo recibido y no convertido vuelve a
                intentarse sin exigir al candidato un envío nuevo.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              TRAZA DEL CONDUCTO · FORMA DEL CUERPO RECIBIDO
            </h2>
            <p className="mt-1 text-xs leading-5">
              {report.data?.transport.summary.verdict}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Registra la forma de cada petición —claves, tipos y tamaños— y un
              cuerpo redactado. No conserva contenido del candidato: los campos
              de archivo se sustituyen por su peso y su huella.
            </p>
            {(report.data?.transport.traces ?? []).length ? (
              <ul className="mt-3 space-y-2">
                {(report.data?.transport.traces ?? []).map((trace, index) => (
                  <li
                    key={`${trace.origin}-${trace.eventId ?? index}-${index}`}
                    className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs"
                  >
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {formatMoment(trace.at)} · {trace.origin} ·{" "}
                      {trace.outcome}
                      {trace.providerType ? ` · tipo ${trace.providerType}` : ""}
                      {trace.eventId ? ` · id ${trace.eventId}` : ""} ·{" "}
                      {trace.payloadBytes} bytes
                    </p>
                    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {Object.entries(trace.shape ?? {}).map(([key, field]) => (
                        <div key={key} className="flex gap-1">
                          <dt className="font-mono text-[10px] text-primary">
                            {key}
                          </dt>
                          <dd className="text-[10px] text-muted-foreground">
                            {field.masked ??
                              field.value ??
                              `${field.kind}${field.bytes ? ` · ${field.bytes} car` : ""}`}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Sin trazas todavía. Envíe un archivo real desde un teléfono
                autorizado: la forma capturada dirá en qué campo viaja el
                contenido y con qué desenlace entró.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-primary">
              LOG DE ERRORES DEL MECANISMO DE COMUNICACIÓN
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Últimos {report.data?.log.length ?? 0} asientos derivados del
              conducto, del más reciente al más antiguo.
            </p>
            {(report.data?.log ?? []).length ? (
              <ul className="mt-2 space-y-1.5">
                {(report.data?.log ?? []).map((entry, index) => (
                  <li
                    key={`${entry.kind}-${index}`}
                    className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatMoment(entry.at)} · {entry.kind}
                      {entry.reference ? ` · ${entry.reference}` : ""}
                    </span>
                    <p className="mt-0.5 leading-5">{entry.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Sin errores asentados en la ventana. Si el conducto no ha
                recibido ningún archivo, esto es una incógnita y no una
                verificación.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
