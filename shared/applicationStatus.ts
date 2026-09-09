export const APPLICATION_STATUS_VALUES = [
  "en_revision",
  "pre_calificado_prioritario",
  "pre_calificado",
  "pre_calificado_condicionado",
  "pendiente_revision_humana",
  "no_calificado",
  "calificado",
  "calificado_aisa",
  "entrevista_iniciada",
  "entrevista_en_curso",
  "entrevista_finalizada",
  "error_procesamiento",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUS_VALUES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  en_revision: "En revisión",
  pre_calificado_prioritario: "Precalificado prioritario",
  pre_calificado: "Precalificado",
  pre_calificado_condicionado: "Precalificado condicionado",
  pendiente_revision_humana: "Revisión humana",
  no_calificado: "No precalificado",
  calificado: "Solicitar CV por WhatsApp",
  calificado_aisa: "Calificado por AISA",
  entrevista_iniciada: "Entrevista iniciada",
  entrevista_en_curso: "Entrevista en curso",
  entrevista_finalizada: "Entrevista finalizada",
  error_procesamiento: "Error de procesamiento",
};

export type ApplicationStatusTone =
  | "neutral"
  | "priority"
  | "positive"
  | "conditional"
  | "review"
  | "negative"
  | "interview"
  | "error";

const APPLICATION_STATUS_TONES: Record<
  ApplicationStatus,
  ApplicationStatusTone
> = {
  en_revision: "neutral",
  pre_calificado_prioritario: "priority",
  pre_calificado: "positive",
  pre_calificado_condicionado: "conditional",
  pendiente_revision_humana: "review",
  no_calificado: "negative",
  calificado: "positive",
  calificado_aisa: "priority",
  entrevista_iniciada: "interview",
  entrevista_en_curso: "interview",
  entrevista_finalizada: "interview",
  error_procesamiento: "error",
};

export const APPLICATION_STATUS_OPTIONS = APPLICATION_STATUS_VALUES.map(
  value => ({ value, label: APPLICATION_STATUS_LABELS[value] })
);

export function applicationStatusLabel(value: string | null | undefined) {
  if (!value) return "—";
  return (
    APPLICATION_STATUS_LABELS[value as ApplicationStatus] ??
    value.replaceAll("_", " ")
  );
}

export function applicationStatusTone(
  value: string | null | undefined
): ApplicationStatusTone {
  return APPLICATION_STATUS_TONES[value as ApplicationStatus] ?? "neutral";
}
