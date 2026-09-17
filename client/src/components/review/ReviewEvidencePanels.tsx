import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CandidateRagPanel } from "@/components/review/CandidateRagPanel";
import { trpc } from "@/lib/trpc";
import { Loader2, MessageCircle } from "lucide-react";
import { Link } from "wouter";

/**
 * Evidencia conversacional y conocimiento vigente de la persona evaluada.
 *
 * Se inserta debajo de la matriz de evaluación IA para que la revisión humana
 * observe, sin cambiar de pantalla, lo que la persona escribió y el marco de
 * conocimiento que sustenta la decisión.
 */
export function ReviewEvidencePanels({
  applicationId,
  positionId,
  candidateName,
}: {
  applicationId: number;
  positionId: number | null;
  candidateName: string | null;
}) {
  const conversations = trpc.inbox.list.useQuery(
    { applicationId, limit: 1 },
    { refetchInterval: 4_000, refetchIntervalInBackground: false }
  );
  const conversationId = (conversations.data ?? [])[0]?.id as number | undefined;
  const detail = trpc.inbox.detail.useQuery(
    { conversationId: conversationId ?? 0 },
    {
      enabled: Boolean(conversationId),
      refetchInterval: 4_000,
      refetchIntervalInBackground: false,
    }
  );
  const state = trpc.conversation.state.useQuery(
    { applicationId },
    { refetchInterval: 6_000, refetchIntervalInBackground: false }
  );

  const current = detail.data?.conversation;
  const messages = (detail.data?.messages ?? []) as any[];
  const cycles = (state.data?.cycles ?? []) as any[];
  const notes = (state.data?.notes ?? []) as any[];
  const projects = (state.data?.knowledge?.projects ?? []) as any[];
  const openCycles = cycles.filter(cycle => cycle.status === "abierto");

  return (
    <section className="grid min-w-0 gap-2 md:gap-3 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft">
        <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
          <MessageCircle className="h-4 w-4 text-emerald-700" />
          <h3 className="text-sm font-bold text-primary">
            Conversación de {candidateName ?? "la persona evaluada"}
          </h3>
          {current ? (
            <Badge
              variant="outline"
              className={`shrink-0 rounded-full px-2 text-[10px] ${
                current.human_takeover && !current.agent_enabled
                  ? "border-amber-300 bg-amber-100 text-amber-950"
                  : "border-emerald-300 bg-emerald-100 text-emerald-900"
              }`}
            >
              {current.human_takeover && !current.agent_enabled
                ? "control humano"
                : "agente JARVI HR"}
            </Badge>
          ) : null}
          {conversationId ? (
            <Link
              href={`/admin/inbox?application=${applicationId}`}
              className="ml-auto text-xs font-semibold text-primary underline decoration-border underline-offset-4 hover:text-sky-800"
            >
              Abrir bandeja completa
            </Link>
          ) : null}
        </header>
        <div className="h-[300px] min-h-0 overflow-y-auto bg-muted/30 p-3">
          {conversations.isLoading || (detail.isLoading && conversationId) ? (
            <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando
              conversación
            </p>
          ) : !messages.length ? (
            <p className="text-xs text-muted-foreground">
              Sin mensajes registrados para esta postulación. La conversación se
              abre cuando la persona responde por WhatsApp.
            </p>
          ) : (
            <div className="space-y-1.5">
              {messages.map(item => {
                const outbound = item.direction === "outbound";
                return (
                  <div
                    key={item.id}
                    className={`flex ${outbound ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-2.5 py-1.5 text-xs leading-5 shadow-sm ${
                        outbound
                          ? "rounded-tr-none bg-[#005c4b] text-white"
                          : "rounded-tl-none border border-border/60 bg-card text-primary"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {item.body || item.transcript || "Adjunto recibido"}
                      </p>
                      <p
                        className={`mt-0.5 text-right text-[10px] ${
                          outbound ? "text-white/70" : "text-muted-foreground"
                        }`}
                      >
                        {new Date(item.created_at).toLocaleString("es-GT", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "America/Guatemala",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {state.data?.lastAgentError ? (
          <p className="border-t border-border/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Último incidente del agente: {state.data.lastAgentError}
          </p>
        ) : null}
      </div>

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
