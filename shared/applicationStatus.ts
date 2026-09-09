export const APPLICATION_STATUS_VALUES = [
  "en_revision",
  "pre_calificado",
  "calificado",
  "calificado_aisa",
  "no_calificado",
  "entrevista_iniciada",
  "entrevista_en_curso",
  "entrevista_finalizada",
  "pendiente_revision_humana",
  "error_procesamiento",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUS_VALUES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  en_revision: "En revisión",
  pre_calificado: "Pre-calificado",
  calificado: "Solicitar CV por WhatsApp",
  calificado_aisa: "Calificado por AISA",
  no_calificado: "No calificado",
  entrevista_iniciada: "Entrevista iniciada",
  entrevista_en_curso: "Entrevista en curso",
  entrevista_finalizada: "Entrevista finalizada",
  pendiente_revision_humana: "Pendiente de revisión humana",
  error_procesamiento: "Error de procesamiento",
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
