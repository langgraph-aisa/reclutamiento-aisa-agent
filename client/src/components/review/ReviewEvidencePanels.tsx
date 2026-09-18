import { CandidateConversationPanel } from "@/components/review/CandidateConversationPanel";
import { CandidateRagPanel } from "@/components/review/CandidateRagPanel";
import { trpc } from "@/lib/trpc";

/**
 * Evidencia conversacional y conocimiento vigente de la persona evaluada.
 *
 * El módulo conserva **una sola lectura** del estado conversacional
 * (`conversation.state`) y la ofrece a dos superficies separadas, porque la
 * ficha las lee en dos momentos distintos y no en un mismo bloque:
 *
 * - El **feed de WhatsApp** va inmediatamente después del encabezado de
 *   identidad: es el contexto que la persona revisora necesita antes de leer la
 *   matriz de evaluación.
 * - El **RAG Personal** cierra la hoja, después del detalle de la postulación y
 *   del agente que lo alimenta, porque es el conocimiento que ambos producen.
 *
 * Las dos superficies declaran la misma consulta con la misma clave, de modo
 * que separarlas no duplica la petición ni el sondeo: React Query resuelve una
 * sola lectura y ambas se suscriben a ella. La bandeja es exclusiva de la
 * persona en estudio: cubre su historial completo y todas las herramientas de
 * la bandeja general, pero no permite abandonar su expediente.
 */
function useReviewCandidateState(applicationId: number) {
  return trpc.conversation.state.useQuery(
    { applicationId },
    { refetchInterval: 6_000, refetchIntervalInBackground: false }
  );
}

export function CandidateConversationFeed({
  applicationId,
  candidateName,
}: {
  applicationId: number;
  candidateName: string | null;
}) {
  const state = useReviewCandidateState(applicationId);

  return (
    <section className="min-w-0 space-y-2 md:space-y-3">
      <CandidateConversationPanel
        applicationId={applicationId}
        candidateName={candidateName}
      />

      {state.data?.lastAgentError ? (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          Último incidente del agente en la conversación:{" "}
          {state.data.lastAgentError}
        </p>
      ) : null}
    </section>
  );
}

export function CandidatePersonalKnowledgePanel({
  applicationId,
  candidateName,
}: {
  applicationId: number;
  candidateName: string | null;
}) {
  const state = useReviewCandidateState(applicationId);
  const cycles = (state.data?.cycles ?? []) as any[];
  const notes = (state.data?.notes ?? []) as any[];
  const projects = (state.data?.knowledge?.projects ?? []) as any[];

  return (
    <section className="min-w-0">
      <CandidateRagPanel
        applicationId={applicationId}
        candidateName={candidateName}
        plazaProjects={projects as any[]}
        cycles={cycles as any[]}
        notes={notes as any[]}
        knowledgeFingerprint={
          state.data?.evaluationKnowledgeFingerprint ?? null
        }
      />
    </section>
  );
}
