import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeCandidateDocument } from "./candidateKnowledge";
import { DocumentExtractionError } from "./documentExtraction";
import { runCandidateDocumentSweep } from "./candidateDocumentWorker";
import { buildCandidateStorageKey, writeKnowledgeFile } from "./knowledge";

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "candidate-processing-")
);
process.env.KNOWLEDGE_STORAGE_DIR = directory;
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

async function fixture(extension = "ogg") {
  const key = buildCandidateStorageKey(5, extension);
  const bytes = Buffer.from("OggS-local-evidence");
  await writeKnowledgeFile(key, bytes);
  const file: Record<string, unknown> = {
    id: 7,
    application_id: 5,
    storage_key: key,
    extension,
    original_name: `voice.${extension}`,
    mime_type: extension === "ogg" ? "audio/ogg" : "application/pdf",
    analysis_status: "pendiente",
  };
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    writes.push({ sql, values });
    if (sql.includes("pg_try_advisory_lock"))
      return { rows: [{ acquired: true }] };
    if (sql.includes("SELECT id,application_id")) return { rows: [file] };
    if (sql.includes("SET extracted_text")) {
      file.extracted_text = values[0];
      file.extraction_method = values[1];
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = { query, connect: async () => ({ query, release }) };
  return { pool, file, bytes, writes, release };
}

describe("archivo conservado → procesamiento → evidencia", () => {
  it("transcribe los bytes locales de audio y persiste texto y clasificación sin descargar una URL", async () => {
    const f = await fixture();
    const transcribe = vi.fn(async () => ({
      text: "Tengo tres años de experiencia en contabilidad.",
      model: "test-transcriber",
      keySlot: "primary" as const,
      language: "es",
    }));
    const analyze = vi.fn(async () => ({
      summary: "Experiencia declarada.",
      deepAnalysis: "Tres años en contabilidad.",
      model: "gpt-4.1-mini-2025-04-14" as const,
      keySlot: "primary" as const,
      documentClass: "other" as const,
    }));
    const outcome = await analyzeCandidateDocument(f.pool as never, 7, null, {
      transcribe,
      analyze,
    });
    expect(outcome.analysisStatus).toBe("analizado");
    expect(transcribe.mock.calls[0]?.[1]).toMatchObject({
      data: f.bytes,
      mimeType: "audio/ogg",
    });
    expect(
      f.writes.find(w => w.sql.includes("SET transcript"))?.values
    ).toEqual(["Tengo tres años de experiencia en contabilidad.", "7"]);
    expect(
      f.writes.find(w => w.sql.includes("SET summary_66"))?.values[3]
    ).toBe("other");
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("conserva la extracción al fallar el modelo y no vuelve a transcribir durante el reintento", async () => {
    const f = await fixture();
    const transcribe = vi.fn(async () => ({
      text: "Experiencia conservada.",
      model: "test",
      keySlot: "primary" as const,
      language: "es",
    }));
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(new Error("simulated unavailable"))
      .mockResolvedValueOnce({
        summary: "Experiencia.",
        deepAnalysis: "Experiencia conservada.",
        model: "test",
        keySlot: "primary",
        documentClass: "other",
      });
    expect(
      (
        await analyzeCandidateDocument(f.pool as never, 7, null, {
          transcribe,
          analyze,
        })
      ).analysisStatus
    ).toBe("error");
    expect(
      (
        await analyzeCandidateDocument(f.pool as never, 7, null, {
          transcribe,
          analyze,
        })
      ).analysisStatus
    ).toBe("analizado");
    expect(transcribe).toHaveBeenCalledOnce();
  });

  it("distingue OCR deshabilitado de documento ausente y no invoca el modelo", async () => {
    const f = await fixture("pdf");
    const analyze = vi.fn();
    const outcome = await analyzeCandidateDocument(f.pool as never, 7, null, {
      extract: async () => {
        throw new DocumentExtractionError("ocr_disabled", "Requiere OCR.");
      },
      analyze,
    });
    expect(outcome).toMatchObject({
      analysisStatus: "no_aplica",
      errorCode: "ocr_disabled",
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(
      fs.existsSync(path.join(directory, String(f.file.storage_key)))
    ).toBe(true);
  });

  it("reevalúa el perfil cuando el documento analizado es un currículum", async () => {
    const f = await fixture("pdf");
    const evaluate = vi.fn(async () => ({ classification: "apto", score: 81 }));
    const analyze = vi.fn(async () => ({
      summary: "Currículum de ejemplo.",
      deepAnalysis: "Perfil con experiencia comercial.",
      model: "gpt-4.1-mini-2025-04-14" as const,
      keySlot: "primary" as const,
      documentClass: "cv" as const,
    }));
    const base = f.pool.query;
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (
        sql.includes("UPDATE candidate_document_jobs j") &&
        sql.includes("RETURNING file_id,attempts")
      )
        return { rows: [{ file_id: 7, attempts: 1 }] };
      if (sql.includes("SELECT 1 FROM audit_log")) return { rows: [] };
      return base(sql, values);
    });
    f.pool.query = query;

    const outcomes = await runCandidateDocumentSweep(f.pool as never, {
      limit: 1,
      dependencies: {
        extract: async () => ({
          text: "Currículum con experiencia comercial.",
          method: "test",
          truncated: false,
        }),
        analyze,
        evaluate,
      },
    });

    expect(outcomes[0]?.status).toBe("analizado");
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0]?.[1]).toBe(5);
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("candidate_cv_reevaluated")
      )
    ).toBe(true);
  });

  it("no reevalúa el perfil cuando el documento analizado no es un currículum", async () => {
    const f = await fixture("pdf");
    const evaluate = vi.fn();
    const analyze = vi.fn(async () => ({
      summary: "Acta administrativa.",
      deepAnalysis: "Documento sin perfil laboral.",
      model: "gpt-4.1-mini-2025-04-14" as const,
      keySlot: "primary" as const,
      documentClass: "other" as const,
    }));
    const base = f.pool.query;
    f.pool.query = vi.fn(async (sql: string, values: unknown[] = []) =>
      sql.includes("UPDATE candidate_document_jobs j") &&
      sql.includes("RETURNING file_id,attempts")
        ? { rows: [{ file_id: 7, attempts: 1 }] }
        : base(sql, values)
    );

    const outcomes = await runCandidateDocumentSweep(f.pool as never, {
      limit: 1,
      dependencies: {
        extract: async () => ({
          text: "Acta administrativa sin perfil.",
          method: "test",
          truncated: false,
        }),
        analyze,
        evaluate,
      },
    });

    expect(outcomes[0]?.status).toBe("analizado");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("termina después del tercer intento fallido para no bloquear indefinidamente el turno", async () => {
    const f = await fixture();
    const base = f.pool.query;
    f.pool.query = vi.fn(async (sql: string, values: unknown[] = []) =>
      sql.includes("RETURNING file_id,attempts")
        ? { rows: [{ file_id: 7, attempts: 3 }] }
        : base(sql, values)
    );
    await runCandidateDocumentSweep(f.pool as never, {
      limit: 1,
      dependencies: {
        transcribe: async () => {
          throw new Error("unavailable");
        },
      },
    });
    const completion = f.writes.find(w => w.sql.includes("SET state=$1"));
    expect(completion?.values[0]).toBe("failed");
    expect(completion?.values[1]).toBe("analysis_failed");
  });
});
