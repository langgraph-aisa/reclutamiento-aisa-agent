import {
  ACTIVITY_SUMMARY_WORD_LIMIT,
  ACTIVITY_TITLE_WORD_LIMIT,
} from "./agentConfig";

export const ADMIN_PAGE_LABELS: Record<string, string> = {
  "/admin": "Resumen",
  "/admin/inbox": "Bandeja de entrada",
  "/admin/human-review": "Revisión Humana",
  "/admin/candidates": "Candidatos",
  "/admin/jobs": "Plazas y anuncios",
  "/admin/profiles": "Perfiles laborales",
  "/admin/assessments": "Pruebas psicométricas",
  "/admin/reports": "Informes",
  "/admin/mst-eir": "Administrador de Proyectos",
  "/admin/project-storage": "Custodia de proyectos",
  "/admin/agent-evaluator": "Agente de IA LangGraph",
  "/admin/agent-stages": "Etapas de la IA",
  "/admin/apichat-audit": "Auditoría de ApiChat",
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

/**
 * Hojas donde se dibuja el resumen de actividad y control ISO.
 *
 * La cajilla informa lo último registrado en la ruta y abre el control ISO: se
 * conserva donde el registro se administra, se audita o se configura, y se
 * retira de las hojas de operación —bandeja, plazas, perfiles, candidatos,
 * revisión humana, pruebas y «Mi cuenta»—, donde competía con el trabajo y
 * repetía en cada vista una lectura que no cambia la decisión. La apertura de la
 * vista se sigue registrando en todas: la cajilla es la lectura, no la bitácora.
 */
export const ACTIVITY_SUMMARY_PATHS = [
  "/admin/security-roles",
  "/admin/users",
  "/admin/config",
  "/admin/apichat-audit",
  "/admin/agent-evaluator",
  "/admin/governance",
  "/admin/activity",
  "/admin/project-storage",
  "/admin/reports",
] as const;

/** Resuelve si la ruta administrada dibuja el resumen de actividad. */
export function showsActivitySummary(path: string) {
  return (ACTIVITY_SUMMARY_PATHS as readonly string[]).includes(
    normalizeAdminPath(path)
  );
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
  "/admin/mst-eir": "Proyectos",
  "/admin/agent-evaluator": "Agente-IA",
  "/admin/agent-stages": "Etapas-IA",
  "/admin/activity": "Actividad",
  "/admin/config": "Configuración",
  "/admin/users": "Usuarios",
  "/admin/account": "Cuenta",
};

function titlePageToken(pagePath: string) {
  return TITLE_PAGE_TOKEN[normalizeAdminPath(pagePath)] ?? "Administración";
}

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
  endpoints_updated: "endpoints actualizados",
  preferences_updated: "preferencias actualizadas",
  jarvi_responsible_assigned: "responsable asignado",
  inbox_human_takeover: "control transferido",
  inbox_agent_resumed: "agente reanudado",
  inbox_message_deleted: "mensaje de bandeja eliminado",
  inbox_message_provider_delete_failed: "borrado del proveedor pendiente",
  agent_salary_expectation_captured: "expectativa salarial registrada",
  public_copy_editorially_normalized: "texto normalizado",
  project_created: "proyecto creado",
  project_updated: "proyecto actualizado",
  project_deleted: "proyecto eliminado",
  folder_created: "carpeta creada",
  folder_deleted: "carpeta eliminada",
  file_uploaded: "archivo cargado",
  file_deleted: "archivo eliminado",
  file_moved: "archivo movido",
  file_analysis_updated: "análisis actualizado",
  knowledge_settings_updated: "configuración de conocimiento actualizada",
  project_positions_updated: "vinculación de plazas actualizada",
  position_projects_updated: "proyectos vinculados actualizados",
};

export function activityActionLabel(action: string) {
  return ACTIVITY_ACTION_LABELS[action] ?? "operación registrada";
}

/**
 * Título asertivo y técnico de máximo 11 palabras: describe la contribución del
 * actor al módulo y a la configuración o registro afectado, sin fórmulas fijas.
 */
export function activityTitle(
  actorLabel: string,
  action: string,
  pagePath: string
) {
  const actor = actorLabel.trim() || "Usuario registrado";
  const module = adminPageLabel(pagePath);
  const label = activityActionLabel(action);
  const title = `Contribución de ${actor} al módulo ${module} y ${label}`;
  const words = title.trim().split(/\s+/).filter(Boolean);
  return words.length <= ACTIVITY_TITLE_WORD_LIMIT
    ? title
    : words.slice(0, ACTIVITY_TITLE_WORD_LIMIT).join(" ");
}

/**
 * Resumen técnico de exactamente 33 palabras: describe la acción del usuario y
 * su afectación, sin exponer datos privados ni credenciales.
 */
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
    `${actorReference} ejecutó ${activityActionLabel(input.action)} en ${titlePageToken(input.pagePath)}. Talento AISA registró fecha, hora, resultado y correlación técnica sin copiar datos privados, credenciales, teclas, respuestas ni contenido confidencial. Resultado final: ${outcome} con trazabilidad institucional vigente verificable.`,
    ACTIVITY_SUMMARY_WORD_LIMIT
  );
}
