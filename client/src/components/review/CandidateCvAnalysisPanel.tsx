import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

const STATE_TEXT: Record<string, { label: string; detail: string }> = {
  sin_solicitud: {
    label: "Sin solicitud registrada",
    detail:
      "La postulación no registra una solicitud de CV despachada. Nada se infiere: el expediente queda así.",
  },
  pendiente: {
    label: "Solicitud enviada · pendiente de recepción",
    detail:
      "El agente solicitó el CV por el mismo medio de la postulación y espera la respuesta de la persona.",
  },
  recibido: {
    label: "CV recibido",
    detail:
      "El documento llegó al expediente y ya forma parte del RAG Personal de la postulación.",
  },
};

/**
 * Análisis de CV de Agente IA.
 *
 * Se lee junto a «Formularios y anuncios · respuestas» porque ambas son el
 * mismo expediente visto en dos momentos: lo que la persona respondió al
 * postular y lo que entregó después. El panel declara primero el estado del
 * ciclo —solicitado, pendiente, recibido— y después la esencia; un expediente
 * sin CV muestra la espera con su causa, nunca un panel vacío.
 *
 * El panel propone re-evaluar; no decide. La decisión se registra en el
 * encabezado de identidad y su asiento queda en la bitácora.
 */
export function CandidateCvAnalysisPanel({
  applicationId,
  onReevaluate,
  reevaluating,
}: {
  applicationId: number;
  onReevaluate: () => void;
  reevaluating: boolean;
}) {
  const utils = trpc.useUtils();
  const analysis = trpc.candidateKnowledge.cvAnalysis.useQuery({
    applicationId,
  });
  const generateEssence = trpc.candidateKnowledge.generateCvEssence.useMutation(
    {
      onSuccess: async result => {
        await Promise.all([
          analysis.refetch(),
          utils.candidates.detail.invalidate({ id: applicationId }),
        ]);
        toast.success(result.message);
      },
      onError: error => toast.error(error.message),
    }
  );
  const state = analysis.data?.state ?? "sin_solicitud";
  const documents = analysis.data?.documents ?? [];
  const withEssence = documents.find((document: any) =>
    String(document.cv_essence ?? "").trim()
  );
  const essence = withEssence ? String(withEssence.cv_essence).trim() : "";
  const words = essence ? essence.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="rounded-2xl bg-white/8 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[.14em] text-white/55">
            Análisis de CV de Agente IA
          </p>
          <p className="mt-2 text-sm font-semibold text-white/85">
            {STATE_TEXT[state]?.label ?? state}
          </p>
          <p className="mt-1 text-xs leading-5 text-white/60">
            {STATE_TEXT[state]?.detail}
          </p>
        </div>
        <Badge className="rounded-full bg-sky-100 text-sky-800">
          {documents.length}{" "}
          {documents.length === 1 ? "documento" : "documentos"}
        </Badge>
      </div>

      {documents.length ? (
        <div className="mt-3 space-y-2">
          {documents.slice(0, 3).map((document: any) => (
            <div
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/6 p-3"
            >
              <span className="inline-flex min-w-0 items-center gap-2 text-xs text-white/80">
                <FileText className="h-3.5 w-3.5 shrink-0 text-sky-200/70" />
                <span className="truncate">{document.original_name}</span>
              </span>
              <span className="text-[11px] text-white/45">
                .{document.extension} · {document.source} ·{" "}
                {document.analysis_status}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {essence ? (
        <div className="mt-3 rounded-xl bg-white/6 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[.14em] text-white/55">
              Esencia del CV
            </p>
            <span className="text-[11px] text-white/45">
              {words} de {withEssence?.cv_essence_word_limit ?? 550} palabras
            </span>
          </div>
          <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-white/80">
            {essence}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-white/6 p-3 text-xs leading-5 text-white/60">
          {state === "recibido"
            ? "El CV está en el expediente y su esencia aún no se generó."
            : "La esencia se genera cuando el CV llegue al expediente."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {documents.length ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            disabled={generateEssence.isPending}
            onClick={() =>
              generateEssence.mutate({ fileId: Number(documents[0].id) })
            }
          >
            {generateEssence.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3.5 w-3.5" />
            )}
            {essence ? "Regenerar esencia" : "Generar esencia del CV"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          disabled={reevaluating || !essence}
          onClick={onReevaluate}
          title={
            essence
              ? "Repite la evaluación con el expediente del CV"
              : "La esencia del CV es requisito para re-evaluar con ella"
          }
        >
          <RefreshCw
            className={`mr-2 h-3.5 w-3.5 ${reevaluating ? "animate-spin" : ""}`}
          />
          Re-evaluar con el CV
        </Button>
      </div>

      <p className="mt-2 text-[11px] leading-4 text-white/45">
        El panel propone re-evaluar; la decisión se registra en el encabezado y
        su asiento queda en la bitácora.
      </p>
    </div>
  );
}
