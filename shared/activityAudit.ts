import {
  ACTIVITY_SUMMARY_WORD_LIMIT,
  ACTIVITY_TITLE_WORD_LIMIT,
} from "./agentConfig";

export const ADMIN_PAGE_LABELS: Record<string, string> = {
  "/admin": "Resumen",
  "/admin/inbox": "Bandeja de entrada",
  "/admin/human-review": "Revisión Humana",
  "/admin/candidates": "Candidatos",
  "/admin/jobs": "Plazas y formularios",
  "/admin/profiles": "Perfiles laborales",
  "/admin/assessments": "Pruebas psicométricas",
  "/admin/reports": "Informes",
  "/admin/mst-eir": "MST-EIR",
  "/admin/agent-evaluator": "Agente de IA LangGraph",
  "/admin/activity": "Actividad y control ISO",
  "/admin/config": "Configuración",
  "/admin/users": "Usuarios",
  "/admin/account": "Mi cuenta",
};

export type ActivityOutcome =
  | "guardado"
  | "configuracion"
  | "trabajando"
  | "error";

export const ACTIVITY_OUTCOME_LABELS: Record<ActivityOutcome, string> = {
  guardado: "Guardado",
  configuracion: "Cambio de configuración",
  trabajando: "Trabajando",
  error: "Error controlado",
};

export function normalizeAdminPath(path: string) {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/admin";
  if (/^\/admin\/forms\/\d+$/.test(pathname)) return "/admin/jobs";
  if (ADMIN_PAGE_LABELS[pathname]) return pathname;
  return pathname.startsWith("/admin/") ? pathname : "/admin";
}

export function adminPageLabel(path: string) {
  const normalized = normalizeAdminPath(path);
  return ADMIN_PAGE_LABELS[normalized] ?? "Administración";
}

export function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function exactWordCount(value: string, expected: number) {
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, expected);
  const padding = [
    "con",
    "evidencia",
    "operativa",
    "trazable",
    "vigente",
    "institucional",
  ];
  while (words.length < expected) {
    words.push(padding[words.length % padding.length]);
  }
  return words.join(" ");
}

const TITLE_PAGE_TOKEN: Record<string, string> = {
  "/admin": "Resumen",
  "/admin/inbox": "Bandeja",
  "/admin/human-review": "Revisión-Humana",
  "/admin/candidates": "Candidatos",
  "/admin/jobs": "Plazas",
  "/admin/profiles": "Perfiles",
  "/admin/assessments": "Pruebas",
  "/admin/reports": "Informes",
  "/admin/mst-eir": "MST-EIR",
  "/admin/agent-evaluator": "Agente-IA",
  "/admin/activity": "Actividad",
  "/admin/config": "Configuración",
  "/admin/users": "Usuarios",
  "/admin/account": "Cuenta",
};

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  page_opened: "apertura autorizada",
  work_started: "trabajo iniciado",
  protocol_saved: "protocolo guardado",
  protocol_activated: "protocolo activado",
  protocol_delete_code_sent: "código de borrado enviado",
  protocol_deleted: "versión eliminada",
  assessment_item_saved: "pregunta guardada",
  assessment_items_reordered: "preguntas reordenadas",
  credential_rotated: "credencial rotada",
  credential_removed: "credencial retirada",
  preferences_updated: "preferencias actualizadas",
  jarvi_responsible_assigned: "responsable asignado",
  inbox_human_takeover: "control transferido",
  inbox_agent_resumed: "agente reanudado",
  agent_salary_expectation_captured: "expectativa salarial registrada",
  public_copy_editorially_normalized: "texto normalizado",
};

export function activityActionLabel(action: string) {
  return ACTIVITY_ACTION_LABELS[action] ?? "operación registrada";
}

function titlePageToken(pagePath: string) {
  return TITLE_PAGE_TOKEN[normalizeAdminPath(pagePath)] ?? "Administración";
}

export function activityTitle(action: string, pagePath: string) {
  return exactWordCount(
    `Control ISO registró ${activityActionLabel(action)} en ${titlePageToken(pagePath)} para Talento AISA hoy`,
    ACTIVITY_TITLE_WORD_LIMIT
  );
}

export function activitySummary(input: {
  actorLabel: string;
  action: string;
  pagePath: string;
  outcome: ActivityOutcome;
}) {
  const actorReference = input.actorLabel === "JARVI HR"
    ? "JARVI HR"
    : input.actorLabel.startsWith("Sistema")
      ? "Sistema AISA"
      : "Usuario autorizado";
  const outcome = input.outcome === "configuracion"
    ? "Configuración"
    : input.outcome === "error"
      ? "Error"
      : ACTIVITY_OUTCOME_LABELS[input.outcome];
  return exactWordCount(
    `${actorReference} ejecutó ${activityActionLabel(input.action)} en ${titlePageToken(input.pagePath)}. Talento AISA registró fecha, hora, resultado, origen y correlación técnica sin copiar datos privados, credenciales, teclas, respuestas ni contenido confidencial. Resultado final: ${outcome} con trazabilidad institucional vigente verificable.`,
    ACTIVITY_SUMMARY_WORD_LIMIT
  );
}
