import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dispatchExpedienteAppreciation,
  listConservedAttachments,
  recoverConservedAttachments,
} from "./candidateConservedRecovery";
import { writeInboxFile } from "./inboxFiles";

/**
 * Carga ausente del adjunto conservado.
 *
 * La prueba reproduce el caso observado en producción —el proveedor entrega el
 * PDF, la bandeja conserva el binario y la política administrativa lo deja
 * fuera del expediente— y exige que la operación restituya la decisión: el
 * documento entra al RAG personal, se analiza, el agente evaluador vuelve a
 * dictaminar y el mensaje deja de declarar una exclusión superada.
 *
 * Se ejecuta contra el volumen real de almacenamiento en un directorio temporal
 * porque la incorporación lee el binario conservado, no una simulación de él.
 */

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conserve-recovery-"));
process.env.KNOWLEDGE_STORAGE_DIR = storageRoot;

afterAll(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

const PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.7\n", "utf8"),
  Buffer.from("curriculum vitae con experiencia administrativa ".repeat(8), "utf8"),
]);

function settingsRows(extensions: string, maxSizeMb: number) {
  return [
    { setting_key: "allowed_extensions", setting_value: extensions },
    { setting_key: "max_size_mb", setting_value: String(maxSizeMb) },
  ];
}

type ConservedRow = {
  id: number;
  file_name: string;
  mime_type: string;
  storage_key: string;
  reason: string | null;
  created_at: string;
};

function conservedRow(overrides: Partial<ConservedRow> = {}): ConservedRow {
  return {
    id: 41,
    file_name: "MST-EIR-SOLAR-GT.pdf",
    mime_type: "application/pdf",
    storage_key: "in-41/aaaaaaaaaaaa",
    reason: "extension_not_allowed",
    created_at: "2026-09-19T15:57:00.000Z",
    ...overrides,
  };
}

/**
 * Pool mínimo que responde por forma de consulta y conserva lo escrito.
 *
 * Se registra el estado en memoria —archivos creados, asientos de auditoría— en
 * lugar de simular cada sentencia por separado: la prueba verifica la conducta
 * del módulo, no la sintaxis del SQL.
 */
function makePool(options: {
  settings?: ReturnType<typeof settingsRows>;
  conserved?: ConservedRow[];
  duplicateId?: number | null;
  missingBinary?: boolean;
  existingFile?: Record<string, unknown> | null;
  previousAcknowledgement?: { messageId: number } | null;
  contact?: Record<string, unknown> | null;
} = {}) {
  const files = new Map<number, Record<string, unknown>>();
  const audit: Array<{ action: string; values: unknown[] }> = [];
  const messageUpdates: Array<{ sql: string; values: unknown[] }> = [];
  let nextId = 900;
  if (options.existingFile)
    files.set(Number(options.existingFile.id), { ...options.existingFile });

  const handle = async (text: string, values: unknown[] = []) => {
    if (/FROM integration_settings/.test(text)) return { rows: options.settings ?? [] };
    if (/FROM conversation_messages m\s+JOIN conversations c/.test(text))
      return { rows: options.conserved ?? [] };
    if (/UPDATE conversation_messages\s+SET metadata = jsonb_set/.test(text)) {
      messageUpdates.push({ sql: text, values });
      return { rows: [] };
    }
    if (
      /SELECT id,analysis_status FROM candidate_knowledge_files WHERE application_id=\$1 AND sha256/.test(
        text
      )
    )
      return {
        rows: options.duplicateId
          ? [
              {
                id: options.duplicateId,
                analysis_status: options.existingFile?.analysis_status ?? "analizado",
              },
            ]
          : [],
      };
    if (/INSERT INTO candidate_knowledge_files/.test(text)) {
      const id = nextId++;
      files.set(id, {
        id,
        application_id: values[0],
        original_name: values[1],
        storage_key: values[2],
        mime_type: values[3],
        extension: values[4],
        analysis_status: "pendiente",
        extracted_text: null,
        extraction_method: null,
        extraction_truncated: false,
      });
      return { rows: [{ id }] };
    }
    if (
      /SELECT id,application_id,storage_key,extension,original_name,mime_type,analysis_status/.test(
        text
      )
    )
      return { rows: files.has(Number(values[0])) ? [files.get(Number(values[0]))] : [] };
    if (/UPDATE candidate_knowledge_files SET analysis_status/.test(text)) {
      const file = files.get(Number(values[2]));
      if (file) file.analysis_status = values[0];
      return { rows: [] };
    }
    if (/UPDATE candidate_knowledge_files SET summary_66/.test(text)) {
      const file = files.get(Number(values[4]));
      if (file) file.analysis_status = "analizado";
      return { rows: [] };
    }
    if (/SELECT count\(\*\) FILTER \(WHERE analysis_status='analizado'\)/.test(text))
      return { rows: [{ analyzed: files.size, pending: 0 }] };
    if (/INSERT INTO audit_log/.test(text)) {
      audit.push({ action: text, values });
      return { rows: [] };
    }
    if (/FROM audit_log\s+WHERE entity_type='candidate_expediente'/.test(text))
      return {
        rows: options.previousAcknowledgement
          ? [
              {
                entity_id: values[0],
                after_json: { messageId: options.previousAcknowledgement.messageId },
              },
            ]
          : [],
      };
    if (/FROM applications a/.test(text))
      return { rows: options.contact ? [options.contact] : [] };
    if (/pg_try_advisory_lock/.test(text)) return { rows: [{ acquired: true }] };
    return { rows: [] };
  };

  const client = {
    query: (text: string, values?: unknown[]) => handle(String(text), values),
    release: () => undefined,
    on: () => undefined,
  };
  return {
    pool: {
      connect: async () => client,
      query: (text: string, values?: unknown[]) => handle(String(text), values),
    },
    files,
    audit,
    messageUpdates,
  };
}

