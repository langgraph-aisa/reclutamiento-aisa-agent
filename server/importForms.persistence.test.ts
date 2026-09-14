import { describe, expect, it, vi } from "vitest";
import { importSpreadsheetForm } from "./importForms";

type RecordedQuery = { sql: string; params?: unknown[] };

/**
 * Pool simulado que reproduce la idempotencia de PostgreSQL: el mismo número
 * de WhatsApp reutiliza el candidato, la postulación y la respuesta en lugar de
 * crear duplicados, igual que los índices únicos de la base de datos.
 */
function createFakePool(options: { existingFormLabels?: string[] } = {}) {
  const queries: RecordedQuery[] = [];
  const candidatePhones = new Set<string>();
  const applications = new Map<string, number>();
  const answers = new Set<string>();
  const existingFormLabels = options.existingFormLabels ?? null;
  let candidateId = 54;
  let applicationId = 76;
  let questionId = 100;
  let answerId = 500;

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("FROM job_positions")) return { rows: [{ id: 4 }] };
      if (sql.includes("jsonb_agg(q.label"))
        return existingFormLabels
          ? {
              rows: [
                {
                  id: 21,
                  version: 2,
                  published: true,
                  public_token: "firmaexistente00000000000000000",
                  labels: existingFormLabels,
                },
              ],
            }
          : { rows: [] };
      if (sql.includes("SELECT id FROM form_questions"))
        return { rows: existingFormLabels ? existingFormLabels.map((_, i) => ({ id: 300 + i })) : [] };
      if (sql.includes("COALESCE(MAX(version)"))
        return { rows: [{ version: 2 }] };
      if (sql.includes("INSERT INTO application_forms"))
        return { rows: [{ id: 21 }] };
      if (sql.includes("INSERT INTO form_questions"))
        return { rows: [{ id: questionId++ }] };
      if (sql.includes("FROM candidates WHERE phone_international"))
        return { rows: candidatePhones.has(String(params[0])) ? [{}] : [] };
      if (sql.includes("INSERT INTO candidates")) {
        const phone = String(params[0]);
        if (!candidatePhones.has(phone)) {
          candidatePhones.add(phone);
          candidateId++;
        }
        return { rows: [{ id: candidateId }] };
      }
      if (sql.includes("FROM applications WHERE candidate_id")) {
        const key = `${params[0]}:${params[1]}`;
        const found = applications.get(key);
        return { rows: found ? [{ id: found }] : [] };
      }
      if (sql.includes("INSERT INTO applications")) {
        const key = `${params[0]}:${params[1]}`;
        applicationId++;
        applications.set(key, applicationId);
        return { rows: [{ id: applicationId }] };
      }
      if (sql.includes("INSERT INTO application_answers")) {
        const key = `${params[0]}:${params[1]}`;
        if (answers.has(key)) return { rows: [] };
        answers.add(key);
        return { rows: [{ id: answerId++ }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  return {
    pool: { connect: vi.fn(async () => client) } as never,
    queries,
  };
}

describe("importSpreadsheetForm", () => {
  it("crea una variante nueva cuando las preguntas son distintas", async () => {
    const { pool, queries } = createFakePool({
      existingFormLabels: ["Pregunta de otra variante"],
    });

    const result = await importSpreadsheetForm(pool, {
      positionId: 4,
      fileName: "Postulantes - Desarrollador Odoo.xlsx",
      buffer: Buffer.from(
        "Nombre;WhatsApp;Experiencia\nAna Pérez;+502 5555 1234;5\n",
        "utf8"
      ),
      actorUserId: 7,
    });

    const formInsertions = queries.filter(query =>
      query.sql.includes("INSERT INTO application_forms")
    );
    expect(formInsertions).toHaveLength(1);
    expect(formInsertions[0]?.sql).toContain("false,'importado'");

    expect(result.formId).toBe(21);
    expect(result.formVersion).toBe(2);
    expect(result.rowsImported).toBe(1);
    expect(result.candidatesCreated).toBe(1);
    expect(result.applicationsCreated).toBe(1);
    expect(result.answersInserted).toBe(1);

    expect(
      queries.filter(query => query.sql.includes("INSERT INTO applications"))
    ).toHaveLength(1);
    expect(
      queries.filter(query => query.sql.includes("INSERT INTO audit_log"))
    ).toHaveLength(1);
    const auditCall = queries.find(query =>
      query.sql.includes("INSERT INTO audit_log")
    );
    expect(auditCall?.params?.[2]).toBe("form_imported");
    expect(result.reusedForm).toBe(false);
  });

  it("reutiliza el instrumento existente cuando las preguntas coinciden", async () => {
    const { pool, queries } = createFakePool({
      existingFormLabels: ["Experiencia"],
    });

    const result = await importSpreadsheetForm(pool, {
      positionId: 4,
      fileName: "Postulantes - Desarrollador Odoo.xlsx",
      buffer: Buffer.from(
        "Nombre;WhatsApp;Experiencia\nAna Pérez;+502 5555 1234;5\n",
        "utf8"
      ),
      actorUserId: 7,
    });

    expect(result.reusedForm).toBe(true);
    expect(result.formId).toBe(21);
    expect(result.formVersion).toBe(2);
    expect(result.formPublicToken).toBe("firmaexistente00000000000000000");
    expect(
      queries.filter(query =>
        query.sql.includes("INSERT INTO application_forms")
      )
    ).toHaveLength(0);
    expect(
      queries.filter(query =>
        query.sql.includes("INSERT INTO form_questions")
      )
    ).toHaveLength(0);
    const answerCall = queries.find(query =>
      query.sql.includes("INSERT INTO application_answers")
    );
    expect(answerCall?.params?.[1]).toBe(300);
    const auditCall = queries.find(query =>
      query.sql.includes("INSERT INTO audit_log")
    );
    expect(auditCall?.params?.[2]).toBe("form_import_reused");
  });

  it("no duplica candidato ni postulación cuando la hoja repite el mismo número", async () => {
    const { pool, queries } = createFakePool();

    const result = await importSpreadsheetForm(pool, {
      positionId: 4,
      fileName: "Postulantes.csv",
      buffer: Buffer.from(
        "Nombre;WhatsApp;Experiencia\nAna Pérez;+502 5555 1234;5\nAna Pérez;+502 5555 1234;6\n",
        "utf8"
      ),
      actorUserId: 7,
    });

    expect(
      queries.filter(query =>
        query.sql.includes("INSERT INTO application_forms")
      )
    ).toHaveLength(1);
    expect(
      queries.filter(query => query.sql.includes("INSERT INTO applications"))
    ).toHaveLength(1);
    expect(result.candidatesCreated).toBe(1);
    expect(result.candidatesExisting).toBe(1);
    expect(result.applicationsCreated).toBe(1);
    expect(result.rowsImported).toBe(2);
    expect(result.answersInserted).toBe(1);
  });

  it("omite filas sin teléfono válido sin crear candidatos", async () => {
    const { pool, queries } = createFakePool();

    const result = await importSpreadsheetForm(pool, {
      positionId: 4,
      fileName: "Postulantes.csv",
      buffer: Buffer.from("Nombre;WhatsApp;Experiencia\nSin teléfono;;3\n", "utf8"),
      actorUserId: 7,
    });

    expect(result.rowsSkippedNoPhone).toBe(1);
    expect(result.rowsImported).toBe(0);
    expect(result.candidatesCreated).toBe(0);
    expect(
      queries.filter(query => query.sql.includes("INSERT INTO candidates"))
    ).toHaveLength(0);
  });
});
