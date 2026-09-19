/**
 * Señalización visual del expediente del candidato.
 *
 * El reclutador necesita reconocer, sin abrir cada hoja, qué expedientes ya
 * pasaron por revisión humana y qué cambió en ellos después. La ficha de
 * Candidatos ya lo declaraba con un sello; esta pieza lo vuelve vocabulario
 * compartido para que la Bandeja de entrada y la ficha del candidato presenten
 * la misma señal, con el mismo estilo y el mismo fundamento.
 *
 * Dos reglas sostienen el módulo:
 *
 * 1. **La revisión humana es un asiento, no una fecha de escritura.** Su fuente
 *    es `human_review_at`, que el servidor deriva de `audit_log` con actor
 *    identificado. Una escritura del agente o del sincronizador no acredita que
 *    una persona haya revisado el expediente.
 * 2. **Un evento posterior a la revisión invalida el sello como cierre.** Si el
 *    expediente cambió —se recuperó un adjunto, se incorporó un documento, se
 *    actualizó el análisis o el agente volvió a evaluar— la señal lo declara,
 *    porque el dictamen humano anterior dejó de cubrir el estado actual.
 *
 * El módulo es puro: no consulta, no formatea por navegador y no decide en el
 * servidor. La zona horaria es la de la institución, de modo que la hora visible
 * sea la del turno que revisó y no la del navegador que consulta.
 */

/** Zona horaria institucional de la operación. */
export const INSTITUTIONAL_TIME_ZONE = "America/Guatemala";

/** Naturaleza del evento observable en el expediente. */
export type ExpedienteSignalKind =
  | "human_review"
  | "re_evaluation"
  | "document_incorporated"
  | "attachment_recovered"
  | "analysis_updated"
  | "cv_essence_updated"
  | "expediente_acknowledged";

/** Color de la señal, alineado con la paleta del tablero. */
export type ExpedienteSignalTone = "rose" | "amber" | "sky" | "emerald";

export type ExpedienteStamp = { time: string; date: string; iso: string };

export type ExpedienteSignal = {
  kind: ExpedienteSignalKind;
  /** Texto breve del distintivo, sin la marca de tiempo. */
  label: string;
  tone: ExpedienteSignalTone;
  /** Marca de tiempo institucional del evento. */
  stamp: ExpedienteStamp;
  /** Quién produjo el evento, cuando el asiento lo identifica. */
  actor: string | null;
  /** Explicación para el `title` y el `aria-label` del distintivo. */
  title: string;
  /** Cierto si el evento ocurrió después de la última revisión humana. */
  afterReview: boolean;
};

/**
 * Sello institucional de una fecha: hora y fecha corta en la zona del turno.
 *
 * Devuelve `null` cuando el valor falta o no es una fecha válida, de modo que
 * quien lo consume pueda omitir el distintivo en lugar de mostrar «Invalid
 * Date».
 */