/** Dependencias del análisis: la extracción y el modelo se sustituyen. */
const analysisDependencies = {
  extract: vi.fn(async () => ({
    text: "Experiencia administrativa y contable comprobada.",
    method: "pdf-text",
    truncated: false,
  })),
  analyze: vi.fn(async () => ({
    summary: "Resumen del documento conservado.",
    deepAnalysis: "Análisis profundo del documento conservado.",
    model: "gpt-5-mini",
    documentClass: "cv",
  })),
};

describe("lista de adjuntos conservados fuera del expediente", () => {
  it("declara el motivo asentado en la recepción", async () => {
    const { pool } = makePool({ conserved: [conservedRow()] });
    const list = await listConservedAttachments(pool as never, 4);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      messageId: 41,
      fileName: "MST-EIR-SOLAR-GT.pdf",
      reason: "extension_not_allowed",
    });
  });

  it("no falla cuando la bandeja no conserva nada para la postulación", async () => {
    const { pool } = makePool();
    await expect(listConservedAttachments(pool as never, 4)).resolves.toEqual([]);
  });
});

describe("incorporación del adjunto conservado", () => {
  it("declara el rechazo de política con su causa y el remedio", async () => {
    await writeInboxFile("in-41/aaaaaaaaaaaa", PDF_BYTES);
    const { pool, audit } = makePool({
      settings: settingsRows("docx,png", 20),
      conserved: [conservedRow()],
    });

    const report = await recoverConservedAttachments(pool as never, {
      applicationId: 4,
      actorUserId: 1,
      dependencies: analysisDependencies,
    });

    expect(report.scanned).toBe(1);
    expect(report.rejected).toBe(1);
    expect(report.incorporated).toBe(0);
    expect(report.items[0]).toMatchObject({
      state: "rejected",
      reasonCode: "extension_not_allowed",
      fileId: null,
    });
    expect(report.items[0].detail).toContain("docx, png");
    expect(report.verdict).toContain("habilitar la extensión");
    // Un rechazo no deja asiento de incorporación ni documento creado.
    expect(audit.filter(entry => /candidate_file_recovered/.test(entry.action))).toHaveLength(0);
    // Sin incorporación no hay evidencia nueva: el agente no se reejecuta.
    expect(report.evaluation.status).toBe("skipped");
  });

  it("incorpora, analiza, vincula el mensaje y reevalúa al candidato", async () => {
    await writeInboxFile("in-42/aaaaaaaaaaaa", PDF_BYTES);
    const evaluate = vi.fn(async () => ({
      classification: "Calificado",
      status: "Calificado",
      score: 88,
    }));
    const { pool, files, audit, messageUpdates } = makePool({
      settings: settingsRows("pdf,docx", 20),
      conserved: [conservedRow({ id: 42, storage_key: "in-42/aaaaaaaaaaaa" })],
    });

    const report = await recoverConservedAttachments(pool as never, {
      applicationId: 4,
      actorUserId: 1,
      dependencies: analysisDependencies,
      evaluate: evaluate as never,
    });

    expect(report.incorporated).toBe(1);
    expect(report.items[0]).toMatchObject({ state: "incorporated", fileId: 900 });
    expect(report.items[0].analysisStatus).toBe("analizado");
    expect(files.get(900)?.analysis_status).toBe("analizado");
    // El mensaje deja de declarar el rechazo superado.
    expect(messageUpdates).toHaveLength(1);
    expect(messageUpdates[0].values).toEqual([42, "900", "extension_not_allowed"]);
    // La segunda pasada del agente queda asentada con su dictamen.
    expect(evaluate).toHaveBeenCalledWith(expect.anything(), 4);
    expect(report.evaluation).toMatchObject({
      status: "updated",
      classification: "Calificado",
      score: 88,
    });
    expect(report.verdict).toContain("volvió a ejecutarse");
    expect(
      audit.filter(entry => /agent_reevaluated_after_recovery/.test(entry.action))
    ).toHaveLength(1);
  });

  it("declara la ausencia del binario con su código, sin inventar un documento", async () => {
    const { pool, files } = makePool({
      settings: settingsRows("pdf", 20),
      conserved: [conservedRow({ id: 43, storage_key: "in-43/aaaaaaaaaaaa" })],
    });

    const report = await recoverConservedAttachments(pool as never, {
      applicationId: 4,
      actorUserId: 1,
      dependencies: analysisDependencies,
    });

    expect(report.missing).toBe(1);
    expect(files.size).toBe(0);
    expect(report.items[0]).toMatchObject({
      state: "binary_missing",
      reasonCode: "storage_missing",
    });
    expect(report.verdict).toContain("envío nuevo");
  });

  it("no duplica un documento cuya huella ya consta en el expediente", async () => {
    await writeInboxFile("in-44/aaaaaaaaaaaa", PDF_BYTES);
    const evaluate = vi.fn(async () => ({
      classification: "Calificado",
      score: 70,
    }));
    const { pool, messageUpdates } = makePool({
      settings: settingsRows("pdf", 20),
      conserved: [conservedRow({ id: 44, storage_key: "in-44/aaaaaaaaaaaa" })],
      duplicateId: 512,
      existingFile: {
        id: 512,
        application_id: 4,
        original_name: "MST-EIR-SOLAR-GT.pdf",
        storage_key: "applications/4/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf",
        mime_type: "application/pdf",
        extension: "pdf",
        analysis_status: "analizado",
        extracted_text: "Experiencia administrativa y contable comprobada.",
        extraction_method: "pdf-text",
        extraction_truncated: false,
      },
    });

    const report = await recoverConservedAttachments(pool as never, {
      applicationId: 4,
      actorUserId: 1,
      dependencies: analysisDependencies,
      evaluate: evaluate as never,
    });

    expect(report.duplicates).toBe(1);
    expect(report.items[0]).toMatchObject({ state: "duplicate", fileId: 512 });
    // El vínculo se restituye aunque el binario no se reescriba.
    expect(messageUpdates).toHaveLength(1);
    expect(messageUpdates[0].values[1]).toBe("512");
    // Un documento ya presente no cambia el expediente: no se gasta una llamada.
    expect(evaluate).not.toHaveBeenCalled();
    expect(report.evaluation.status).toBe("skipped");
  });

  it("declara la abstención del agente sin presentarla como fallo del expediente", async () => {
    await writeInboxFile("in-45/aaaaaaaaaaaa", PDF_BYTES);
    const { pool } = makePool({
      settings: settingsRows("pdf", 20),
      conserved: [conservedRow({ id: 45, storage_key: "in-45/aaaaaaaaaaaa" })],
    });

    const report = await recoverConservedAttachments(pool as never, {
      applicationId: 4,
      actorUserId: 1,
      dependencies: analysisDependencies,
      reevaluate: false,
    });

    expect(report.incorporated).toBe(1);
    expect(report.evaluation).toMatchObject({ status: "skipped" });
    expect(report.verdict).toContain("desactivada");
  });

  it("conserva el desenlace documental cuando la reevaluación falla", async () => {
    await writeInboxFile("in-46/aaaaaaaaaaaa", PDF_BYTES);
    const evaluate = vi.fn(async () => {
      throw new Error("El agente evaluador no está disponible.");
    });
    const { pool } = makePool({
      settings: settingsRows("pdf", 20),
      conserved: [conservedRow({ id: 46, storage_key: "in-46/aaaaaaaaaaaa" })],
    });

    const report = await recoverConservedAttachments(pool as never, {
      applicationId: 4,
      actorUserId: 1,
      dependencies: analysisDependencies,
      evaluate: evaluate as never,
    });

    expect(report.incorporated).toBe(1);
    expect(report.evaluation.status).toBe("failed");
    expect(report.verdict).toContain("no pudo completarse");
  });
});

