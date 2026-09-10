import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import React from "react";

type VerticalNavigatorProps = {
  label: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  disablePrevious?: boolean;
  disableNext?: boolean;
  status?: string;
  className?: string;
  orientation?: "vertical" | "horizontal";
};

export function VerticalNavigator({
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  disablePrevious = false,
  disableNext = false,
  status,
  className,
  orientation = "vertical",
}: VerticalNavigatorProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex gap-1",
        orientation === "horizontal" ? "flex-row" : "flex-col",
        className
      )}
    >
      {status ? (
        <span className="sr-only" aria-live="polite">
          {status}
        </span>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disablePrevious}
        onClick={onPrevious}
        aria-label={previousLabel}
        title={previousLabel}
        className="h-7 w-7 rounded-md border-0 bg-cyan-400 text-slate-950 shadow-sm hover:bg-cyan-300 hover:text-slate-950 disabled:bg-cyan-200/60 dark:bg-[#35D6B1] dark:text-[#0B1118] dark:hover:bg-[#58A6FF] dark:hover:text-[#0B1118] dark:disabled:bg-[#162333] dark:disabled:text-[#7F8C9A]"
      >
        <ChevronUp className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disableNext}
        onClick={onNext}
        aria-label={nextLabel}
        title={nextLabel}
        className="h-7 w-7 rounded-md border-0 bg-cyan-400 text-slate-950 shadow-sm hover:bg-cyan-300 hover:text-slate-950 disabled:bg-cyan-200/60 dark:bg-[#35D6B1] dark:text-[#0B1118] dark:hover:bg-[#58A6FF] dark:hover:text-[#0B1118] dark:disabled:bg-[#162333] dark:disabled:text-[#7F8C9A]"
      >
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
