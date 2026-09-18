import { Minus, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * Sección plegable de la ficha.
 *
 * La ficha acumula cinco bloques de lectura —resumen de perfil, bitácora,
 * motivo, análisis de CV y respuestas de formularios— que desplazan la matriz
 * de evaluación hacia abajo. La barra es idéntica en los cinco: rótulo en
 * versal alineado a la izquierda y botón circular al extremo derecho, de modo
 * que la columna forme una sola línea de lectura.
 *
 * Los bloques arrancan plegados: lo primero que se lee es la matriz de
 * evaluación y el detalle se despliega solo cuando el operador lo necesita.
 *
 * El estado se recuerda **por sección y por operador**, en el almacenamiento
 * local del navegador: es una preferencia de lectura, no una decisión del
 * sistema, y por eso no viaja al servidor ni se audita.
 */
export function CollapsibleSection({
  id,
  title,
  children,
  className = "",
  defaultOpen = false,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const storageKey = `jarvi-collapsible:${id}`;
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return defaultOpen;
    const saved = window.localStorage.getItem(storageKey);
    return saved === null ? defaultOpen : saved === "open";
  });

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "open" : "closed");
    } catch {
      // Un almacenamiento no disponible no debe impedir plegar la sección.
    }
  }

  return (
    <div className={`rounded-xl bg-white/8 ${className}`.trim()}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${id}-contenido`}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-[.14em] text-white/85">
          {title}
        </span>
        <span
          aria-hidden="true"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/25 bg-black/20 text-white/85"
        >
          {open ? (
            <Minus className="h-3.5 w-3.5" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {open ? (
        <div id={`${id}-contenido`} className="px-3.5 pb-3.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
