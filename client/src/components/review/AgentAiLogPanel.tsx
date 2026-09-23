import { trpc } from "@/lib/trpc";
import { Check, Loader2, ScrollText } from "lucide-react";

const CATEGORY_ICON: Record<string, string> = {
  nlp: "🎙️",
  vision: "👁️",
  audio: "🔊",
  data: "📊",
  reasoning: "🧠",
};

function shortTime(value: string | null | undefined) {
  if (!value) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("es-GT", { hour12: false });
}

/**
 * Bitácora de la IA del agente conversacional.
 *
 * Se muestra justo debajo de la conversación de WhatsApp, con el aspecto de una
 * ventana de registros: una línea por etapa del ciclo, en el orden que la
 * operación administró, con la acción ejecutada, su justificación técnica y el
 * visto de completado. Una etapa omitida se conserva con su motivo y también se
 * marca completada, para que no sorprenda en la bandeja que algo no se preguntó
 * porque ya constaba en el expediente.
 */
export function AgentAiLogPanel({
  applicationId,
  candidateName,
}: {
  applicationId: number;
  candidateName: string | null;
}) {
  const trace = trpc.agentLog.trace.useQuery(
    { applicationId },
    { refetchInterval: 6_000, refetchIntervalInBackground: false }
  );
  const stages = trace.data ?? [];
  const completed = stages.filter(
    stage => stage.entry && stage.entry.completed
  ).length;

  return (
    <section
      aria-label="Bitácora de la IA del agente"
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b12] font-mono shadow-lift"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#0b1220] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ScrollText className="h-4 w-4 shrink-0 text-emerald-400" />
          <h2 className="truncate text-xs font-semibold uppercase tracking-[.14em] text-white/85">
            Registros de la IA
          </h2>
          {candidateName ? (
            <span className="hidden truncate text-[11px] text-white/40 sm:inline">
              · {candidateName}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-white/45">
          <span className="rounded-full bg-white/5 px-2 py-0.5">
            {completed}/{stages.length}
          </span>
          {trace.isFetching ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : null}
        </div>
      </div>

      <div className="max-h-[340px] overflow-y-auto px-1 py-2">
        {trace.isLoading ? (
          <p className="px-3 py-4 text-xs text-white/45">
            Preparando la bitácora de la IA…
          </p>
        ) : stages.length === 0 ? (
          <p className="px-3 py-4 text-xs text-white/45">
            Sin registros de la IA para esta postulación.
          </p>
        ) : (
          <ol className="space-y-0.5">
            {stages.map(stage => {
              const entry = stage.entry;
              const executed = entry && entry.completed && !entry.skipReason;
              const omitted = entry && entry.completed && Boolean(entry.skipReason);
              return (
                <li
                  key={stage.key}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs leading-5 hover:bg-white/[.04]"
                >
                  <span className="mt-px shrink-0 tabular-nums text-white/35">
                    {shortTime(entry?.createdAt)}
                  </span>
                  <span className="shrink-0" aria-hidden="true">
                    {CATEGORY_ICON[entry?.category ?? "reasoning"]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-white/90">
                      {entry ? entry.action : stage.name}
                    </span>
                    {entry && !stage.enabled && entry.skipReason ? (
                      <span className="text-white/50">
                        {" "}
                        · desactivada: {entry.justification}
                      </span>
                    ) : entry ? (
                      <span
                        className={
                          omitted ? "text-amber-300/90" : "text-white/55"
                        }
                      >
                        {" "}
                        · {entry.justification}
                      </span>
                    ) : (
                      <span className="text-white/35"> · pendiente</span>
                    )}
                  </span>
                  {executed || omitted ? (
                    <Check
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        executed ? "text-emerald-400" : "text-amber-300"
                      }`}
                      aria-label="Completada"
                    />
                  ) : (
                    <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-white/15" />
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
