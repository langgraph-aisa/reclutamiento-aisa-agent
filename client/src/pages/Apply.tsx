import { Button } from "@/components/ui/button";
import { AppBrand } from "@/components/AppBrand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GuatemalaPhoneInput } from "@/components/GuatemalaPhoneInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { STANDARD_WORK_SCHEDULE } from "@shared/jobPresentation";
import {
  APPLICATION_CONSENTS,
  EMPTY_APPLICATION_CONSENTS,
  PRIVACY_TERMS_LINK_TEXT,
  PRIVACY_TERMS_PATH,
  type ApplicationConsents,
} from "@shared/applicationConsent";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";

type PublicQuestion = {
  id: number;
  fieldKey: string;
  label: string;
  helpText?: string | null;
  type: string;
  required: boolean;
  answerConfig: { options?: string[]; min?: number; max?: number };
};

type PublicZone = {
  id: number;
  code: string;
  name: string;
  departmentId: number;
  departmentName: string;
};

type PublicMunicipality = {
  id: number;
  code: string;
  name: string;
};

const demoZones: PublicZone[] = Array.from({ length: 25 }, (_, index) => ({
  id: index + 1,
  code: String(index + 1),
  name: `Zona ${index + 1}`,
  departmentId: 1,
  departmentName: "Guatemala",
}));

const demoMunicipalities: PublicMunicipality[] = [
  { id: 1, code: "101", name: "Guatemala" },
  { id: 2, code: "108", name: "Mixco" },
  { id: 3, code: "115", name: "Villa Nueva" },
];

const demoForm = {
  title: "Vendedor de campo",
  department: "Comercial",
  locationLabel: "Ciudad de Guatemala · Modalidad presencial",
  description:
    "Buscamos una persona cercana, organizada y con energía para acompañar a nuestros clientes.",
  responsibilities: [
    "Atender consultas y acompañar a clientes durante el proceso comercial.",
    "Registrar el seguimiento de oportunidades y preparar cotizaciones.",
  ],
  form: {
    title: "Información de la persona postulante",
    intro:
      "Completar este formulario toma menos de 3 minutos. Sus respuestas se utilizarán únicamente para esta plaza.",
  },
  questions: [
    {
      id: 1,
      fieldKey: "vehicle",
      label: "¿Tiene licencia vigente y puede conducir un vehículo mecánico?",
      helpText: "Esta es una condición esencial para la plaza.",
      type: "select",
      required: true,
      answerConfig: { options: ["Sí", "No"] },
    },
    {
      id: 2,
      fieldKey: "experience",
      label: "¿Cuánto tiempo de experiencia tiene en ventas?",
      helpText:
        "Indique el tiempo total, aunque corresponda a diferentes empresas.",
      type: "text",
      required: true,
      answerConfig: {},
    },
    {
      id: 3,
      fieldKey: "motivation",
      label: "¿Qué le interesa de esta oportunidad?",
      helpText: "Descríbalo con sus propias palabras.",
      type: "textarea",
      required: true,
      answerConfig: {},
    },
  ] satisfies PublicQuestion[],
};