describe("acuse del expediente al candidato", () => {
  const contact = {
    id: 4,
    full_name: "Jose Miguel",
    title: "Auxiliar Administrativo-Contable",
    conversation_id: 77,
    human_takeover: true,
    agent_enabled: false,
  };

  it("no repite un agradecimiento ya asentado", async () => {
    const { pool } = makePool({
      settings: settingsRows("pdf", 20),
      previousAcknowledgement: { messageId: 601 },
    });
    const sendText = vi.fn();
    const outcome = await dispatchExpedienteAppreciation(
      pool as never,
      { applicationId: 4, actorUserId: 1 },
      { sendText: sendText as never }
    );
    expect(outcome).toEqual({ status: "already_acknowledged", messageId: 601 });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("exige el control humano antes de escribir al candidato", async () => {
    const { pool } = makePool({
      settings: settingsRows("pdf", 20),
      contact: { ...contact, human_takeover: false },
    });
    const sendText = vi.fn();
    const outcome = await dispatchExpedienteAppreciation(
      pool as never,
      { applicationId: 4, actorUserId: 1 },
      { sendText: sendText as never }
    );
    expect(outcome).toEqual({ status: "keyboard_not_held" });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("entrega el agradecimiento y el aviso de contacto por el mismo medio", async () => {
    const { pool, audit } = makePool({
      settings: settingsRows("pdf", 20),
      contact,
    });
    const sendText = vi.fn(async () => ({ messageId: 702 }));
    const outcome = await dispatchExpedienteAppreciation(
      pool as never,
      { applicationId: 4, actorUserId: 1 },
      { sendText: sendText as never }
    );

    expect(outcome.status).toBe("sent");
    expect(sendText).toHaveBeenCalledTimes(1);
    const sentText = String(
      (sendText.mock.calls[0] as unknown as [unknown, { text: string }])[1].text
    );
    expect(sentText).toContain("Jose Miguel");
    expect(sentText).toContain("Auxiliar Administrativo-Contable");
    expect(
      audit.filter(entry => /candidate_expediente_acknowledged/.test(entry.action))
    ).toHaveLength(1);
  });

  it("declara la postulación sin candidato en lugar de fallar en silencio", async () => {
    const { pool } = makePool({ settings: settingsRows("pdf", 20) });
    await expect(
      dispatchExpedienteAppreciation(pool as never, {
        applicationId: 999,
        actorUserId: 1,
      })
    ).resolves.toEqual({ status: "unknown_candidate" });
  });
});
