import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CANDIDATE_DOCUMENT_SOURCES,
  candidateKnowledgeTree,
  registerCandidateInboundDocument,
  saveCandidateDocument,
} from "./candidateKnowledge";
import { detectContentSignature, decodeTransport } from "./base64Transport";
import {
  buildCandidateStorageKey,
  buildStorageKey,
  knowledgeFilePath,
} from "./knowledge";

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rag-candidate-"));
process.env.KNOWLEDGE_STORAGE_DIR = storageRoot;

afterAll(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

const PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.7\n", "utf8"),
  Buffer.from("curriculum vitae", "utf8"),
]);

const SETTINGS = {
  allowedExtensions: ["pdf", "docx", "png", "jpg"],
  maxSizeMb: 20,
};

/** Pool mínimo que responde por tabla y registra lo escrito. */
function makePool(overrides: Record<string, unknown[]> = {}) {
  const inserted: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      const text = String(sql);
      if (/FROM candidate_knowledge_files\s+WHERE application_id=\$1 AND sha256/.test(text)) {
        return { rows: overrides.duplicate ?? [] };
      }
      if (/INSERT INTO candidate_knowledge_files/.test(text)) {
        inserted.push({ sql: text, values: values ?? [] });
        return { rows: [{ id: 900 + inserted.length }] };
      }
      if (/INSERT INTO audit_log/.test(text)) return { rows: [] };
      if (/SELECT id FROM candidate_knowledge_folders/.test(text)) {
        return { rows: overrides.folder ? [{ id: 1 }] : [] };
      }
      if (/FROM candidate_knowledge_folders/.test(text)) {
        return { rows: overrides.folders ?? [] };
      }
      if (/FROM candidate_knowledge_files/.test(text)) {
        return { rows: overrides.files ?? [] };
      }
      if (/WHERE id=\$1 LIMIT 1/.test(text)) {
        return { rows: overrides.file ?? [] };
      }
      return { rows: [] };
    }),
  };
  return { pool, inserted };
}

describe("namespace de almacenamiento del RAG del candidato", () => {
  it("aísla las referencias del candidato bajo el prefijo applications", () => {
    const key = buildCandidateStorageKey(7, "pdf");
    expect(key).toMatch(/^applications\/7\/[a-f0-9-]{36}\.pdf$/);
    // La referencia se resuelve dentro del volumen compartido.
    expect(knowledgeFilePath(key)).toBe(
      path.join(storageRoot, "applications", "7", path.basename(key))
    );
  });

  it("conserva las referencias vigentes del RAG de proyectos", () => {
    // Retrocompatibilidad: la producción ya tiene claves con esta forma.
    const legacy = buildStorageKey(7, "pdf");
    expect(legacy).toMatch(/^7\/[a-f0-9-]{36}\.pdf$/);
    expect(() => knowledgeFilePath(legacy)).not.toThrow();
  });

  it("no comparte carpeta entre un proyecto y una postulación con el mismo número", () => {
    expect(buildStorageKey(7, "pdf")).not.toBe(
      buildCandidateStorageKey(7, "pdf")
    );
    expect(knowledgeFilePath(buildCandidateStorageKey(7, "pdf"))).toContain(
      path.join("applications", "7")
    );
  });

  it("rechaza una referencia con recorrido de directorios", () => {
    for (const key of [
      "../../etc/passwd",
      "applications/7/../../fuera.pdf",
      "/absoluta/7/aaaaaaaaaaaaaaaa.pdf",
      "applications/7/aaaaaaaaaaaaaaaa.exe/../x.pdf",
    ]) {
      expect(() => knowledgeFilePath(key)).toThrow(/no es válida/);
    }
  });
});

describe("registro de documentos del candidato", () => {
  it("guarda el archivo normal con extensión y peso verificados", async () => {
    const { pool, inserted } = makePool();
    const result = await saveCandidateDocument(pool as never, {
      applicationId: 12,
      fileName: "Currículum.pdf",
      base64: PDF_BYTES.toString("base64"),
      allowedExtensions: SETTINGS.allowedExtensions,
      maxBytes: SETTINGS.maxSizeMb * 1024 * 1024,
      actorUserId: 3,
    });

    expect(result.extension).toBe("pdf");
    // El saneador es el mismo del RAG de proyectos: sustituye los caracteres
    // fuera de `[A-Za-z0-9_.-]` para que la cabecera `Content-Disposition` sea
    // siempre válida. La limitación —pérdida de acentos en el nombre visible—
    // es compartida y anterior a esta versión.
    expect(result.originalName).toBe("Curr_culum.pdf");
    // El binario queda en el namespace del candidato, no en el del proyecto.
    const stored = fs.readdirSync(
      path.join(storageRoot, "applications", "12")
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.endsWith(".pdf")).toBe(true);
    // La fila conserva la procedencia, la política y la huella del contenido.
    const values = inserted[0]?.values ?? [];
    expect(values).toContain("manual");
    expect(values).toContain("application/pdf");
    expect(values.some(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))).toBe(
      true
    );
  });

  it("corrige la extensión cuando el contenido contradice lo declarado", async () => {
    const { pool } = makePool();
    const result = await saveCandidateDocument(pool as never, {
      applicationId: 13,
      fileName: "supuesto.jpg",
      base64: PDF_BYTES.toString("base64"),
      allowedExtensions: SETTINGS.allowedExtensions,
      maxBytes: SETTINGS.maxSizeMb * 1024 * 1024,
    });
    expect(result.extension).toBe("pdf");
    expect(result.originalName).toBe("supuesto.pdf");
  });

  it("rechaza una extensión fuera de la configuración compartida", async () => {
    const { pool } = makePool();
    await expect(
      saveCandidateDocument(pool as never, {
        applicationId: 14,
        fileName: "programa.exe",
        base64: Buffer.from("MZ").toString("base64"),
        allowedExtensions: SETTINGS.allowedExtensions,
        maxBytes: SETTINGS.maxSizeMb * 1024 * 1024,
      })
    ).rejects.toThrow(/Extensión no permitida|no es una codificación/);
  });

  it("rechaza un peso por encima de la política configurada", async () => {
    const { pool } = makePool();
    const large = Buffer.concat([PDF_BYTES, Buffer.alloc(4_096, 0x41)]);
    await expect(
      saveCandidateDocument(pool as never, {
        applicationId: 15,
        fileName: "extenso.pdf",
        base64: large.toString("base64"),
        allowedExtensions: SETTINGS.allowedExtensions,
        maxBytes: 1_024,
      })
    ).rejects.toThrow(/límite admitido|peso máximo admitido/);
  });
});

