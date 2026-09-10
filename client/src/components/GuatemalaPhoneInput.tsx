import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { guatemalaLocalPhoneDigits } from "@shared/phone";

export function GuatemalaPhoneInput({
  value,
  onChange,
  className,
  ariaLabel = "Número de teléfono móvil de Guatemala",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg"
        aria-hidden="true"
      >
        🇬🇹
      </span>
      <Input
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        className={cn("pl-12", className)}
        value={value}
        onChange={event =>
          onChange(guatemalaLocalPhoneDigits(event.target.value))
        }
      />
    </div>
  );
}
