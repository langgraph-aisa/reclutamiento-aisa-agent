import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";

/**
 * Campo de credencial con su estado verificado.
 *
 * Vive en un módulo compartido porque la misma pieza administra la credencial
 * propia en «Mi cuenta» y la de plataforma en «Configuración»: duplicarla haría
 * divergir el manejo del enmascarado y de la confirmación entre dos hojas que
 * deben comportarse igual.
 */
export function CredentialField({
  label,
  description,
  placeholder,
  state,
  pending,
  onSave,
  onRemove,
  onVerify,
  secret = true,
}: {
  label: string;
  description: string;
  placeholder: string;
  state?: { configured: boolean; masked: string | null };
  pending: boolean;
  /**
   * Cuando el valor no es un secreto —una dirección pública, por ejemplo— el
   * campo se muestra legible: enmascararlo impediría al operador comprobar cuál
   * está vigente sin retirarlo y volverlo a escribir.
   */
  secret?: boolean;
  onSave: (value: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onVerify?: () => void;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="font-semibold text-primary">{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge
          variant="outline"
          className={
            state?.configured
              ? "rounded-full border-emerald-300 text-emerald-700"
              : "rounded-full"
          }
        >
          {state?.configured ? "Configurada" : "Pendiente"}
        </Badge>
      </div>
      {state?.configured && (
        <p className="rounded-xl bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
          {state.masked}
        </p>
      )}
      <div className="relative">
        <Input
          type={secret && !visible ? "password" : "text"}
          value={value}
          onChange={event => setValue(event.target.value)}
          className="rounded-xl pr-10 font-mono text-xs"
          autoComplete={secret ? "new-password" : "off"}
          placeholder={
            state?.configured ? "Ingrese una nueva para rotar" : placeholder
          }
        />
        {secret && (
          <button
            type="button"
            className="absolute right-3 top-2.5 text-muted-foreground hover:text-primary"
            onClick={() => setVisible(current => !current)}
            aria-label={visible ? `Ocultar ${label}` : `Mostrar ${label}`}
          >
            {visible ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={pending || value.trim().length < 3}
          onClick={async () => {
            if (await onSave(value.trim())) {
              setValue("");
              setVisible(false);
            }
          }}
        >
          <Save className="mr-2 h-3.5 w-3.5" /> Guardar
        </Button>
        {onVerify && state?.configured && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={onVerify}
          >
            <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Verificar
          </Button>
        )}
        {state?.configured && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => void onRemove()}
            aria-label={`Eliminar ${label}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
