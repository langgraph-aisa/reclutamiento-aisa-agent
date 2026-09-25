import type { Pool } from "pg";
import { ADMIN_PAGE_LABELS } from "@shared/activityAudit";
import {
  createLoginCode,
  hashLoginCode,
  maskEmail,
  verifyLoginCode,
  LOGIN_CODE_TTL_MINUTES,
  LOGIN_CODE_RESEND_SECONDS,
} from "./localAuth";

/**
 * Roles de Seguridad · permisos por usuario.
 *
 * El permiso es **por usuario** y **por recurso**, con cinco columnas
 * declaradas: ver, leer, escribir, editar y borrar. El alcance `modulo` nombra
 * una entrada del menú y el alcance `recurso` nombra un dominio gobernado de la
 * base, de modo que el control alcanza cualquier registro sin que nadie tenga
 * que corregirlo a mano en la base.
 *
 * Tres reglas que sostienen el módulo:
 *
 * 1. **La ausencia de fila es ausencia de permiso.** Conceder es un acto
 *    deliberado y auditado; nada se hereda por omisión.
 * 2. **El administrador conserva todo por rol** y no consulta la tabla: un
 *    apagado accidental no puede dejarlo fuera de la administración.
 * 3. **Nada cambia sin código.** La asignación de permisos se confirma con un
 *    código de seis dígitos que viaja solo por correo, con vigencia, intentos
 *    limitados y espera entre reenvíos.
 */