export function institutionalStamp(
  value: string | Date | null | undefined,
  timeZone: string = INSTITUTIONAL_TIME_ZONE
): ExpedienteStamp | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const options = { timeZone } as const;
  const parts = new Intl.DateTimeFormat("es-GT", {
    ...options,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  const month = read("month").replace(/\./g, "").slice(0, 3).toUpperCase();
  const day = read("day").padStart(2, "0");
  const year = read("year");
  const time = new Intl.DateTimeFormat("es-GT", {
    ...options,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (!month || !day || !year) return null;
  return { time, date: `${day} ${month} ${year}`, iso: date.toISOString() };
}

/**
 * Vocabulario de las acciones de auditoría que constituyen un evento del
 * expediente. Cualquier acción ausente de este mapa no se señaliza: la señal no
 * se inventa a partir de lo desconocido.
 */
export const EXPEDIENTE_EVENT_VOCABULARY: Record<
  string,
  { kind: ExpedienteSignalKind; label: string; tone: ExpedienteSignalTone }
> = {
  candidate_file_received: {
    kind: "document_incorporated",
    label: "Documento incorporado",
    tone: "sky",
  },
  candidate_file_recovered: {
    kind: "attachment_recovered",
    label: "Adjunto recuperado",
    tone: "emerald",
  },
  candidate_file_analyzed: {
    kind: "analysis_updated",
    label: "Análisis IA actualizado",
    tone: "sky",
  },
  candidate_file_analysis_updated: {
    kind: "analysis_updated",
    label: "Análisis IA actualizado",
    tone: "sky",
  },
  candidate_cv_essence_generated: {
    kind: "cv_essence_updated",
    label: "Esencia del CV actualizada",
    tone: "sky",
  },
  candidate_expediente_acknowledged: {
    kind: "expediente_acknowledged",
    label: "Acuse enviado",
    tone: "emerald",
  },
};

/** Acciones que el servidor agrega para alimentar la señalización. */
export const EXPEDIENTE_EVENT_ACTIONS = Object.keys(
  EXPEDIENTE_EVENT_VOCABULARY
);

/**
 * Lee una fecha del servidor sin perder su precisión.
 *
 * El conductor devuelve `Date` y la conversión por texto descartaría los
 * milisegundos: dos eventos del mismo segundo —una revisión y la recuperación
 * que la sigue— se leerían como simultáneos y el cambio posterior dejaría de
 * declararse. La instancia se conserva tal cual.
 */
function readDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Señales del expediente, ordenadas de la más reciente a la más antigua.
 *
 * La primera señal es siempre la revisión humana, cuando existe. Las demás
 * declaran lo que cambió después: una re-evaluación del agente, un documento
 * incorporado, un adjunto recuperado o un análisis actualizado.
 */
export function expedienteSignals(candidate: any): ExpedienteSignal[] {
  const signals: ExpedienteSignal[] = [];
  const reviewDate = readDate(candidate?.human_review_at);
  const reviewer = candidate?.human_review_actor
    ? String(candidate.human_review_actor)
    : null;
  const reviewStamp = institutionalStamp(candidate?.human_review_at);

  if (reviewStamp) {
    signals.push({
      kind: "human_review",
      label: "Revisión Humana",
      tone: "rose",
      stamp: reviewStamp,
      actor: reviewer,
      title: `Revisión humana guardada por ${reviewer ?? "una persona"} el ${reviewStamp.date} a las ${reviewStamp.time}`,
      afterReview: false,
    });
  }

  const isAfterReview = (value: unknown) => {
    const date = readDate(value);
    if (!date) return false;
    if (!reviewDate) return false;
    return date.getTime() > reviewDate.getTime();
  };

  // Re-evaluación: el agente volvió a puntuar el expediente. El conteo distingue
  // «nunca evaluado» de «evaluado más de una vez», y la fecha distingue la
  // re-evaluación posterior a la revisión de la que la precedió.
  const evaluationCount = Number(candidate?.evaluation_count ?? 0);
  const lastEvaluation = readDate(candidate?.last_evaluation_at);
  if (evaluationCount > 1 || (evaluationCount === 1 && lastEvaluation && isAfterReview(lastEvaluation))) {
    const stamp = institutionalStamp(candidate?.last_evaluation_at);
    if (stamp) {
      signals.push({
        kind: "re_evaluation",
        label: evaluationCount > 1 ? "Re-evaluación IA" : "Evaluación IA",
        tone: "amber",
        stamp,
        actor: null,
        title:
          evaluationCount > 1
            ? `El agente evaluador volvió a puntuar el expediente el ${stamp.date} a las ${stamp.time}`
            : `El agente evaluador puntuó el expediente el ${stamp.date} a las ${stamp.time}`,
        afterReview: isAfterReview(lastEvaluation),
      });
    }
  }

  const action = candidate?.expediente_event_action
    ? String(candidate.expediente_event_action)
    : "";
  const entry = EXPEDIENTE_EVENT_VOCABULARY[action];
  const eventStamp = institutionalStamp(candidate?.expediente_event_at);
  if (entry && eventStamp) {
    const actor = candidate?.expediente_event_actor
      ? String(candidate.expediente_event_actor)
      : null;
    signals.push({
      kind: entry.kind,
      label: entry.label,
      tone: entry.tone,
      stamp: eventStamp,
      actor,
      title: `${entry.label} por ${actor ?? "JARVI HR"} el ${eventStamp.date} a las ${eventStamp.time}`,
      afterReview: isAfterReview(candidate?.expediente_event_at),
    });
  }

  return signals;
}

/**
 * ¿El expediente cambió después de la revisión humana?
 *
 * Es la pregunta que el reclutador necesita responder de un vistazo: un sello de
 * revisión con cambios posteriores ya no cubre el estado actual del expediente.
 */
export function expedienteChangedAfterReview(candidate: any): boolean {
  return expedienteSignals(candidate).some(
    signal => signal.kind !== "human_review" && signal.afterReview
  );
}
