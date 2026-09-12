import { ACTIVITY_TITLE_WORD_LIMIT } from "./agentConfig";

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
  inbox_message_deleted: "mensaje de bandeja eliminado",
  inbox_message_provider_delete_failed: "borrado del proveedor pendiente",
  agent_salary_expectation_captured: "expectativa salarial registrada",
  public_copy_editorially_normalized: "texto normalizado",
};

export function activityActionLabel(action: string) {
  return ACTIVITY_ACTION_LABELS[action] ?? "operación registrada";
}

function titlePageToken(pagePath: string) {
  return TITLE_PAGE_TOKEN[normalizeAdminPath(pagePath)] ?? "Administración";
}

/**
 * Título asertivo y técnico de máximo 11 palabras: resume únicamente la acción
 * del usuario y menciona el módulo afectado o consultado, sin fórmulas fijas.
 */
export function activityTitle(action: string, pagePath: string) {
  const label = activityActionLabel(action);
  const title = `${label.charAt(0).toUpperCase()}${label.slice(1)} en ${titlePageToken(pagePath)}`;
  const words = title.trim().split(/\s+/).filter(Boolean);
  return words.length <= ACTIVITY_TITLE_WORD_LIMIT
    ? title
    : words.slice(0, ACTIVITY_TITLE_WORD_LIMIT).join(" ");
}
