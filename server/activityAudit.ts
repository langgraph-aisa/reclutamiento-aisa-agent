import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  activityActionLabel,
  activityTitle,
  adminPageLabel,
  normalizeAdminPath,
  type ActivityOutcome,
} from "../shared/activityAudit";
import { JARVI_HR_IDENTITY_EMAIL } from "../shared/agentConfig";

const configurationEntities = new Set([
  "agent_configuration",
  "apichat_configuration",
  "integration_setting",
  "methodology_document",
  "assessment_protocol",
]);

const entityPage: Record<string, string> = {
  application: "/admin/human-review",
  job_position: "/admin/jobs",
  job_profile: "/admin/profiles",
  application_form: "/admin/jobs",
  form_question: "/admin/jobs",
  methodology_document: "/admin/mst-eir",
  agent_configuration: "/admin/agent-evaluator",
  apichat_configuration: "/admin/config",
  assessment_protocol: "/admin/assessments",
  user: "/admin/users",
};

type AuditRow = {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_email: string | null;
  entity_type: string;
  entity_id: number;
  action: string;
  created_at: Date | string;
};

type ActivityRow = {
  id: number;
  actor_type: "human" | "ai" | "system";
  actor_user_id: number | null;
  actor_name: string | null;
  actor_email: string | null;
  page_path: string;
  event_type: string;
  outcome: ActivityOutcome;
  expected_action: string | null;
  actual_action: string | null;
  entity_type: string | null;
  entity_id: number | null;
  correlation_id: string;
  control_started_at: Date | string;
  created_at: Date | string;
};

export function auditPage(entityType: string) {
  return entityPage[entityType] ?? "/admin/activity";
}

export function auditOutcome(entityType: string): ActivityOutcome {
  return configurationEntities.has(entityType) ? "configuracion" : "guardado";
}

function projectedAudit(row: AuditRow) {
  const pagePath = auditPage(row.entity_type);
  const actorType = row.actor_user_id
    ? ("human" as const)
    : row.action.startsWith("agent_")
      ? ("ai" as const)
      : ("system" as const);
  const actorLabel =
    actorType === "ai"
      ? "JARVI HR"
      : row.actor_name?.trim() ||
        (actorType === "system" ? "Sistema Talento AISA" : "Usuario registrado");
  const outcome = auditOutcome(row.entity_type);
  return {
    source: "audit_log" as const,
    sourceId: row.id,
    actorType,
    actorLabel,
    actorEmail:
      actorType === "ai"
        ? JARVI_HR_IDENTITY_EMAIL
        : row.actor_email?.trim() || null,
    responsibleEmail:
      actorType === "ai" ? JARVI_HR_IDENTITY_EMAIL : row.actor_email ?? null,
    pagePath,
    pageLabel: adminPageLabel(pagePath),
    action: row.action,
    outcome,
    title: activityTitle(row.action, pagePath),
    expectedAction: "Persistir una operación autorizada con trazabilidad",
    actualAction: activityActionLabel(row.action),
    entityType: row.entity_type,
    entityId: row.entity_id,
    correlationId: `audit:${row.id}`,
    controlStartedAt: row.created_at,
    createdAt: row.created_at,
  };
}

function projectedActivity(row: ActivityRow) {
  const pagePath = normalizeAdminPath(row.page_path);
  const actorLabel =
    row.actor_type === "ai"
      ? "JARVI HR"
      : row.actor_name?.trim() ||
        (row.actor_type === "system"
          ? "Sistema Talento AISA"
          : "Usuario registrado");
  return {
    source: "admin_activity_events" as const,
    sourceId: row.id,
    actorType: row.actor_type,
    actorLabel,
    actorEmail: row.actor_email,
    responsibleEmail:
      row.actor_type === "ai" ? JARVI_HR_IDENTITY_EMAIL : row.actor_email,
    pagePath,
    pageLabel: adminPageLabel(pagePath),
    action: row.event_type,
    outcome: row.outcome,
    title: activityTitle(row.event_type, pagePath),
    expectedAction: row.expected_action,
    actualAction: row.actual_action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    correlationId: row.correlation_id,
    controlStartedAt: row.control_started_at,
    createdAt: row.created_at,
  };
}

export async function recordAdminActivity(
  pool: Pool,
  input: {
    actorUserId: number;
    actorEmail: string | null;
    pagePath: string;
    eventType: "page_opened" | "work_started";
    correlationId?: string;
  }
) {
  const correlationId = input.correlationId?.trim() || randomUUID();
  const result = await pool.query<ActivityRow>(
    `WITH inserted AS (
       INSERT INTO admin_activity_events
         (actor_type,actor_user_id,actor_email,page_path,event_type,outcome,
          expected_action,actual_action,correlation_id)
       VALUES ('human',$1,$2,$3,$4,'trabajando',$5,$6,$7)
       ON CONFLICT (correlation_id) DO NOTHING
       RETURNING *
     )
     SELECT * FROM inserted
     UNION ALL
     SELECT * FROM admin_activity_events WHERE correlation_id=$7
     LIMIT 1`,
    [
      input.actorUserId,
      input.actorEmail,
      normalizeAdminPath(input.pagePath),
      input.eventType,
      "Abrir una hoja administrativa autorizada",
      input.eventType === "page_opened"
        ? "Hoja administrativa abierta"
        : "Trabajo administrativo iniciado",
      correlationId,
    ]
  );
  return projectedActivity({ ...result.rows[0], actor_name: null });
}