describe("alimentación por webhook", () => {
  const decoded = decodeTransport(
    { dataBase64: PDF_BYTES.toString("base64"), fileName: "Adjunto.pdf" },
    { maxBytes: 5_000_000 }
  );

  it("incorpora al expediente un adjunto recibido del proveedor", async () => {
    const { pool, inserted } = makePool();
    // La configuración compartida se consulta desde la base.
    pool.query = vi.fn(async (sql: string, values?: unknown[]) => {
      const text = String(sql);
      if (/FROM integration_settings/.test(text)) return { rows: [] };
      if (/FROM candidate_knowledge_files\s+WHERE application_id=\$1 AND sha256/.test(text)) {
        return { rows: [] };
      }
      if (/INSERT INTO candidate_knowledge_files/.test(text)) {
        inserted.push({ sql: text, values: values ?? [] });
        return { rows: [{ id: 501 }] };
      }
      return { rows: [] };
    }) as never;

    const result = await registerCandidateInboundDocument(pool as never, {
      applicationId: 21,
      fileName: "Adjunto.pdf",
      decoded,
    });
    expect(result.created).toBe(true);
    expect(result.id).toBe(501);
    const values = inserted[0]?.values ?? [];
    expect(values).toContain("webhook");
  });

  it("no duplica un documento ya incorporado con la misma huella", async () => {
    const { pool } = makePool();
    pool.query = vi.fn(async (sql: string) => {
      const text = String(sql);
      if (/FROM integration_settings/.test(text)) return { rows: [] };
      if (/sha256/.test(text)) return { rows: [{ id: 777 }] };
      return { rows: [] };
    }) as never;

    const result = await registerCandidateInboundDocument(pool as never, {
      applicationId: 22,
      fileName: "Adjunto.pdf",
      decoded,
    });
    expect(result.created).toBe(false);
    expect(result.id).toBe(777);
  });

  it("deja fuera del expediente un formato no habilitado en la configuración", async () => {
    const { pool, inserted } = makePool();
    pool.query = vi.fn(async (sql: string) => {
      const text = String(sql);
      if (/FROM integration_settings/.test(text)) {
        return {
          rows: [
            { setting_key: "allowed_extensions", setting_value: "docx" },
            { setting_key: "max_size_mb", setting_value: "5" },
          ],
        };
      }
      return { rows: [] };
    }) as never;

    const result = await registerCandidateInboundDocument(pool as never, {
      applicationId: 23,
      fileName: "Adjunto.pdf",
      decoded,
    });
    expect(result.created).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});

describe("árbol de documentos del candidato", () => {
  it("compone carpetas, documentos y conteo de análisis", async () => {
    const { pool } = makePool({
      folders: [
        {
          id: 4,
          application_id: 31,
          parent_id: null,
          name: "Títulos",
          created_at: new Date("2026-09-17T10:00:00Z"),
          file_count: 1,
        },
      ],
      files: [
        {
          id: 61,
          application_id: 31,
          folder_id: 4,
          original_name: "Diploma.pdf",
          extension: "pdf",
          mime_type: "application/pdf",
          size_bytes: 2_048,
          source: "webhook",
          summary_66: "Resumen del diploma.",
          deep_analysis: "Análisis profundo del diploma.",
          analysis_status: "analizado",
          analyzed_model: "gpt-4.1-mini-2025-04-14",
          uploaded_at: new Date("2026-09-17T10:05:00Z"),
          updated_at: new Date("2026-09-17T10:06:00Z"),
          uploaded_by_name: null,
        },
        {
          id: 62,
          application_id: 31,
          folder_id: null,
          original_name: "Constancia.pdf",
          extension: "pdf",
          mime_type: "application/pdf",
          size_bytes: 1_024,
          source: "manual",
          summary_66: "",
          deep_analysis: "",
          analysis_status: "pendiente",
          analyzed_model: null,
          uploaded_at: new Date("2026-09-17T10:07:00Z"),
          updated_at: new Date("2026-09-17T10:07:00Z"),
          uploaded_by_name: "José Ardón",
        },
      ],
    });

    const tree = await candidateKnowledgeTree(pool as never, 31);
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0]?.fileCount).toBe(1);
    expect(tree.files).toHaveLength(2);
    expect(tree.files[0]?.kind).toBe("documento");
    expect(tree.analysis).toEqual({ analyzed: 1, pending: 1, notApplicable: 0 });
  });
});

describe("contrato de procedencia", () => {
  it("declara las tres vías admitidas del expediente", () => {
    expect([...CANDIDATE_DOCUMENT_SOURCES]).toEqual([
      "manual",
      "webhook",
      "postulacion",
    ]);
  });

  it("detecta el tipo por contenido sin confiar en la extensión", () => {
    expect(detectContentSignature(PDF_BYTES)?.extension).toBe("pdf");
  });
});
