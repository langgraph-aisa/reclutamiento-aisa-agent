import { CandidateConversationPanel } from "@/components/review/CandidateConversationPanel";
import { CandidateRagPanel } from "@/components/review/CandidateRagPanel";
import { trpc } from "@/lib/trpc";

/**
 * Evidencia conversacional y conocimiento vigente de la persona evaluada.
 *
 * Se inserta debajo de la matriz de evaluación IA para que la revisión humana
 * opere, sin cambiar de pantalla, la conversación de WhatsApp del candidato y su
 * RAG Personal. La bandeja que aparece aquí es exclusiva de la persona en
 * estudio: cubre su historial completo y todas las herramientas de la bandeja
 * general, pero no permite abandonar su expediente.
 *
 * `positionId` permanece en el contrato porque la ficha lo conoce; la plaza ya
 * viaja dentro del estado conversacional que alimenta al RAG Personal.
 */
export function ReviewEvidencePanels({
  applicationId,
  candidateName,
}: {
  applicationId: number;
  positionId: number | null;
  candidateName: string | null;
}) {
  const state = trpc.conversation.state.useQuery(
    { applicationId },
    { refetchInterval: 6_000, refetchIntervalInBackground: false }
  );

  const cycles = (state.data?.cycles ?? []) as any[];
  const notes = (state.data?.notes ?? []) as any[];
  const projects = (state.data?.knowledge?.projects ?? []) as any[];

  return (
    <section className="grid min-w-0 gap-2 md:gap-3 lg:grid-cols-2">
      <CandidateConversationPanel
        applicationId={applicationId}
        candidateName={candidateName}
      />

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

      {state.data?.lastAgentError ? (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 lg:col-span-2 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          Último incidente del agente en la conversación:{" "}
          {state.data.lastAgentError}
        </p>
      ) : null}
    </section>
  );
}