export default function Apply() {
  const [, params] = useRoute("/apply/:token");
  const token = params?.token ?? "demo-vendedor";
  const isDemo = token === "demo-vendedor";
  const formQuery = trpc.publicJobs.getByToken.useQuery(
    { token },
    { enabled: !isDemo }
  );
  const zonesQuery = trpc.geo.zones.useQuery(undefined, { enabled: !isDemo });
  const submitMutation = trpc.publicJobs.submit.useMutation();
  const form = (isDemo ? demoForm : formQuery.data) as
    | (typeof demoForm & { questions: PublicQuestion[] })
    | null;
  const [step, setStep] = useState<"intro" | "form" | "success">("intro");
  const [values, setValues] = useState<Record<string, string>>({});
  const [contact, setContact] = useState({
    fullName: "",
    phone: "",
    email: "",
  });
  const [location, setLocation] = useState({
    zoneId: 0,
    departmentId: 0,
    municipalityId: 0,
  });
  const [consents, setConsents] = useState<ApplicationConsents>({
    ...EMPTY_APPLICATION_CONSENTS,
  });
  const [error, setError] = useState("");
  const questions = useMemo(() => form?.questions ?? [], [form]);
  const zones = (isDemo ? demoZones : (zonesQuery.data ?? [])) as PublicZone[];
  const selectedZone = zones.find(zone => zone.id === location.zoneId);
  const municipalitiesQuery = trpc.geo.municipalities.useQuery(
    { departmentId: location.departmentId || 1 },
    { enabled: !isDemo && location.departmentId > 0 }
  );
  const municipalities = (
    isDemo ? demoMunicipalities : (municipalitiesQuery.data ?? [])
  ) as PublicMunicipality[];

  const update = (key: string, value: string) =>
    setValues(current => ({ ...current, [key]: value }));
  const send = async () => {
    setError("");
    if (!contact.fullName.trim() || !contact.phone.trim()) {
      setError("Escriba su nombre y teléfono para continuar.");
      return;
    }
    if (
      !location.zoneId ||
      !location.departmentId ||
      !location.municipalityId
    ) {
      setError("Seleccione zona, departamento y municipio para continuar.");
      return;
    }
    const missing = questions.find(
      question =>
        question.required && !String(values[question.fieldKey] ?? "").trim()
    );
    if (missing) {
      setError(`Complete la pregunta: ${missing.label}`);
      return;
    }
    if (!APPLICATION_CONSENTS.every(consent => consents[consent.id])) {
      setError(
        "Marque las tres confirmaciones obligatorias para enviar su postulación."
      );
      return;
    }
    if (isDemo) {
      setStep("success");
      return;
    }
    try {
      const result = await submitMutation.mutateAsync({
        token,
        ...contact,
        location,
        consents,
        answers: values,
      });
      if (result.alreadyApplied) {
        setError(result.message);
        return;
      }
      setStep("success");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "No fue posible enviar su postulación. Inténtelo nuevamente."
      );
    }
  };

  if (!form && formQuery.isLoading) return <Loading />;
  if (!form)
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <Card className="max-w-md rounded-3xl border-0 p-4 shadow-soft">
          <CardContent className="pt-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-amber-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h1 className="mt-5 text-2xl font-800 text-primary">
              Este enlace ya no está disponible
            </h1>
            <p className="mt-3 text-muted-foreground">
              La plaza pudo haber sido cerrada o el enlace no es válido.
            </p>
          </CardContent>
        </Card>
      </main>
    );

  return (
    <main className="min-h-screen bg-background px-4 py-5 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/">
            <AppBrand className="h-10" />
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground sm:block">
              Postulación segura
            </span>
            <ThemeToggle />
          </div>
        </header>
        {step === "intro" && (
          <Card className="overflow-hidden rounded-[2rem] border-0 shadow-lift">
            <div className="bg-primary p-7 text-white dark:bg-[#162333] sm:p-10">
              <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-200">
                Plaza disponible
              </p>
              <h1 className="mt-3 text-4xl font-800 tracking-[-.05em] sm:text-5xl">
                {form.title}
              </h1>
              <div className="mt-5 flex flex-wrap gap-4 text-sm text-white/70">
                <span className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-emerald-300" />
                  {form.locationLabel ?? form.department ?? "Guatemala"}
                </span>
                <span className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-emerald-300" />
                  {STANDARD_WORK_SCHEDULE}
                </span>
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                  Enlace verificado
                </span>
              </div>
            </div>
            <CardContent className="p-7 sm:p-10">
              <h2 className="text-xl font-800 uppercase tracking-[.08em] text-primary">
                RESPONSABILIDADES DEL PUESTO
              </h2>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                {form.responsibilities.map((responsibility, index) => (
                  <li key={`${index}-${responsibility}`} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-[.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600"
                    />
                    <span>{responsibility}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                <strong>Esta aplicación corresponde a:</strong> {form.title}. Al
                enviarla, quedará registrada para esta plaza y no será necesario
                repetirla.
              </div>
              <Button
                onClick={() => setStep("form")}
                size="lg"
                className="mt-8 w-full rounded-2xl"
              >
                Comenzar formulario <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}
        {step === "form" && (
          <Card className="rounded-[2rem] border-0 shadow-soft">
            <CardHeader className="p-7 pb-4 sm:p-10 sm:pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
                    Paso único · {form.title}
                  </p>
                  <CardTitle className="mt-3 text-3xl font-800 tracking-[-.04em] text-primary">
                    {form.form.title}
                  </CardTitle>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {form.form.intro}
                  </p>
                </div>
                <div className="hidden rounded-2xl bg-secondary p-3 text-secondary-foreground sm:block">
                  <ClipboardIcon />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-7 p-7 pt-4 sm:p-10 sm:pt-5">
              <div className="grid gap-5 border-b border-border/70 pb-7 sm:grid-cols-2">
                <Field label="Nombre completo" required>
                  <Input
                    value={contact.fullName}
                    onChange={event =>
                      setContact({ ...contact, fullName: event.target.value })
                    }
                    placeholder="Su nombre y apellidos"
                  />
                </Field>
                <Field label="Teléfono móvil" required>
                  <GuatemalaPhoneInput
                    value={contact.phone}
                    onChange={phone => setContact({ ...contact, phone })}
                  />
                </Field>
                <div className="grid gap-5 sm:col-span-2 sm:grid-cols-3">
                  <Field label="Zona" required>
                    <select
                      aria-label="Zona de residencia"
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      value={location.zoneId || ""}
                      onChange={event => {
                        const zoneId = Number(event.target.value);
                        const zone = zones.find(item => item.id === zoneId);
                        setLocation({
                          zoneId,
                          departmentId: zone?.departmentId ?? 0,
                          municipalityId: 0,
                        });
                      }}
                      disabled={zonesQuery.isLoading}
                      required
                    >
                      <option value="">Seleccione una zona</option>
                      {zones.map(zone => (
                        <option key={zone.id} value={zone.id}>
                          {zone.code}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Departamento" required>
                    <Input
                      value={selectedZone?.departmentName ?? ""}
                      aria-label="Departamento de residencia"
                      readOnly
                    />
                  </Field>
                  <Field label="Municipio" required>
                    <select
                      aria-label="Municipio de residencia"
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      value={location.municipalityId || ""}
                      onChange={event =>
                        setLocation(current => ({
                          ...current,
                          municipalityId: Number(event.target.value),
                        }))
                      }
                      disabled={
                        !location.departmentId || municipalitiesQuery.isLoading
                      }
                      required
                    >
                      <option value="">Seleccione un municipio</option>
                      {municipalities.map(municipality => (
                        <option key={municipality.id} value={municipality.id}>
                          {municipality.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
              <Field label="Correo electrónico">
                <Input
                  value={contact.email}
                  onChange={event =>
                    setContact({ ...contact, email: event.target.value })
                  }
                  placeholder="correo@ejemplo.com"
                  type="email"
                />
              </Field>
              {questions.map(question => (
                <Field
                  key={question.fieldKey}
                  label={question.label}
                  required={question.required}
                  help={question.helpText}
                >
                  <QuestionControl
                    question={question}
                    value={values[question.fieldKey] ?? ""}
                    onChange={value => update(question.fieldKey, value)}
                  />
                </Field>
              ))}
              <fieldset className="rounded-2xl border border-border bg-secondary/45 p-4 sm:p-5">
                <legend className="px-2 text-sm font-800 text-primary">
                  Confirmaciones obligatorias
                </legend>
                <div className="space-y-2">
                  {APPLICATION_CONSENTS.map(consent => {
                    const checkboxId = `consent-${consent.id}`;
                    return (
                      <label
                        key={consent.id}
                        htmlFor={checkboxId}
                        className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 text-sm leading-5 text-foreground transition-colors hover:bg-accent/55 focus-within:bg-accent/55"
                      >
                        <Checkbox
                          id={checkboxId}
                          className="mt-0.5 size-5"
                          checked={consents[consent.id]}
                          onCheckedChange={checked => {
                            setConsents(current => ({
                              ...current,
                              [consent.id]: checked === true,
                            }));
                            setError("");
                          }}
                          aria-required="true"
                          aria-invalid={Boolean(error) && !consents[consent.id]}
                        />
                        <span>
                          {consent.id === "privacyAccepted" ? (
                            <>
                              He leído el Aviso de{" "}
                              <a
                                href={PRIVACY_TERMS_PATH}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={event => event.stopPropagation()}
                                className="font-semibold text-sky-700 underline decoration-sky-500/70 underline-offset-4 hover:text-sky-800 dark:text-[#58a6ff] dark:hover:text-[#8bc2ff]"
                                aria-label={`${PRIVACY_TERMS_LINK_TEXT} (se abre en una pestaña nueva)`}
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
                    );
                  })}
                </div>
              </fieldset>
              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-800"
                >
                  {error}
                </div>
              )}
              <Button
                onClick={send}
                disabled={submitMutation.isPending}
                size="lg"
                className="w-full rounded-2xl"
              >
                {submitMutation.isPending ? "Enviando…" : "Enviar formulario"}
              </Button>
            </CardContent>
          </Card>
        )}
        {step === "success" && (
          <Card className="rounded-[2rem] border-0 shadow-lift">
            <CardContent className="p-8 text-center sm:p-12">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h1 className="mt-6 text-3xl font-800 tracking-[-.04em] text-primary">
                Su postulación fue enviada
              </h1>
              <p className="mx-auto mt-4 max-w-md leading-7 text-muted-foreground">
                Gracias por postularse a la plaza de {form.title}. Revisaremos
                sus respuestas y nos pondremos en contacto con usted por
                WhatsApp si avanza a la siguiente fase.
              </p>
              <div className="mt-8 rounded-2xl bg-secondary p-4 text-sm text-secondary-foreground">
                Mantenga su teléfono disponible. No necesita completar
                nuevamente este formulario.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

function QuestionControl({
  question,
  value,
  onChange,
}: {
  question: PublicQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  if (question.type === "textarea")
    return (
      <Textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Escriba su respuesta"
        rows={4}
      />
    );
  if (question.type === "select")
    return (
      <select
        className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={value}
        onChange={event => onChange(event.target.value)}
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
      />
    );
  if (question.type === "phone")
    return <GuatemalaPhoneInput value={value} onChange={onChange} />;
  return (
    <Input
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder="Escriba su respuesta"
    />
  );
}

function Field({
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

function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-2xl bg-primary/15" />
        <p className="mt-4 text-sm text-muted-foreground">
          Cargando formulario…
        </p>
      </div>
    </main>
  );
}

function ClipboardIcon() {
  return (
    <div className="h-5 w-5 rounded border-2 border-current">
      <div className="mx-auto -mt-1 h-1.5 w-2/3 rounded bg-secondary" />
    </div>
  );
}
