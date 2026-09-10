import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { Moon, Sun } from "lucide-react";
import React from "react";

export function ThemeToggle({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const nextThemeLabel = dark ? "claro" : "oscuro";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={`Cambiar a modo ${nextThemeLabel}`}
      title={`Cambiar a modo ${nextThemeLabel}`}
      onClick={toggleTheme}
      className={cn(
        "relative isolate h-8 shrink-0 rounded-full border border-sidebar-border bg-sidebar-accent/70 shadow-inner outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        compact ? "w-8" : "w-[3.75rem]",
        className
      )}
    >
      {!compact && (
        <>
          <Moon
            aria-hidden="true"
            className={cn(
              "absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2 transition-opacity",
              dark ? "opacity-90" : "opacity-35"
            )}
          />
          <Sun
            aria-hidden="true"
            className={cn(
              "absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 transition-opacity",
              dark ? "opacity-35" : "opacity-90"
            )}
          />
        </>
      )}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1 z-10 grid size-6 place-items-center rounded-full bg-white text-slate-800 shadow-md transition-transform duration-300",
          compact ? "translate-x-1" : dark ? "translate-x-8" : "translate-x-1"
        )}
      >
        {compact ? (
          dark ? (
            <Moon className="size-3.5" />
          ) : (
            <Sun className="size-3.5" />
          )
        ) : null}
      </span>
    </button>
  );
}
