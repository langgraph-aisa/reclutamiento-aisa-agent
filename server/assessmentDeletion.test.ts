import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getPool } = vi.hoisted(() => ({
  getPool: vi.fn(),
}));

vi.mock("./db", () => ({
  getPool,
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

vi.mock("./localAuth", async () => {
  const actual = await vi.importActual<typeof import("./localAuth")>(
    "./localAuth"
  );
  return {
    ...actual,
    sendDeleteCode: vi.fn(async () => undefined),
    verifyLoginCode: vi.fn(async () => true),
  };
});

import { sendDeleteCode } from "./localAuth";
import { appRouter } from "./routers";
import {
  ASSESSMENT_DELETE_CODE_MAX_ATTEMPTS,
  ASSESSMENT_DELETE_CODE_RESEND_SECONDS,
  ASSESSMENT_DELETE_CODE_TTL_MINUTES,
  ASSESSMENT_DELETE_TITLE_WORD_LIMIT,
  assessmentDeleteAlertDescription,
  assessmentDeleteAlertTitle,
} from "../shared/assessmentGovernance";
import { countWords } from "../shared/activityAudit";

function createContext(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "email:admin@example.test",
      name: "Admin",
      email: "admin@example.test",
      loginMethod: "email_code",
      role: "admin",
      active: true,
    } as NonNullable<TrpcContext["user"]>,
    req: { headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

const sampleTarget = {
  name: "Prueba de nivel · Ejecutivo de Negocios (Ventas)",
  version: 2,
  status: "retirado",
  itemCount: 3,
  activeItemCount: 3,
};

describe("alertas de borrado de versiones registradas", () => {
  it("compone un título descriptivo de la acción en exactamente 11 palabras", () => {
    const title = assessmentDeleteAlertTitle(sampleTarget);
    expect(countWords(title)).toBe(ASSESSMENT_DELETE_TITLE_WORD_LIMIT);
    expect(title).toMatch(/^Eliminar retirado v2 de /);
    expect(title).toMatch(/ confirmada por código$/);
  });

  it("deriva el título del registro y trunca nombres largos sin texto fijo", () => {
    const long = assessmentDeleteAlertTitle({
      ...sampleTarget,
      name: `${sampleTarget.name} con Energías Renovables y Recursos Humanos`,
      status: "borrador",
      version: 4,
    });
    expect(countWords(long)).toBeLessThanOrEqual(
      ASSESSMENT_DELETE_TITLE_WORD_LIMIT
    );
    expect(long).toContain("…");
    expect(long).toContain("v4");
    const other = assessmentDeleteAlertTitle({
      ...sampleTarget,
      name: "Prueba técnica · Analista Financiero",
      status: "retirado",
      version: 1,
    });
    expect(other).not.toBe(long);
    expect(other).toContain("Analista");
  });

  it("genera la descripción desde los datos de la versión, sin texto quemado", () => {
    const description = assessmentDeleteAlertDescription(sampleTarget);
    expect(description).toContain(sampleTarget.name);
    expect(description).toContain(`v${sampleTarget.version}`);
    expect(description).toContain("retirado");
    expect(description).toContain("3 preguntas registradas");
    expect(description).toContain("3 habilitadas");
    expect(description).toContain("código temporal de seis dígitos");
    const other = assessmentDeleteAlertDescription({
      ...sampleTarget,
      name: "Prueba técnica · Analista Financiero",
      version: 1,
    });
    expect(other).not.toContain("Ejecutivo de Negocios");
    expect(other).toContain("v1");
  });

  it("reutiliza los límites institucionales del código de borrado", () => {
    expect(ASSESSMENT_DELETE_CODE_TTL_MINUTES).toBe(10);
    expect(ASSESSMENT_DELETE_CODE_MAX_ATTEMPTS).toBe(5);
    expect(ASSESSMENT_DELETE_CODE_RESEND_SECONDS).toBe(60);
  });

  it("persiste únicamente el hash del código en la migración", () => {
    const migration = readFileSync(
      "drizzle/migrations/0015_protocol_delete_challenges.sql",
      "utf8"
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS protocol_delete_challenges"
    );
    expect(migration).toContain("code_hash text NOT NULL");
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).not.toMatch(/code\s+text\s+NOT NULL/);
  });
});

describe("assessments.requestDeleteCode", () => {
  it("rechaza versiones activas", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: 4, name: "Prueba", version: 1, status: "activo" }],
    });
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter
        .createCaller(createContext())
        .assessments.requestDeleteCode({ id: 4 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rechaza versiones con sesiones de evaluación vinculadas", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 5, name: "Prueba", version: 2, status: "retirado" }],
      })
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter
        .createCaller(createContext())
        .assessments.requestDeleteCode({ id: 5 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("envía el código al correo y devuelve máscara, vigencia y espera dinámicas", async () => {
    const protocol = {
      id: 6,
      name: "Prueba de nivel · Ejecutivo de Negocios (Ventas)",
      version: 2,
      status: "retirado",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [protocol] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ email: "jardon@aisa.com.gt" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 99 }] })
      .mockResolvedValueOnce({ rows: [] });
    getPool.mockResolvedValue({ query });

    const result = await appRouter
      .createCaller(createContext())
      .assessments.requestDeleteCode({ id: 6 });

    expect(result.success).toBe(true);
    expect(result.emailMask).toBe("ja****@aisa.com.gt");
    expect(result.expiresInMinutes).toBe(ASSESSMENT_DELETE_CODE_TTL_MINUTES);
    expect(result.retryAfterSeconds).toBe(
      ASSESSMENT_DELETE_CODE_RESEND_SECONDS
    );
    expect(sendDeleteCode).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jardon@aisa.com.gt",
        protocolName: protocol.name,
        version: 2,
        status: "retirado",
      })
    );
  });
});

