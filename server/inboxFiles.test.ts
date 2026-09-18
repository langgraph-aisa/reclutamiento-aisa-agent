import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Sólo se dobla la frontera SQL/usuarios. HTTP, rutas, sesión JWT, capacidad
// firmada, bytes en disco y rangos se ejecutan con sus implementaciones reales.
const boundary = vi.hoisted(() => ({
  available: true,
  rows: new Map<string, { id: number; original_name: string; mime_type: string; storage_key: string }>(),
}));
vi.mock("./db", () => ({
  getPool: async () => boundary.available ? {
    query: async (_sql: string, values: unknown[]) => ({
      rows: boundary.rows.has(String(values[0])) ? [boundary.rows.get(String(values[0]))] : [],
    }),
  } : null,
  getUserById: async (id: number) => ({
    id,
    role: id === 1 ? "admin" : id === 2 || id === 4 ? "reclutador" : "user",
    active: id !== 4,
  }),
}));

import { registerInboxFileRoutes, writeInboxFile } from "./inboxFiles";
import { issueLocalSession, LOCAL_SESSION_COOKIE } from "./localAuth";
import { createViewerToken } from "./viewerAccess";

const bytes = Buffer.from("%PDF-1.4\nDocumento ficticio de prueba HTTP.\n%%EOF\n");
const key = "in-42/11111111-2222-3333-4444-555555555555";
let storageRoot: string;
let server: Server;
let baseUrl: string;
let cookies: Record<number, string>;

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-files-http-"));
  vi.stubEnv("KNOWLEDGE_STORAGE_DIR", storageRoot);
  vi.stubEnv("JWT_SECRET", "inbox-files-http-synthetic-session-secret");
  await writeInboxFile(key, bytes);
  cookies = Object.fromEntries(await Promise.all([1, 2, 3, 4].map(async id => [
    id, `${LOCAL_SESSION_COOKIE}=${await issueLocalSession(id)}`,
  ])));
  const app = express();
  registerInboxFileRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No se asignó puerto HTTP.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  boundary.available = true;
  boundary.rows.clear();
  boundary.rows.set(key, { id: 42, original_name: "fixture.pdf", mime_type: "application/pdf", storage_key: key });
});

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function fileUrl(fileKey = key) {
  return `${baseUrl}/api/inbox/files/${encodeURIComponent(fileKey)}`;
}

describe("archivo de bandeja mediante HTTP real", () => {
  it.each([1, 2])("entrega todos los bytes a usuario autorizado %s y clave con barra codificada", async id => {
    const response = await fetch(fileUrl(), { headers: { Cookie: cookies[id] } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="fixture.pdf"');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([0, 3, 4])("rechaza sesión ausente, rol distinto o cuenta inactiva (%s)", async id => {
    const response = await fetch(fileUrl(), { headers: id ? { Cookie: cookies[id] } : {} });
    expect(response.status).toBe(403);
    await response.arrayBuffer();
  });

  it("permite al proveedor descargar una capacidad firmada para ese archivo", async () => {
    const token = createViewerToken("inbox", key);
    const response = await fetch(`${fileUrl()}?t=${encodeURIComponent(token)}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("rechaza una capacidad firmada para otro recurso", async () => {
    const token = createViewerToken("inbox", "in-42/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const response = await fetch(`${fileUrl()}?t=${encodeURIComponent(token)}`);
    expect(response.status).toBe(403);
    await response.arrayBuffer();
  });

  it.each([
    ["bytes=0-9", 0, 9],
    ["bytes=10-", 10, bytes.length - 1],
    ["bytes=-7", bytes.length - 7, bytes.length - 1],
    ["bytes=-9999", 0, bytes.length - 1],
  ] as const)("sirve rango %s con bytes y Content-Range correctos", async (range, start, end) => {
    const response = await fetch(fileUrl(), { headers: { Cookie: cookies[2], Range: range } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/${bytes.length}`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(start, end + 1));
  });

  it.each(["bytes=-0", "bytes=-", "bytes=99999-", "bytes=9-3", "bytes=0-1,5-9"])("rechaza rango no satisfacible %s", async range => {
    const response = await fetch(fileUrl(), { headers: { Cookie: cookies[2], Range: range } });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${bytes.length}`);
    await response.arrayBuffer();
  });

  it("distingue una base de datos indisponible", async () => {
    boundary.available = false;
    const response = await fetch(fileUrl(), { headers: { Cookie: cookies[1] } });
    expect(response.status).toBe(503);
    await response.arrayBuffer();
  });

  it("distingue un registro cuyos bytes faltan del volumen", async () => {
    const missing = "in-42/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    boundary.rows.set(missing, { id: 43, original_name: "missing.pdf", mime_type: "application/pdf", storage_key: missing });
    const response = await fetch(fileUrl(missing), { headers: { Cookie: cookies[1] } });
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual(expect.objectContaining({ error: expect.stringContaining("volumen") }));
  });
});
