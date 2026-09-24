import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const {
  getPool,
  importSpreadsheetForm,
  evaluateApplicationWithAgent,
  normalizePublicCopy,
} = vi.hoisted(() => ({
  getPool: vi.fn(),
  importSpreadsheetForm: vi.fn(),
  evaluateApplicationWithAgent: vi.fn(),
  normalizePublicCopy: vi.fn(),
}));

vi.mock("./db", () => ({
  getPool,
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

vi.mock("./cvRequest", () => ({
  ensureCvRequestMessage: vi.fn(),
  deliverCvRequestMessage: vi.fn(),
  requestCvForApplication: vi.fn().mockResolvedValue(null),
  dispatchWelcomeMessage: vi.fn().mockResolvedValue(null),
}));

vi.mock("./profileEditorial", () => ({
  normalizePublicCopy,
  PROFILE_EDITORIAL_MODEL: "gpt-4.1-mini-2025-04-14",
  PUBLIC_COPY_EDITORIAL_MODEL: "gpt-4.1-mini-2025-04-14",
  PUBLIC_COPY_EDITORIAL_POLICY_VERSION: "2026-09-10.3",
}));

vi.mock("./agentEvaluator", () => ({
  evaluateApplicationWithAgent,
  verifyLangfuseConnection: vi.fn(),
  verifyProviderConnection: vi.fn(),
}));

vi.mock("./importForms", () => ({
  importSpreadsheetForm,
  derivePhoneColumn: vi.fn(),
  deriveNameColumn: vi.fn(),
  parseSpreadsheetGrid: vi.fn(),
}));

import { appRouter } from "./routers";

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "email:admin@example.test",
      name: "Administración",
      email: "admin@example.test",
      loginMethod: "email_code",
      role: "admin",
      active: true,
    } as NonNullable<TrpcContext["user"]>,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  importSpreadsheetForm.mockResolvedValue({
    formId: 21,
    formVersion: 2,
    questionCount: 15,
    rowsImported: 77,
    rowsSkippedNoPhone: 0,
    candidatesCreated: 40,
    candidatesExisting: 37,
    applicationsCreated: 40,
    applicationsUpdated: 37,
    answersInserted: 900,
    affectedApplicationIds: [1, 2, 3],
  });
});

afterEach(() => vi.clearAllMocks());

describe("forms.importSpreadsheet", () => {
  it("carga candidatos y respuestas pero no ejecuta la evaluación automática con IA", async () => {
    getPool.mockResolvedValue({ query: vi.fn() });

    const result = await appRouter
      .createCaller(createAdminContext())
      .forms.importSpreadsheet({
        positionId: 4,
        fileName: "Postulantes - Desarrollador Odoo.xlsx",
        base64: Buffer.from("Nombre;WhatsApp\nAna;+502 5555 1234\n").toString(
          "base64"
        ),
      });

    expect(result.rowsImported).toBe(77);
    expect(result.answersInserted).toBe(900);
    expect(result.affectedApplicationIds).toEqual([1, 2, 3]);
    expect(importSpreadsheetForm).toHaveBeenCalledTimes(1);
    expect(evaluateApplicationWithAgent).not.toHaveBeenCalled();
  });

  it("rechaza archivos que no sean CSV o Excel", async () => {
    getPool.mockResolvedValue({ query: vi.fn() });

    await expect(
      appRouter
        .createCaller(createAdminContext())
        .forms.importSpreadsheet({
          positionId: 4,
          fileName: "Postulantes.pdf",
          base64: Buffer.from("x").toString("base64"),
        })
    ).rejects.toThrow("CSV");

    expect(importSpreadsheetForm).not.toHaveBeenCalled();
    expect(evaluateApplicationWithAgent).not.toHaveBeenCalled();
  });
});
