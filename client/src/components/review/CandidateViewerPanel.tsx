import {
  formatDate,
  scoreFor,
} from "@/components/review/CandidateReviewSummary";
import { VerticalNavigator } from "@/components/VerticalNavigator";
import {
  adjacentReviewBlockPage,
  reviewBlockPageRange,
  type ReviewNavigationDirection,
} from "@shared/reviewNavigation";
import { Bot, MessageSquareText, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type ViewerSelection = "ai" | "summary" | "reason";

/** Etiquetas institucionales de los bloques de la matriz de evaluación. */
function blockLabel(value: string) {
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

/**
 * Vista 360° de la postulación en estudio: matriz de evaluación IA, nota inicial
 * y motivo de evaluación en un solo panel, con navegación de bloques.
 *
 * Es el bloque que la búsqueda de Candidatos dejó de alojar en 2.0.160. Vive en
 * la ficha, encima del resumen de perfil y de la decisión, para que la revisión
 * humana lea la evidencia sin cambiar de hoja. La matriz muestra tres bloques a
 * la vez y ofrece el recorrido del resto; en pantallas estrechas muestra uno.
 */
export function CandidateViewerPanel({ candidate }: { candidate: any }) {
  const [selection, setSelection] = useState<ViewerSelection>("ai");
  const blocks = Array.isArray(candidate?.ai_payload?.blocks)
    ? candidate.ai_payload.blocks
    : [];
  const heading =
    selection === "reason"
      ? "Motivo de evaluación"
      : selection === "summary"
        ? "Nota inicial del candidato"
        : "Matriz de evaluación IA";
  const panelRef = useRef<HTMLElement>(null);
  const [blockPageSize, setBlockPageSize] = useState(3);
  const [blockPage, setBlockPage] = useState(0);

  useLayoutEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    const updatePageSize = () => {
      setBlockPageSize(element.clientWidth >= 760 ? 3 : 1);
    };
    updatePageSize();
    const observer = new ResizeObserver(updatePageSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setBlockPage(0);
  }, [candidate?.id, selection, blockPageSize, blocks.length]);

  const blockRange = reviewBlockPageRange(
    blockPage,
    blocks.length,
    blockPageSize
  );
  const visibleBlocks = blocks.slice(blockRange.start, blockRange.end);
  const blockStatus = blocks.length
    ? `${blockRange.start + 1}–${blockRange.end} de ${blocks.length}`
    : "Sin bloques";
  const moveBlockPage = (direction: ReviewNavigationDirection) => {
    setBlockPage(current =>
      adjacentReviewBlockPage(current, blocks.length, blockPageSize, direction)
    );
  };

  return (
    <section
      ref={panelRef}
      className="human-review-viewer relative min-h-[168px] shrink-0 rounded-2xl bg-[#0b2d4b] text-white shadow-lift dark:bg-[#162333]"
    >
      <div className="flex flex-col px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-sky-200/70">
              Vista 360° del Candidato
            </p>
            <h2 className="mt-1 text-lg font-bold text-white">{heading}</h2>
            {selection === "ai" &&
            (candidate.classification || candidate.ai_model) ? (
              <p className="mt-1 text-xs text-white/60">
                {candidate.classification ?? "Resultado ponderado"} ·{" "}
                {candidate.ai_model ?? "Modelo no informado"}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-start justify-end gap-2">
            {selection === "ai" && blockRange.pageCount > 1 ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-black/10 px-2 py-1">
                <span
                  className="min-w-[4.5rem] text-center text-[11px] font-semibold text-white/75"
                  aria-live="polite"
                >
                  {blockStatus}
                </span>
                <VerticalNavigator
                  label="Navegación de bloques de evaluación"
                  previousLabel="Mostrar bloque o grupo anterior"
                  nextLabel="Mostrar bloque o grupo siguiente"
                  disablePrevious={blockRange.pageIndex === 0}
                  disableNext={blockRange.pageIndex >= blockRange.pageCount - 1}
                  onPrevious={() => moveBlockPage(-1)}
                  onNext={() => moveBlockPage(1)}
                  status={`Bloques ${blockStatus}`}
                  orientation="horizontal"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <ViewerButton
                active={selection === "summary"}
                onClick={() => setSelection("summary")}
                icon={Sparkles}
                label="Nota IA"
              />
              <ViewerButton
                active={selection === "ai"}
                onClick={() => setSelection("ai")}
                icon={Bot}
                label="Evaluación"
              />
              <ViewerButton
                active={selection === "reason"}
                onClick={() => setSelection("reason")}
                icon={MessageSquareText}
                label="Motivo"
              />
            </div>
          </div>
        </div>
        <div className="mt-3">
          {selection === "summary" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <ViewerTextCard
                label="Resumen de persona"
                text={candidate.profile_summary ?? "Sin nota inicial de IA."}
              />
              <ViewerTextCard
                label="Contexto de la plaza"
                text={`${candidate.position_title ?? "Plaza sin título"} · Ingreso ${formatDate(candidate.submitted_at)}`}
              />
            </div>
          ) : selection === "reason" ? (
            <ViewerTextCard
              label="Razonamiento registrado"
              text={candidate.evaluation_reason ?? "Pendiente de evaluación."}
            />
          ) : blocks.length ? (
            <div
              className={`grid items-stretch gap-2 ${blockPageSize === 3 ? "grid-cols-3" : "grid-cols-1"}`}
            >
              {visibleBlocks.map((block: any) => (
                <div
                  key={block.id}
                  className="h-full rounded-xl border border-white/10 bg-white/8 p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-white/90">
                      {blockLabel(block.id)}
                    </span>
                    <span className="font-bold text-sky-100">
                      {Math.round(Number(block.score) || 0)}/100
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
                  <p className="mt-2 text-[11px] leading-4 text-white/70">
                    {block.rationale ?? "Sin razonamiento por bloque."}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-[auto_1fr]">
              <div className="grid min-w-32 place-items-center rounded-xl bg-white/8 p-4">
                <p className="text-3xl font-bold">
                  {scoreFor(candidate) ?? "—"}
                  <span className="text-sm text-white/50">/100</span>
                </p>
              </div>
              <ViewerTextCard
                label={candidate.ai_model ?? "Evaluación disponible"}
                text={candidate.evaluation_reason ?? "Sin matriz por bloques."}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ViewerButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bot;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? "border-white bg-white text-[#0b2d4b] dark:border-primary dark:bg-primary dark:text-primary-foreground" : "border-white/20 bg-white/5 text-white/75 hover:bg-white/10"}`}
    >
      <Icon className="mr-1.5 h-3.5 w-3.5" /> {label}
    </button>
  );
}

function ViewerTextCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-xl bg-white/8 p-4">
      <p className="text-xs uppercase tracking-[.14em] text-white/50">
        {label}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/85">
        {text}
      </p>
    </div>
  );
}
