import { GuatemalaPhoneInput } from "@/components/GuatemalaPhoneInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Campo público del formulario.
 *
 * Ontología: la pregunta se define una sola vez —en el constructor— y aquí se
 * representa tanto en la postulación real como en la vista previa administrativa,
 * de modo que «cómo se ve públicamente» no sea una segunda interpretación del
 * mismo dato. Esa única fuente evita divergencias entre lo que se valida y lo
 * que el candidato realmente ve.
 */
export type PublicQuestion = {
  id: number;
  fieldKey: string;
  label: string;
  helpText?: string | null;
  type: string;
  required: boolean;
  answerConfig: { options?: string[]; min?: number; max?: number };
};

export function PublicField({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-primary">
        {label}
        {required && <span className="ml-1 text-emerald-700">*</span>}
      </Label>
      {help && (
        <p className="text-xs leading-5 text-muted-foreground">{help}</p>
      )}
      {children}
    </div>
  );
}

export function QuestionControl({
  question,
  value,
  onChange,
  disabled = false,
}: {
  question: PublicQuestion;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (question.type === "textarea")
    return (
      <Textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Escriba su respuesta"
        rows={4}
        disabled={disabled}
      />
    );
  if (question.type === "select")
    return (
      <select
        className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">Seleccione una opción</option>
        {(question.answerConfig.options ?? []).map(option => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  if (question.type === "number")
    return (
      <Input
        type="number"
        inputMode="decimal"
        min={question.answerConfig.min}
        max={question.answerConfig.max}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Escriba un valor"
        disabled={disabled}
      />
    );
  if (question.type === "phone")
    return (
      <GuatemalaPhoneInput value={value} onChange={onChange} disabled={disabled} />
    );
  return (
    <Input
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder="Escriba su respuesta"
      disabled={disabled}
    />
  );
}