/** Las cinco columnas del permiso, en el orden en que se muestran. */
export const PERMISSION_ACTIONS = [
  "view",
  "read",
  "write",
  "edit",
  "delete",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_LABELS: Record<PermissionAction, string> = {
  view: "Vista",
  read: "Lectura",
  write: "Escritura",
  edit: "Edición",
  delete: "Eliminación",
};

export type PermissionGrant = Record<PermissionAction, boolean>;

export const EMPTY_GRANT: PermissionGrant = {
  view: false,
  read: false,
  write: false,
  edit: false,
  delete: false,
};

export const FULL_GRANT: PermissionGrant = {
  view: true,
  read: true,
  write: true,
  edit: true,
  delete: true,
};

/** Alcances gobernados: la entrada del menú y el dominio de la base. */
export type PermissionScope = "modulo" | "recurso";

/**
 * Dominios gobernados de la base.
 *
 * La lista es deliberadamente de **dominios** y no de tablas: el operador
 * gobierna «candidatos» o «expediente», no `candidate_knowledge_files`. Una
 * lista de tablas envejecería con cada migración y nadie sabría qué conceder.
 */
export const SECURITY_RESOURCES: ReadonlyArray<{
  key: string;
  label: string;
  note: string;
}> = [
  {
    key: "postulaciones",
    label: "Postulaciones",
    note: "El registro del candidato en una plaza y su estado.",
  },
  {
    key: "candidatos",
    label: "Candidatos",
    note: "Identidad, contacto y ubicación declarada.",
  },
  {
    key: "plazas",
    label: "Plazas y anuncios",
    note: "Publicaciones, enlaces y variantes de formulario.",
  },
  {
    key: "perfiles",
    label: "Perfiles laborales",
    note: "Perfil del puesto y criterios del agente.",
  },
  {
    key: "proyectos",
    label: "Proyectos",
    note: "Base de conocimiento por proyecto y su cuenta de Dropbox.",
  },
  {
    key: "formularios",
    label: "Formularios y preguntas",
    note: "Estructura del instrumento y sus respuestas.",
  },
  {
    key: "pruebas",
    label: "Pruebas psicométricas",
    note: "Protocolos, preguntas y ciclos de evaluación.",
  },
  {
    key: "evaluaciones",
    label: "Evaluaciones del agente",
    note: "Dictámenes, punteos y su fundamento.",
  },
  {
    key: "expediente",
    label: "Expediente documental",
    note: "Documentos del candidato y su análisis.",
  },
  {
    key: "conversaciones",
    label: "Conversaciones y mensajes",
    note: "La bandeja del canal autorizado.",
  },
  {
    key: "usuarios",
    label: "Usuarios y sus roles",
    note: "Cuentas de la institución y su estado.",
  },
  {
    key: "configuracion",
    label: "Configuración e integraciones",
    note: "Credenciales, endpoints y preferencias.",
  },
  {
    key: "actividad",
    label: "Actividad y control ISO",
    note: "La traza institucional de lo ocurrido.",
  },
];

/** Entradas del menú administrable, tomadas de la fuente única del proyecto. */
export function securityModules() {
  return Object.entries(ADMIN_PAGE_LABELS).map(([path, label]) => ({
    key: path,
    label,
  }));
}

export function isPermissionAction(value: unknown): value is PermissionAction {
  return PERMISSION_ACTIONS.includes(value as PermissionAction);
}

/**
 * Decisión de acceso. Es una función pura: el administrador conserva todo por
 * rol, y cualquier otro usuario necesita la concesión explícita de la acción.
 */
export function permissionDecision(input: {
  role: string | null | undefined;
  grants: ReadonlyArray<{
    scope: string;
    resourceKey: string;
    grant: PermissionGrant;
  }>;
  scope: PermissionScope;
  key: string;
  action: PermissionAction;
}): boolean {
  if (input.role === "admin") return true;
  const match = input.grants.find(
    candidate =>
      candidate.scope === input.scope && candidate.resourceKey === input.key
  );
  if (!match) return false;
  return match.grant[input.action] === true;
}

/** Mapa de concesiones de un usuario, listo para la decisión y para la vista. */
export type UserPermissionMap = Record<string, PermissionGrant>;

export function permissionMapKey(scope: PermissionScope, key: string) {
  return `${scope}:${key}`;
}

export function toPermissionMap(
  rows: ReadonlyArray<{
    scope: string;
    resource_key: string;
    can_view: boolean;
    can_read: boolean;
    can_write: boolean;
    can_edit: boolean;
    can_delete: boolean;
  }>
): UserPermissionMap {
  const map: UserPermissionMap = {};
  for (const row of rows) {
    map[permissionMapKey(row.scope as PermissionScope, row.resource_key)] = {
      view: Boolean(row.can_view),
      read: Boolean(row.can_read),
      write: Boolean(row.can_write),
      edit: Boolean(row.can_edit),
      delete: Boolean(row.can_delete),
    };
  }
  return map;
}

type Queryable = Pick<Pool, "query">;

/** Concesiones guardadas de un usuario. Sin filas, sin permisos. */
export async function loadUserPermissions(pool: Queryable | null, userId: number) {
  if (!pool) return {} as UserPermissionMap;
  try {
    const result = await pool.query<{
      scope: string;
      resource_key: string;
      can_view: boolean;
      can_read: boolean;
      can_write: boolean;
      can_edit: boolean;
      can_delete: boolean;
    }>(
      `SELECT scope,resource_key,can_view,can_read,can_write,can_edit,can_delete
         FROM user_permissions WHERE user_id=$1`,
      [userId]
    );
    return toPermissionMap(result.rows);
  } catch {
    // Sin la migración de permisos no se concede nada.
    return {} as UserPermissionMap;
  }
}

/**
 * Guarda las concesiones de un usuario.
 *
 * Escribe **todas** las claves recibidas —una fila por recurso, con su fila
 * completa— de modo que la vista y la base no puedan discrepar, y asienta el
 * antes y el después en la traza. La operación es transaccional: un fallo a
 * mitad no deja permisos a medio conceder.
 */
export async function saveUserPermissions(
  pool: Pool,
  input: {
    userId: number;
    grants: Array<{
      scope: PermissionScope;
      key: string;
      grant: PermissionGrant;
    }>;
    actorUserId: number;
  }
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(
      `SELECT scope,resource_key,can_view,can_read,can_write,can_edit,can_delete
         FROM user_permissions WHERE user_id=$1 FOR UPDATE`,
      [input.userId]
    );
    await client.query(`DELETE FROM user_permissions WHERE user_id=$1`, [
      input.userId,
    ]);
    for (const entry of input.grants) {
      const grant = entry.grant;
      const empty = PERMISSION_ACTIONS.every(action => !grant[action]);
      // Una concesión vacía no se guarda: sin fila ya significa sin permiso, y
      // almacenarla sugeriría una decisión que no se tomó.
      if (empty) continue;
      await client.query(
        `INSERT INTO user_permissions
           (user_id,scope,resource_key,can_view,can_read,can_write,can_edit,
            can_delete,granted_by_user_id,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
        [
          input.userId,
          entry.scope,
          entry.key,
          grant.view,
          grant.read,
          grant.write,
          grant.edit,
          grant.delete,
          input.actorUserId,
        ]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,before_json,after_json)
       VALUES ($1,'user_permission',$2,'user_permissions_updated',$3::jsonb,$4::jsonb)`,
      [
        input.actorUserId,
        input.userId,
        JSON.stringify({ permissions: before.rows }),
        JSON.stringify({
          permissions: input.grants.filter(
            entry => !PERMISSION_ACTIONS.every(action => !entry.grant[action])
          ).map(entry => ({
            scope: entry.scope,
            key: entry.key,
            ...entry.grant,
          })),
        }),
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return loadUserPermissions(pool, input.userId);
}

/** Las últimas acciones registradas de un usuario, para el panel de la vista. */
export async function recentUserActions(
  pool: Queryable | null,
  userId: number,
  limit = 20
) {
  if (!pool) return [];
  try {
    const result = await pool.query<{
      id: number;
      action: string;
      entity_type: string;
      entity_id: number;
      created_at: string | Date;
    }>(
      `SELECT id,action,entity_type,entity_id,created_at
         FROM audit_log WHERE actor_user_id=$1
        ORDER BY created_at DESC,id DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 50)]
    );
    return result.rows;
  } catch {
    return [];
  }
}

export type SecurityChallengePurpose = "permisos" | "cambio";

export type SecurityChallengeRequest = {
  emailMask: string;
  expiresInMinutes: number;
  retryAfterSeconds: number;
  purpose: SecurityChallengePurpose;
  targetUserId: number | null;
  attemptsRemaining: number;
  reused: boolean;
};

/**
 * Solicita el código que autoriza un acto sensible.
 *
 * El código se guarda solo como hash y viaja **únicamente** por correo. El
 * reenvío dentro de la ventana declarada no emite un código nuevo —evita el
 * bombardeo de correo y el agotamiento de intentos— y el desafío anterior se
 * invalida al emitir uno nuevo, de modo que solo el último código vale.
 */
export async function requestSecurityChallenge(
  pool: Pool,
  input: {
    requestedByUserId: number;
    requestedByEmail: string;
    purpose: SecurityChallengePurpose;
    targetUserId: number | null;
    detail: string;
    requestedIp: string | null;
    sendCode: (payload: {
      email: string;
      code: string;
      expiresInMinutes: number;
      purpose: SecurityChallengePurpose;
      detail: string;
    }) => Promise<void>;
  }
): Promise<SecurityChallengeRequest> {
  const base = {
    emailMask: maskEmail(input.requestedByEmail),
    expiresInMinutes: LOGIN_CODE_TTL_MINUTES,
    retryAfterSeconds: LOGIN_CODE_RESEND_SECONDS,
    purpose: input.purpose,
    targetUserId: input.targetUserId,
    attemptsRemaining: 5,
  };
  const recent = await pool.query<{ created_at: string | Date }>(
    `SELECT created_at FROM security_challenges
      WHERE requested_by_user_id=$1 AND purpose=$2 AND used_at IS NULL
      ORDER BY created_at DESC,id DESC LIMIT 1`,
    [input.requestedByUserId, input.purpose]
  );
  if (
    recent.rows[0] &&
    Date.now() - new Date(recent.rows[0].created_at).getTime() <
      LOGIN_CODE_RESEND_SECONDS * 1_000
  ) {
    return { ...base, reused: true };
  }
  const code = createLoginCode();
  const codeHash = await hashLoginCode(code);
  await pool.query(
    `UPDATE security_challenges SET used_at=COALESCE(used_at,now())
      WHERE requested_by_user_id=$1 AND used_at IS NULL`,
    [input.requestedByUserId]
  );
  const challenge = await pool.query<{ id: number }>(
    `INSERT INTO security_challenges
       (requested_by_user_id,purpose,target_user_id,detail,code_hash,
        max_attempts,expires_at,requested_ip)
     VALUES ($1,$2,$3,$4,$5,5,now()+($6 * interval '1 minute'),$7)
     RETURNING id`,
    [
      input.requestedByUserId,
      input.purpose,
      input.targetUserId,
      input.detail.slice(0, 300),
      codeHash,
      String(LOGIN_CODE_TTL_MINUTES),
      input.requestedIp,
    ]
  );
  try {
    await input.sendCode({
      email: input.requestedByEmail,
      code,
      expiresInMinutes: LOGIN_CODE_TTL_MINUTES,
      purpose: input.purpose,
      detail: input.detail,
    });
  } catch (error) {
    await pool.query(
      `UPDATE security_challenges SET used_at=now() WHERE id=$1`,
      [challenge.rows[0]?.id ?? 0]
    );
    throw new Error(
      "No fue posible enviar el código de confirmación por correo."
    );
  }
  return { ...base, reused: false };
}

export type SecurityChallengeVerdict =
  | { granted: true; detail: string; targetUserId: number | null }
  | {
      granted: false;
      reason: "sin_desafio" | "expirado" | "agotado" | "codigo_invalido";
      attemptsRemaining: number;
    };

/**
 * Verifica el código y lo consume. El consumo ocurre **dentro** de la misma
 * transacción que el acto autorizado, de modo que un código no puede usarse dos
 * veces ni quedar gastado por un acto que no llegó a ocurrir.
 */
export async function verifySecurityChallenge(
  pool: Pool,
  input: {
    requestedByUserId: number;
    purpose: SecurityChallengePurpose;
    code: string;
  }
): Promise<SecurityChallengeVerdict> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      id: number;
      target_user_id: number | null;
      detail: string | null;
      code_hash: string;
      attempts: number;
      max_attempts: number;
      expires_at: string | Date;
    }>(
      `SELECT id,target_user_id,detail,code_hash,attempts,max_attempts,expires_at
         FROM security_challenges
        WHERE requested_by_user_id=$1 AND purpose=$2 AND used_at IS NULL
        ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
      [input.requestedByUserId, input.purpose]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { granted: false, reason: "sin_desafio", attemptsRemaining: 0 };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query(
        `UPDATE security_challenges SET used_at=now() WHERE id=$1`,
        [row.id]
      );
      await client.query("COMMIT");
      return { granted: false, reason: "expirado", attemptsRemaining: 0 };
    }
    if (row.attempts >= row.max_attempts) {
      await client.query("COMMIT");
      return { granted: false, reason: "agotado", attemptsRemaining: 0 };
    }
    if (!(await verifyLoginCode(input.code, row.code_hash))) {
      await client.query(
        `UPDATE security_challenges SET attempts=attempts+1 WHERE id=$1`,
        [row.id]
      );
      await client.query("COMMIT");
      return {
        granted: false,
        reason: "codigo_invalido",
        attemptsRemaining: Math.max(0, row.max_attempts - row.attempts - 1),
      };
    }
    await client.query(
      `UPDATE security_challenges SET used_at=now() WHERE id=$1`,
      [row.id]
    );
    await client.query("COMMIT");
    return {
      granted: true,
      detail: row.detail ?? "",
      targetUserId: row.target_user_id,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
