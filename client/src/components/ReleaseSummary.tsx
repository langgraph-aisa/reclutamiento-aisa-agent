import { REPOSITORY_METADATA } from "@/lib/repositoryMetadata";
import { GitBranch, Github } from "lucide-react";

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  Typst: "#39a7b4",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  CSS: "#563d7c",
  PLpgSQL: "#336790",
  Other: "#d1d5db",
};

export function ReleaseSummary({ compact = false }: { compact?: boolean }) {
  const metadata = REPOSITORY_METADATA;

  if (compact) {
    return (
      <section
        aria-label={`Instantánea de compilación: GitHub ${metadata.githubSyncPercentage} por ciento sincronizado`}
        title={`${metadata.branch} · ${metadata.commit} · ${metadata.githubSyncPercentage} % al construir`}
        className="mt-2 grid place-items-center rounded-xl border border-sidebar-border/80 bg-sidebar-accent/35 py-2"
      >
        <span className="relative">
          <Github className="size-4 text-sidebar-foreground" aria-hidden="true" />
          <span className="absolute -right-1 -top-1 size-2 rounded-full border border-sidebar bg-emerald-500" />
        </span>
        <span className="mt-1 font-mono text-[8px] text-sidebar-foreground/70">
          {metadata.githubSyncPercentage}%
        </span>
      </section>
    );
  }

  return (
    <section
      aria-label="Instantánea de compilación y sincronización del repositorio"
      className="release-summary mt-2 space-y-2 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/35 p-2.5"
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-sidebar-foreground/70">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono">{metadata.branch}</span>
        </span>
        <span className="font-mono">{metadata.commit}</span>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-sidebar-foreground/75">
          <span className="inline-flex items-center gap-1">
            <Github className="size-3" aria-hidden="true" /> GitHub
          </span>
          <span>{metadata.githubSyncPercentage}% al construir</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-sidebar-border/65"
          role="progressbar"
          aria-label="Sincronización con la rama remota al construir"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={metadata.githubSyncPercentage}
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width]"
            style={{ width: `${metadata.githubSyncPercentage}%` }}
          />
        </div>
      </div>

      <div>
        <div
          className="flex h-1.5 overflow-hidden rounded-full bg-sidebar-border/65"
          aria-label="Distribución de lenguajes del repositorio"
        >
          {metadata.languages.map(language => (
            <span
              key={language.name}
              title={`${language.name} ${language.percentage}%`}
              style={{
                width: `${language.percentage}%`,
                backgroundColor: LANGUAGE_COLORS[language.name] ?? "#94a3b8",
              }}
            />
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
          {metadata.languages.map(language => (
            <span
              key={language.name}
              className="flex min-w-0 items-center gap-1 text-[9px] text-sidebar-foreground/65"
            >
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: LANGUAGE_COLORS[language.name] ?? "#94a3b8",
                }}
              />
              <span className="truncate">{language.name}</span>
              <span>{language.percentage}%</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