describe("assessments.deleteProtocol", () => {
  function clientWith(rows: Record<string, unknown>) {
    const query = vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes("SELECT id,name,version,status,job_position_id")) {
        return { rows: rows.protocol ? [rows.protocol] : [] };
      }
      if (text.includes("FROM assessment_sessions")) return { rows: [] };
      if (
        text.includes("SELECT id,code_hash,attempts,max_attempts,expires_at")
      ) {
        return { rows: rows.challenge ? [rows.challenge] : [] };
      }
      if (text.includes("count(*)::int AS item_count")) {
        return { rows: [{ item_count: 3 }] };
      }
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    getPool.mockResolvedValue({
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
    });
    return client;
  }

  it("rechaza el borrado de una versión activa", async () => {
    clientWith({
      protocol: {
        id: 6,
        name: "Prueba",
        version: 3,
        status: "activo",
        job_position_id: 1,
      },
    });

    await expect(
      appRouter.createCaller(createContext()).assessments.deleteProtocol({
        id: 6,
        code: "123456",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rechaza el código ausente o inválido", async () => {
    clientWith({
      protocol: {
        id: 6,
        name: "Prueba",
        version: 2,
        status: "borrador",
        job_position_id: 1,
      },
    });

    await expect(
      appRouter.createCaller(createContext()).assessments.deleteProtocol({
        id: 6,
        code: "123456",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("elimina la versión confirmada y registra la evidencia de auditoría", async () => {
    const client = clientWith({
      protocol: {
        id: 6,
        name: "Prueba de nivel",
        version: 2,
        status: "borrador",
        job_position_id: 1,
      },
      challenge: {
        id: 99,
        code_hash: "hash",
        attempts: 0,
        max_attempts: 5,
        expires_at: new Date(Date.now() + 60_000),
      },
    });

    const result = await appRouter
      .createCaller(createContext())
      .assessments.deleteProtocol({ id: 6, code: "123456" });

    expect(result).toEqual({ success: true });
    const sqlCalls = client.query.mock.calls.map(call => String(call[0]));
    expect(sqlCalls.some(sql => sql.includes("DELETE FROM assessment_protocols"))).toBe(true);
    expect(
      sqlCalls.some(
        sql =>
          sql.includes("INSERT INTO audit_log") &&
          sql.includes("'protocol_deleted'")
      )
    ).toBe(true);
    const deleteCall = client.query.mock.calls.find(call =>
      String(call[0]).includes("DELETE FROM assessment_protocols")
    );
    expect(deleteCall?.[1]).toEqual([6]);
  });
});
