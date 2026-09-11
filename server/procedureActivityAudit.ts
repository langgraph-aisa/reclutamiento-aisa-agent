import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getPool } from "./db";

export type ProcedureActivityTerminalResult = "completed" | "failed";

type ProcedureActivityInput = {
  actorUserId: number;
  procedurePath: string;
  terminalResult: ProcedureActivityTerminalResult;
  startedAt: Date;
  correlationId?: string;
};

type ActivityQueryable = Pick<Pool, "query">;
type PoolProvider = () => Promise<ActivityQueryable | null>;

const CONFIGURATION_NAMESPACES = new Set([
  "activity",
  "agent",
  "config",
  "geo",
  "mstEir",
  "users",
]);

const PAGE_BY_NAMESPACE: Record<string, string> = {
  activity: "/admin/activity",
  agent: "/admin/agent-evaluator",
  assessments: "/admin/assessments",
  candidates: "/admin/human-review",
  config: "/admin/config",
  dashboard: "/admin",
  forms: "/admin/jobs",
  geo: "/admin/config",
  inbox: "/admin/inbox",
  mstEir: "/admin/mst-eir",
  positions: "/admin/jobs",
  profiles: "/admin/profiles",
  reports: "/admin/reports",
  users: "/admin/users",
};

function normalizedProcedurePath(path: string) {
  const normalized = path.trim();
  return /^[A-Za-z0-9_.-]+$/.test(normalized)
    ? normalized.slice(0, 160)
    : "mutation.unknown";
}

function procedureNamespace(path: string) {
  return normalizedProcedurePath(path).split(".", 1)[0];
}

export function shouldAuditProcedureActivity(type: string, path: string) {
  return (
    type === "mutation" && normalizedProcedurePath(path) !== "activity.record"
  );
}

export function procedureActivityPage(path: string) {
  return PAGE_BY_NAMESPACE[procedureNamespace(path)] ?? "/admin/activity";
}

export function isConfigurationProcedure(path: string) {
  return CONFIGURATION_NAMESPACES.has(procedureNamespace(path));
}

export function buildProcedureActivityEvent(input: ProcedureActivityInput) {
  const procedurePath = normalizedProcedurePath(input.procedurePath);
  const auditPath = procedurePath.slice(0, 132);
  const completed = input.terminalResult === "completed";
  const outcome = completed
    ? isConfigurationProcedure(procedurePath)
      ? ("configuracion" as const)
      : ("guardado" as const)
    : ("error" as const);

  return {
    actorType: "human" as const,
    actorUserId: input.actorUserId,
    actorEmail: null,
    pagePath: procedureActivityPage(procedurePath),
    eventType: procedurePath.slice(0, 48),
    outcome,
    expectedAction: "Ejecutar una mutación tRPC autenticada y autorizada",
    actualAction: `${auditPath} · ${completed ? "completada" : "error controlado"}`,
    correlationId: input.correlationId ?? randomUUID(),
    controlStartedAt: input.startedAt,
  };
}

/**
 * Registra únicamente metadatos operativos permitidos. Es deliberadamente
 * best-effort: la ausencia de PostgreSQL o de la migración 0014 nunca cambia
 * el resultado de la mutación observada.
 */
export async function recordProcedureActivityBestEffort(
  input: ProcedureActivityInput,
  poolProvider: PoolProvider = getPool
) {
  try {
    const pool = await poolProvider();
    if (!pool) return false;
    const event = buildProcedureActivityEvent(input);
    await pool.query(
      `INSERT INTO admin_activity_events
         (actor_type,actor_user_id,actor_email,page_path,event_type,outcome,
          expected_action,actual_action,correlation_id,control_started_at,metadata)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb)
       ON CONFLICT (correlation_id) DO NOTHING`,
      [
        event.actorType,
        event.actorUserId,
        event.pagePath,
        event.eventType,
        event.outcome,
        event.expectedAction,
        event.actualAction,
        event.correlationId,
        event.controlStartedAt,
      ]
    );
    return true;
  } catch {
    console.warn(
      `[ActivityAudit] No fue posible registrar ${normalizedProcedurePath(input.procedurePath)}.`
    );
    return false;
  }
}
