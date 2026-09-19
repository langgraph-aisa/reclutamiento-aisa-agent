import {
  expedienteChangedAfterReview,
  expedienteSignals,
  type ExpedienteSignal,
  type ExpedienteSignalTone,
} from "@shared/expedienteSignal";
import {
  ClipboardCheck,
  FileCheck2,
  FolderSync,
  RefreshCw,
  Send,
  TriangleAlert,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * Distintivos de señalización del expediente.
 *
 * Presentan el mismo hecho en las tres hojas donde el reclutador decide: la
 * Bandeja de entrada, la búsqueda de Candidatos y la ficha del candidato. El
 * sello de revisión humana conserva la forma que la ficha ya usaba —botón rosa
 * con la hora y la fecha—, de modo que el reclutador no reaprenda la señal; los
 * demás eventos usan su propio color y su propio verbo.
 *
 * La procedencia no vive aquí. El servidor deriva la revisión de `audit_log` con
 * actor identificado y el evento del expediente de los asientos del expediente;
 * este módulo sólo traduce esa derivación a un distintivo.
 */

const TONE_CLASSES: Record<ExpedienteSignalTone, string> = {
  rose: "border-rose-400 bg-rose-600 text-white hover:bg-rose-700 dark:border-rose-400 dark:bg-rose-700 dark:hover:bg-rose-600",
  amber:
    "border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 dark:border-amber-500/60 dark:bg-amber-500/15 dark:text-amber-200",
  sky: "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-500/10 dark:text-sky-200",
  emerald:
    "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200",
};

const KIND_ICONS: Record<ExpedienteSignal["kind"], ComponentType<any>> = {
  human_review: ClipboardCheck,
  re_evaluation: RefreshCw,
  document_incorporated: FileCheck2,
  attachment_recovered: FolderSync,
  analysis_updated: FileCheck2,
  cv_essence_updated: FileCheck2,
  expediente_acknowledged: Send,
};

/** Texto visible del distintivo: verbo, hora y fecha institucionales. */
export function expedienteSignalText(signal: ExpedienteSignal) {
  return `${signal.label} (${signal.stamp.time}) ${signal.stamp.date}`;
}

/**
 * Señalización completa del expediente.
 *
 * Declara la revisión humana y todo lo que cambió después. Cuando el expediente
 * cambió tras la revisión, añade un distintivo de aviso: el dictamen humano
 * anterior dejó de cubrir el estado actual y el reclutador debe volver a mirarlo.
 */
export function ExpedienteSignalBadges({
  candidate,
  className = "",
  showUnchangedReview = true,
  max = 3,
}: {
  candidate: any;
  className?: string;
  /** Si es falso, la revisión sin cambios posteriores no se repite. */
  showUnchangedReview?: boolean;
  max?: number;
}) {
  const signals = expedienteSignals(candidate);
  const changed = expedienteChangedAfterReview(candidate);
  const visible = signals
    .filter(
      signal =>
        showUnchangedReview || signal.kind !== "human_review" || changed
    )
    .slice(0, max);
  if (!visible.length) return null;

  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}
      aria-label="Señalización del expediente del candidato"
    >
      {visible.map(signal => {
        const Icon = KIND_ICONS[signal.kind] ?? ClipboardCheck;
        return (
          <span
            key={`${signal.kind}:${signal.stamp.iso}`}
            className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold leading-tight ${TONE_CLASSES[signal.tone]}`}
            title={signal.title}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{expedienteSignalText(signal)}</span>
          </span>
        );
      })}
      {changed ? (
        <span
          className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-bold leading-tight text-rose-800 dark:border-rose-400/60 dark:bg-rose-500/10 dark:text-rose-200"
          title="El expediente cambió después de la revisión humana: el dictamen anterior no cubre el estado actual"
        >
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">Cambios tras la revisión</span>
        </span>
      ) : null}
    </div>
  );
}