export async function getActivityOverview(
  pool: Pool,
  input: { pagePath?: string; limit?: number; date?: string }
) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const pagePath = input.pagePath
    ? normalizeAdminPath(input.pagePath)
    : undefined;
  const auditResult = await pool.query<AuditRow>(
    `SELECT al.id,al.actor_user_id,u.name AS actor_name,u.email AS actor_email,
            al.entity_type,al.entity_id,al.action,al.created_at
       FROM audit_log al
       LEFT JOIN users u ON u.id=al.actor_user_id
      WHERE ($1::date IS NULL OR (al.created_at AT TIME ZONE 'America/Guatemala')::date=$1::date)
        AND ($2::text IS NULL OR
          CASE al.entity_type
            WHEN 'application' THEN '/admin/human-review'
            WHEN 'job_position' THEN '/admin/jobs'
            WHEN 'job_profile' THEN '/admin/profiles'
            WHEN 'application_form' THEN '/admin/jobs'
            WHEN 'form_question' THEN '/admin/jobs'
            WHEN 'methodology_document' THEN '/admin/mst-eir'
            WHEN 'agent_configuration' THEN '/admin/agent-evaluator'
            WHEN 'apichat_configuration' THEN '/admin/config'
            WHEN 'assessment_protocol' THEN '/admin/assessments'
            WHEN 'user' THEN '/admin/users'
            ELSE '/admin/activity'
          END = $2)
      ORDER BY al.created_at DESC,al.id DESC
      LIMIT $3`,
    [input.date ?? null, pagePath ?? null, limit * 2]
  );
  const activityResult = await pool.query<ActivityRow>(
    `SELECT ae.*,u.name AS actor_name
       FROM admin_activity_events ae
       LEFT JOIN users u ON u.id=ae.actor_user_id
      WHERE ($1::date IS NULL OR (ae.created_at AT TIME ZONE 'America/Guatemala')::date=$1::date)
        AND ($2::text IS NULL OR ae.page_path=$2)
      ORDER BY ae.created_at DESC,ae.id DESC
      LIMIT $3`,
    [input.date ?? null, pagePath ?? null, limit * 2]
  );
  const events = [
    ...auditResult.rows.map(projectedAudit),
    ...activityResult.rows.map(projectedActivity),
  ]
    .filter(event => !pagePath || event.pagePath === pagePath)
    .sort(
      (left, right) =>
        new Date(String(right.createdAt)).getTime() -
        new Date(String(left.createdAt)).getTime()
    )
    .slice(0, limit);

  const heatmapResult = await pool.query<{
    day: string;
    count: number;
  }>(
    `SELECT day::text,count(*)::int AS count
       FROM (
         SELECT (created_at AT TIME ZONE 'America/Guatemala')::date AS day
           FROM audit_log
          WHERE created_at >= (
            date_trunc('year',now() AT TIME ZONE 'America/Guatemala')
            AT TIME ZONE 'America/Guatemala'
          )
         UNION ALL
         SELECT (created_at AT TIME ZONE 'America/Guatemala')::date AS day
           FROM admin_activity_events
          WHERE outcome IN ('guardado','configuracion','error')
            AND created_at >= (
              date_trunc('year',now() AT TIME ZONE 'America/Guatemala')
              AT TIME ZONE 'America/Guatemala'
            )
       ) terminal_events
      GROUP BY day
      ORDER BY day`,
    []
  );
  return {
    title: "Contribuciones a Talento AISA este año",
    timezone: "America/Guatemala",
    events,
    heatmap: heatmapResult.rows,
    refreshedAt: new Date(),
  };
}

export async function getJarviAssignment(pool: Pool) {
  const result = await pool.query(
    `SELECT a.agent_key,a.user_id,a.identity_email,a.active,a.updated_at,
            u.name AS user_name,u.email AS user_email,u.active AS user_active
       FROM agent_user_assignments a
       LEFT JOIN users u ON u.id=a.user_id
      WHERE a.agent_key='jarvi_hr'
      LIMIT 1`
  );
  return (
    result.rows[0] ?? {
      agent_key: "jarvi_hr",
      user_id: null,
      identity_email: JARVI_HR_IDENTITY_EMAIL,
      active: true,
      user_name: null,
      user_email: null,
      user_active: null,
      updated_at: null,
    }
  );
}

export async function assignJarviUser(
  pool: Pool,
  userId: number,
  assignedByUserId: number
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(
      `SELECT id,name,email,active FROM users
        WHERE id=$1 AND active=true LIMIT 1 FOR SHARE`,
      [userId]
    );
    if (!user.rows[0]) {
      throw new Error("JARVI HR solo puede asignarse a un usuario activo.");
    }
    await client.query(
      `INSERT INTO agent_user_assignments
         (agent_key,user_id,identity_email,active,assigned_by_user_id,updated_at)
       VALUES ('jarvi_hr',$1,$2,true,$3,now())
       ON CONFLICT (agent_key) DO UPDATE
         SET user_id=EXCLUDED.user_id,identity_email=EXCLUDED.identity_email,
             active=true,assigned_by_user_id=EXCLUDED.assigned_by_user_id,
             updated_at=now()`,
      [userId, JARVI_HR_IDENTITY_EMAIL, assignedByUserId]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'agent_configuration',0,'jarvi_responsible_assigned',$2::jsonb)`,
      [assignedByUserId, JSON.stringify({ userId, agentKey: "jarvi_hr" })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getJarviAssignment(pool);
}
