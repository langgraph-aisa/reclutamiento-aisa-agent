import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * Sección plegable de la ficha.
 *
 * La ficha acumula cinco bloques de lectura —resumen de perfil, motivo,
 * bitácora, análisis de CV y respuestas de formularios— que desplazan la matriz
 * de evaluación hacia abajo. Plegados, la matriz queda a la vista y el detalle
 * se despliega solo cuando el operador lo necesita.
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
  defaultOpen = true,
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
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${id}-contenido`}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs uppercase tracking-[.14em] opacity-70">
          {title}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 opacity-70 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open ? (
        <div id={`${id}-contenido`} className="mt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
