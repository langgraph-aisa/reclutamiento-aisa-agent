import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GuatemalaPhoneInput } from "@/components/GuatemalaPhoneInput";
import {
  PublicField as Field,
  QuestionControl,
  type PublicQuestion,
} from "@/components/PublicQuestionField";
import { trpc } from "@/lib/trpc";
import {
  APPLICATION_CONSENTS,
  PRIVACY_TERMS_LINK_TEXT,
  PRIVACY_TERMS_PATH,
} from "@shared/applicationConsent";
import { STANDARD_WORK_SCHEDULE } from "@shared/jobPresentation";
import { AlertTriangle, Check, Copy, Clock3, MapPin, ShieldCheck } from "lucide-react";

/**
 * Vista previa administrativa del formulario público.
 *
 * Fenomenología: la persona administradora observa exactamente el mismo
 * formulario que verá el candidato —mismas preguntas, mismos controles, mismo
 * orden— sin publicar, sin enviar y sin tocar la infraestructura de evaluación.
 * La previsualización es de solo lectura: no crea candidatos ni respuestas.
 */
export function PublicFormPreview({
  formId,
  open,
  onOpenChange,
}: {
  formId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const preview = trpc.forms.getPreview.useQuery(
    { id: formId ?? 0 },
    { enabled: open && Boolean(formId) }
  );

  const data = preview.data;
  const questions = (data?.questions ?? []) as PublicQuestion[];
  const publicUrl =
    data?.publicPath && typeof window !== "undefined"
      ? `${window.location.origin}${data.publicPath}`
      : "";

  const copyLink = async () => {
    if (!publicUrl) return;
    await navigator.clipboard?.writeText(publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-primary">
            Vista previa pública del formulario
          </DialogTitle>
          <DialogDescription>
            Así verá el candidato este formulario con su enlace seguro. La
            previsualización no publica, no envía y no crea registros.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading && (
          <p className="text-sm text-muted-foreground">Cargando vista previa…</p>
        )}
        {!preview.isLoading && !data && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            No fue posible cargar este formulario. Actualice el listado e
            inténtelo de nuevo.
          </p>
        )}
        {data && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className="rounded-full bg-sky-100 text-sky-800">
                {data.form.title}
              </Badge>
              <Badge className="rounded-full bg-violet-100 text-violet-800">
                Versión {data.form.version ?? "—"}
              </Badge>
              <Badge
                className={
                  data.published
                    ? "rounded-full bg-emerald-100 text-emerald-800"
                    : "rounded-full bg-amber-100 text-amber-800"
                }
              >
                {data.published ? "Interruptor encendido" : "Interruptor apagado"}
              </Badge>
            </div>
            {!data.published && (
              <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                El enlace público no estará disponible mientras el interruptor
                del formulario permanezca apagado.
              </p>
            )}
            {!data.positionPublished && (
              <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                La plaza no está publicada: el enlace tampoco estará disponible
                para el candidato.
              </p>
            )}
            <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 p-3">
              <span className="truncate text-xs text-muted-foreground">
                {publicUrl || "Enlace no disponible"}
              </span>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={copyLink}
                  disabled={!publicUrl}
                >
                  {copied ? (
                    <Check className="mr-2 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-2 h-3.5 w-3.5" />
                  )}
                  {copied ? "Copiado" : "Copiar enlace"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={!publicUrl}
                  onClick={() =>
                    window.open(
                      publicUrl,
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                >
                  Abrir enlace
                </Button>
              </div>
            </div>

            <div
              aria-label="Vista previa del formulario público"
              className="rounded-2xl border border-border/70 bg-background p-3"
            >
              <div className="rounded-2xl bg-primary p-5 text-white dark:bg-[#162333]">
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-200">
                  Plaza disponible
                </p>
                <p className="mt-2 text-2xl font-800 tracking-[-.04em]">
                  {data.position.title}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/70">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-emerald-300" />
                    {data.position.locationLabel ??
                      data.position.department ??
                      "Guatemala"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5 text-emerald-300" />
                    {STANDARD_WORK_SCHEDULE}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                    Enlace verificado
                  </span>
                </div>
              </div>
              <div className="space-y-5 p-4">
                {data.position.responsibilities.length > 0 && (
                  <div>
                    <p className="text-sm font-800 uppercase tracking-[.08em] text-primary">
                      RESPONSABILIDADES DEL PUESTO
                    </p>
                    <ul className="mt-2 space-y-1.5 text-sm leading-6 text-muted-foreground">
                      {data.position.responsibilities.map(
                        (responsibility: string, index: number) => (
                          <li
                            key={`${index}-${responsibility}`}
                            className="flex gap-2"
                          >
                            <span
                              aria-hidden="true"
                              className="mt-[.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600"
                            />
                            <span>{responsibility}</span>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}
                <div className="rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-950">
                  <strong>Esta aplicación corresponde a:</strong>{" "}
                  {data.position.title}. Al enviarla, quedará registrada para esta
                  plaza y no será necesario repetirla.
                </div>
                <Card className="rounded-2xl border-0 shadow-none">
                  <CardHeader className="p-0">
                    <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-700">
                      Paso único · {data.position.title}
                    </p>
                    <CardTitle className="mt-2 text-xl font-800 tracking-[-.03em] text-primary">
                      {data.form.title}
                    </CardTitle>
                    {data.form.intro && (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {data.form.intro}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="mt-4 space-y-4 p-0">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Nombre completo" required>
                        <Input disabled placeholder="Su nombre y apellidos" />
                      </Field>
                      <Field label="Teléfono móvil" required>
                        <GuatemalaPhoneInput
                          value=""
                          onChange={() => undefined}
                          disabled
                        />
                      </Field>
                    </div>
                    {questions.map(question => (
                      <Field
                        key={question.id}
                        label={question.label}
                        required={question.required}
                        help={question.helpText}
                      >
                        <QuestionControl
                          question={question}
                          value=""
                          onChange={() => undefined}
                          disabled
                        />
                      </Field>
                    ))}
                    <fieldset className="rounded-2xl border border-border bg-secondary/45 p-4">
                      <legend className="px-2 text-sm font-800 text-primary">
                        Confirmaciones obligatorias
                      </legend>
                      <div className="space-y-2">
                        {APPLICATION_CONSENTS.map(consent => (
                          <label
                            key={consent.id}
                            className="flex items-start gap-3 text-xs leading-5 text-foreground"
                          >
                            <Checkbox className="mt-0.5 size-4" disabled />
                            <span>
                              {consent.id === "privacyAccepted" ? (
                                <>
                                  He leído el Aviso de{" "}
                                  <a
                                    href={PRIVACY_TERMS_PATH}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-semibold text-sky-700 underline decoration-sky-500/70 underline-offset-4 dark:text-[#58a6ff]"
                                  >
                                    {PRIVACY_TERMS_LINK_TEXT}
                                  </a>{" "}
                                  y autorizo a AISA a tratar mis datos para fines
                                  relacionados con este proceso de selección.
                                </>
                              ) : (
                                consent.text
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <Button type="button" className="w-full rounded-2xl" disabled>
                      Enviar formulario
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
