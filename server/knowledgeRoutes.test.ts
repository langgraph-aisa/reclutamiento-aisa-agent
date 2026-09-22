import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Prueba de extremo a extremo de la entrega del visor.
 *
 * Monta la ruta real sobre un servidor HTTP y comprueba qué ocurre cuando el
 * binario está en el volumen y cuando no lo está. El segundo caso es el que
 * producía un mensaje genérico imposible de diagnosticar.
 */

const PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.7\n", "utf8"),
  Buffer.from("contenido del documento", "utf8"),
]);

let queryResult: { rows: unknown[] } = { rows: [] };
const queryMock = vi.fn(async () => queryResult);

vi.mock("./db", () => ({
  getPool: async () => ({ query: queryMock }),
  currentPool: () => ({ query: queryMock }),
  getUserById: async () => ({ id: 1, role: "admin", active: true }),
}));

vi.mock("./localAuth", () => ({
  readLocalSession: async () => null,
}));

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rag-viewer-e2e-"));
process.env.KNOWLEDGE_STORAGE_DIR = storageRoot;

const { registerKnowledgeRoutes } = await import("./knowledgeRoutes");
const { createViewerToken } = await import("./viewerAccess");
const { knowledgeStorageHealth } = await import("./knowledge");

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  registerKnowledgeRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

function registerPdfRow(id: number, storageKey: string) {
  queryResult = {
    rows: [
      {
        id,
        original_name: "SIERA-GT-SOLAR-GT.pdf",
        storage_key: storageKey,
        mime_type: "application/pdf",
        extension: "pdf",
        size_bytes: PDF_BYTES.length,
      },
    ],
  };
}

function writeStoredPdf(storageKey: string) {
  const target = path.join(storageRoot, ...storageKey.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, PDF_BYTES);
  return target;
}

describe("entrega del visor de conocimiento", () => {
  it("entrega el documento cuando el binario existe en el volumen", async () => {
    const storageKey = "3/11111111-2222-3333-4444-555555555555.pdf";
    writeStoredPdf(storageKey);
    registerPdfRow(11, storageKey);

    const token = createViewerToken("knowledge", 11);
    const response = await fetch(
      `${baseUrl}/api/knowledge/files/11?t=${encodeURIComponent(token)}`,
      { headers: { Accept: "application/pdf,*/*" } }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).equals(PDF_BYTES)).toBe(
      true
    );
  });

  it("sirve rangos de bytes para el paginado del visor", async () => {
    const storageKey = "3/22222222-2222-3333-4444-555555555555.pdf";
    writeStoredPdf(storageKey);
    registerPdfRow(12, storageKey);

    const token = createViewerToken("knowledge", 12);
    const response = await fetch(
      `${baseUrl}/api/knowledge/files/12?t=${encodeURIComponent(token)}`,
      { headers: { Range: "bytes=0-9" } }
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 0-9/${PDF_BYTES.length}`
    );
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it("explica que el archivo falta del volumen y responde HTML al visor", async () => {
    const storageKey = "3/33333333-2222-3333-4444-555555555555.pdf";
    // No se escribe el archivo: reproduce un volumen recreado sin sus binarios.
    registerPdfRow(13, storageKey);

    const token = createViewerToken("knowledge", 13);
    const response = await fetch(
      `${baseUrl}/api/knowledge/files/13?t=${encodeURIComponent(token)}`,
      { headers: { Accept: "text/html,application/xhtml+xml" } }
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("No fue posible abrir el documento");
    expect(body).toContain("no está en el volumen de almacenamiento");
    expect(body).toContain("KNOWLEDGE_STORAGE_DIR");
    // El visor nunca debe recibir el objeto JSON crudo.
    expect(body).not.toContain('"error"');
  });

  it("responde JSON cuando la petición no proviene del visor", async () => {
    const storageKey = "3/44444444-2222-3333-4444-555555555555.pdf";
    registerPdfRow(14, storageKey);

    const token = createViewerToken("knowledge", 14);
    const response = await fetch(
      `${baseUrl}/api/knowledge/files/14?t=${encodeURIComponent(token)}`,
      { headers: { Accept: "application/json" } }
    );

    expect(response.status).toBe(410);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("volumen de almacenamiento");
  });

  it("rechaza la entrega sin sesión ni vale válido", async () => {
    const storageKey = "3/55555555-2222-3333-4444-555555555555.pdf";
    writeStoredPdf(storageKey);
    registerPdfRow(15, storageKey);

    const response = await fetch(`${baseUrl}/api/knowledge/files/15`);
    expect(response.status).toBe(403);
  });

  it("rechaza un vale acuñado para otro archivo", async () => {
    const storageKey = "3/66666666-2222-3333-4444-555555555555.pdf";
    writeStoredPdf(storageKey);
    registerPdfRow(16, storageKey);

    const token = createViewerToken("knowledge", 99);
    const response = await fetch(
      `${baseUrl}/api/knowledge/files/16?t=${encodeURIComponent(token)}`
    );
    expect(response.status).toBe(403);
  });

  it("no filtra la referencia interna en la respuesta al visor", async () => {
    const storageKey = "3/77777777-2222-3333-4444-555555555555.pdf";
    registerPdfRow(17, storageKey);

    const token = createViewerToken("knowledge", 17);
    const body = await (
      await fetch(
        `${baseUrl}/api/knowledge/files/17?t=${encodeURIComponent(token)}`,
        { headers: { Accept: "text/html" } }
      )
    ).text();

    expect(body).not.toContain("77777777");
    expect(body).not.toContain(storageRoot);
  });
});

describe("diagnóstico del volumen de conocimiento", () => {
  it("informa cuántos documentos registrados faltan en el volumen", async () => {
    const present = "8/88888888-2222-3333-4444-555555555555.pdf";
    const absent = "8/99999999-2222-3333-4444-555555555555.pdf";
    writeStoredPdf(present);
    queryResult = {
      rows: [
        {
          id: 21,
          original_name: "SIERA-GT-SOLAR-GT.pdf",
          storage_key: present,
          uploaded_at: new Date("2026-09-14T11:38:00Z"),
        },
        {
          id: 22,
          original_name: "MST-EIR-SOLAR-GT.pdf",
          storage_key: absent,
          uploaded_at: new Date("2026-09-14T11:38:00Z"),
        },
      ],
    };

    const health = await knowledgeStorageHealth(
      { query: queryMock } as never
    );

    expect(health.directoryExists).toBe(true);
    expect(health.registered).toBe(2);
    expect(health.present).toBe(1);
    expect(health.missing).toBe(1);
    expect(health.missingSample).toHaveLength(1);
    expect(health.missingSample[0]?.originalName).toBe("MST-EIR-SOLAR-GT.pdf");
  });

  it("trata una referencia inválida como documento ausente sin lanzar", async () => {
    queryResult = {
      rows: [
        {
          id: 23,
          original_name: "referencia-corrupta.pdf",
          storage_key: "../fuera-del-volumen.pdf",
          uploaded_at: new Date("2026-09-14T11:38:00Z"),
        },
      ],
    };

    const health = await knowledgeStorageHealth(
      { query: queryMock } as never
    );
    expect(health.missing).toBe(1);
    expect(health.present).toBe(0);
  });

  it("informa el directorio resuelto para comparar ambientes", async () => {
    queryResult = { rows: [] };
    const health = await knowledgeStorageHealth(
      { query: queryMock } as never
    );
    expect(health.directory).toBe(path.resolve(storageRoot));
    expect(health.registered).toBe(0);
  });
});
