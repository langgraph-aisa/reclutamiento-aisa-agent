import type { Pool } from "pg";
import { ASSESSMENT_GOVERNANCE_RULES } from "../shared/assessmentGovernance";

/**
 * Cobertura auditable del catálogo de gobierno.
 *
 * La fuente de verdad de las políticas es el catálogo versionado en
 * `shared/assessmentGovernance.ts`; esta capa solo registra y contabiliza las
 * verificaciones que el equipo ejecuta contra la observabilidad de LangGraph.
 */

export const GOVERNANCE_VERIFICATION_SOURCES = ["langgraph", "langfuse"] as const;

export type GovernanceVerificationSource =
  (typeof GOVERNANCE_VERIFICATION_SOURCES)[number];

export type GovernanceRuleVerificationInput = {
  ruleIds: string[];
  traceId?: string | null;
  environment?: string | null;
  release?: string | null;
  actorUserId?: number | null;
  actorEmail?: string | null;
  source?: GovernanceVerificationSource;
};

export type GovernanceCoverageRow = {
  ruleId: string;
  verifications: number;
  lastVerifiedAt: string | null;
  lastTraceId: string | null;
};

export type GovernanceCoverageSnapshot = {
  /** `false` cuando la migración 0020 todavía no se aplicó en el ambiente. */
  tableReady: boolean;
  rules: GovernanceCoverageRow[];
  totalVerifications: number;
  lastVerifiedAt: string | null;
};

const UNDEFINED_TABLE_ERROR = "42P01";

export function isUndefinedTableError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return code === UNDEFINED_TABLE_ERROR;
}

/**
 * Resuelve los identificadores declarados contra el catálogo vigente para que
 * nunca se registre una política inexistente ni un duplicado en la misma
 * operación.
 */
export function resolveGovernanceRules(ruleIds: string[]) {
  const index = new Map(ASSESSMENT_GOVERNANCE_RULES.map(rule => [rule.id, rule]));
  const unique = Array.from(
    new Set(ruleIds.map(ruleId => ruleId.trim().toUpperCase()))
  );
  const unknown = unique.filter(ruleId => !index.has(ruleId));
  if (unknown.length > 0) {
    throw new Error(
      `Política de gobierno no reconocida: ${unknown.join(", ")}.`
    );
  }
  return unique.map(ruleId => index.get(ruleId)!);
}

export async function listGovernanceCoverage(
  pool: Pool
): Promise<GovernanceCoverageSnapshot> {
  try {
    const result = await pool.query(
      `SELECT rule_id,
              count(*)::int AS verifications,
              max(created_at) AS last_verified_at,
              (array_agg(trace_id ORDER BY created_at DESC))[1] AS last_trace_id
         FROM governance_rule_verifications
        GROUP BY rule_id`
    );
    const rules: GovernanceCoverageRow[] = result.rows.map(row => ({
      ruleId: String(row.rule_id),
      verifications: Number(row.verifications ?? 0),
      lastVerifiedAt: row.last_verified_at
        ? new Date(row.last_verified_at).toISOString()
        : null,
      lastTraceId: row.last_trace_id ?? null,
    }));
    const totalVerifications = rules.reduce(
      (total, rule) => total + rule.verifications,
      0
    );
    const lastVerifiedAt =
      rules
        .map(rule => rule.lastVerifiedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
    return { tableReady: true, rules, totalVerifications, lastVerifiedAt };
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return {
        tableReady: false,
        rules: [],
        totalVerifications: 0,
        lastVerifiedAt: null,
      };
    }
    throw error;
  }
}

export async function registerGovernanceVerification(
  pool: Pool,
  input: GovernanceRuleVerificationInput
) {
  const rules = resolveGovernanceRules(input.ruleIds);
  if (rules.length === 0) {
    throw new Error("Seleccione al menos una política para registrar.");
  }
  await pool.query(
    `INSERT INTO governance_rule_verifications
       (rule_id, domain_code, source, trace_id, environment, release,
        registered_by_user_id, registered_by_email)
     SELECT rule_id, domain_code, $3::varchar, $4::varchar, $5::varchar,
            $6::varchar, $7::integer, $8::varchar
       FROM unnest($1::varchar[]) WITH ORDINALITY AS target(rule_id, position)
       JOIN unnest($2::varchar[]) WITH ORDINALITY AS domain(domain_code, position)
         USING (position)`,
    [
      rules.map(rule => rule.id),
      rules.map(rule => rule.domainCode),
      input.source ?? "langgraph",
      input.traceId ?? null,
      input.environment ?? null,
      input.release ?? null,
      input.actorUserId ?? null,
      input.actorEmail ?? null,
    ]
  );
  return { registered: rules.length, ruleIds: rules.map(rule => rule.id) };
}
