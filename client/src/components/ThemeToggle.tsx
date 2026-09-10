import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { APP_THEME_LABELS, nextAppTheme, type AppTheme } from "@shared/theme";
import { Contrast, Moon, Sun } from "lucide-react";
import React from "react";

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  "high-contrast": Contrast,
} satisfies Record<AppTheme, typeof Sun>;

export function ThemeToggle({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = nextAppTheme(theme);
  const ActiveIcon = THEME_ICONS[theme];
  const positions: Record<AppTheme, string> = {
    light: "translate-x-1",
    dark: "translate-x-[1.25rem]",
    "high-contrast": "translate-x-9",
  };

  return (
    <button
      type="button"
      aria-label={`Tema actual: ${APP_THEME_LABELS[theme]}. Cambiar a ${APP_THEME_LABELS[nextTheme]}`}
      title={`Tema actual: ${APP_THEME_LABELS[theme]}. Cambiar a ${APP_THEME_LABELS[nextTheme]}`}
      onClick={toggleTheme}
      className={cn(
        "relative isolate h-8 shrink-0 rounded-full border border-sidebar-border bg-sidebar-accent/70 shadow-inner outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        compact ? "w-8" : "w-[3.75rem]",
        className
      )}
    >
      {!compact && (
        <>
          <Sun
            aria-hidden="true"
            className="absolute left-1.5 top-1/2 size-3 -translate-y-1/2 opacity-45"
          />
          <Moon
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 opacity-45"
          />
          <Contrast
            aria-hidden="true"
            className="absolute right-1.5 top-1/2 size-3 -translate-y-1/2 opacity-45"
          />
        </>
      )}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1 z-10 grid size-6 place-items-center rounded-full bg-foreground text-background shadow-md transition-transform duration-300",
          compact ? "translate-x-1" : positions[theme]
        )}
      >
        <ActiveIcon className="size-3.5" />
      </span>
    </button>
  );
}
