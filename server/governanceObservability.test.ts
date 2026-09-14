import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_GOVERNANCE_DOMAINS,
  ASSESSMENT_GOVERNANCE_RULES,
  GOVERNANCE_MONITORING_NOTICE,
} from "../shared/assessmentGovernance";
import {
  isUndefinedTableError,
  listGovernanceCoverage,
  registerGovernanceVerification,
  resolveGovernanceRules,
} from "./governanceObservability";

function poolWith(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as Pool;
}

describe("cobertura auditable de gobierno", () => {
  it("mantiene categorías y políticas enlazadas con su resumen y superficie observable", () => {
    expect(ASSESSMENT_GOVERNANCE_DOMAINS).toHaveLength(8);
    for (const domain of ASSESSMENT_GOVERNANCE_DOMAINS) {
      expect(domain.summary.length).toBeGreaterThan(20);
      expect(domain.accent.frame).toContain("border-");
      expect(domain.accent.dot).toContain("bg-");
      expect(domain.controlCount).toBe(8);
    }
    for (const rule of ASSESSMENT_GOVERNANCE_RULES) {
      expect(rule.summary.length).toBeGreaterThan(20);
      expect(rule.traceSurface.length).toBeGreaterThan(10);
      expect(
        ASSESSMENT_GOVERNANCE_DOMAINS.some(
          domain => domain.code === rule.domainCode
        )
      ).toBe(true);
    }
    expect(GOVERNANCE_MONITORING_NOTICE).not.toContain("64");
  });

  it("resuelve identificadores declarados y rechaza políticas inexistentes", () => {
    const resolved = resolveGovernanceRules([" gob-01 ", "GOB-01", "sup-08"]);
    expect(resolved.map(rule => rule.id)).toEqual(["GOB-01", "SUP-08"]);
    expect(resolved.map(rule => rule.domainCode)).toEqual(["GOB", "SUP"]);
    expect(() => resolveGovernanceRules(["ZZZ-99"])).toThrowError(
      /Política de gobierno no reconocida/
    );
  });

  it("informa la migración pendiente cuando la tabla todavía no existe", async () => {
    const query = vi.fn(async () => {
      throw Object.assign(new Error("undefined table"), { code: "42P01" });
    });
    const snapshot = await listGovernanceCoverage(poolWith(query));
    expect(snapshot).toEqual({
      tableReady: false,
      rules: [],
      totalVerifications: 0,
      lastVerifiedAt: null,
    });
    expect(isUndefinedTableError({ code: "42P01" })).toBe(true);
    expect(isUndefinedTableError({ code: "23505" })).toBe(false);
  });

  it("contabiliza y ordena las trazas registradas por política", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          rule_id: "GOB-01",
          verifications: 3,
          last_verified_at: new Date("2026-09-10T12:00:00.000Z"),
          last_trace_id: "trace-gob",
        },
        {
          rule_id: "OBS-03",
          verifications: 1,
          last_verified_at: "2026-09-12T08:30:00.000Z",
          last_trace_id: "trace-obs",
        },
      ],
    }));
    const snapshot = await listGovernanceCoverage(poolWith(query));
    expect(snapshot.tableReady).toBe(true);
    expect(snapshot.totalVerifications).toBe(4);
    expect(snapshot.lastVerifiedAt).toBe("2026-09-12T08:30:00.000Z");
    expect(snapshot.rules[0]).toEqual({
      ruleId: "GOB-01",
      verifications: 3,
      lastVerifiedAt: "2026-09-10T12:00:00.000Z",
      lastTraceId: "trace-gob",
    });
  });

  it("registra una verificación por política con la traza observada", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const result = await registerGovernanceVerification(poolWith(query), {
      ruleIds: ["GOB-01", "SUP-08"],
      traceId: "trace-123",
      environment: "production",
      release: "2.0.138",
      actorUserId: 7,
      actorEmail: "admin@aisa.com.gt",
    });
    expect(result).toEqual({ registered: 2, ruleIds: ["GOB-01", "SUP-08"] });
    const [statement, values] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain("INSERT INTO governance_rule_verifications");
    expect(statement).toContain("unnest");
    expect(values[0]).toEqual(["GOB-01", "SUP-08"]);
    expect(values[1]).toEqual(["GOB", "SUP"]);
    expect(values[3]).toBe("trace-123");
    expect(values[4]).toBe("production");
    await expect(
      registerGovernanceVerification(poolWith(query), { ruleIds: [] })
    ).rejects.toThrowError(/Seleccione al menos una política/);
  });
});
