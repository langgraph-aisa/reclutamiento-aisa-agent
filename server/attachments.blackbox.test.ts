import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerApiChatWebhook, processApiChatMessage } from "./apiChatWebhook";
import { runApiChatReceiptSweep } from "./apiChatReceipts";
import { registerInboxFileRoutes } from "./inboxFiles";
import { issueLocalSession, LOCAL_SESSION_COOKIE } from "./localAuth";
import { createMediaTestDatabase } from "./testSupport/mediaDatabase";
import { syntheticPdf } from "./testSupport/mediaFixtures";
import { runCandidateDocumentSweep } from "./candidateDocumentWorker";

const enabled = Boolean(process.env.MEDIA_TEST_DATABASE_URL);
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
describe.runIf(enabled)("Caja negra HTTP / PostgreSQL / archivos reales", () => {
  let database: Awaited<ReturnType<typeof createMediaTestDatabase>>;
  let server: Server;
  let base: string;
  let directory: string;
  let cookie: string;
  let conversationId: number;
  let applicationId: number;
  let available = true;
  const pdf = syntheticPdf();
  const fileEvent = (id: string) => ({ id, number: "50255550001", type: "file", filename: "curriculum.pdf",
    from_me: false, time: 1789730700, url: "data:application/pdf;base64," + pdf.toString("base64") });
  const post = (body: unknown, key = "synthetic-webhook-secret") => fetch(base + "/api/apichat/webhook?key=" + key, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  async function messages() {
    const response = await fetch(base + "/api/trpc/inbox.detail?input=" +
      encodeURIComponent(JSON.stringify({ json: { conversationId } })), { headers: { cookie } });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body.result.data.json.messages as Array<Record<string, any>>;
  }
  beforeAll(async () => {
    database = await createMediaTestDatabase();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "aisa-http-"));
    vi.stubEnv("DATABASE_URL", database.url);
    vi.stubEnv("KNOWLEDGE_STORAGE_DIR", directory);
    vi.stubEnv("JWT_SECRET", "only-for-synthetic-local-blackbox-tests");
    vi.stubEnv("APICHAT_WEBHOOK_SECRET", "synthetic-webhook-secret");
    vi.stubEnv("DOCUMENT_OCR_ENABLED", "false");
    const pool = database.pool;
    const user = (await pool.query("INSERT INTO users(open_id,role,active) VALUES('test-admin','admin',true) RETURNING id")).rows[0].id;
    cookie = LOCAL_SESSION_COOKIE + "=" + await issueLocalSession(user);
    const position = (await pool.query("INSERT INTO job_positions(public_slug,code,title,agent_key) VALUES('http-test','http-test','Ingeniero','test') RETURNING id")).rows[0].id;
    const form = (await pool.query("INSERT INTO application_forms(job_position_id,title) VALUES($1,'Prueba') RETURNING id", [position])).rows[0].id;
    const candidate = (await pool.query("INSERT INTO candidates(phone_international,full_name) VALUES('+50255550001','Candidato sintético') RETURNING id")).rows[0].id;
    applicationId = (await pool.query("INSERT INTO applications(candidate_id,job_position_id,form_id) VALUES($1,$2,$3) RETURNING id", [candidate, position, form])).rows[0].id;
    conversationId = (await pool.query("INSERT INTO conversations(application_id) VALUES($1) RETURNING id", [applicationId])).rows[0].id;
    const { appRouter } = await import("./routers");
    const { createContext } = await import("./_core/context");
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    registerApiChatWebhook(app, async () => available ? pool : null);
    registerInboxFileRoutes(app);
    app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
    server = createServer(app).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Puerto no disponible");
    base = "http://127.0.0.1:" + address.port;
  }, 60_000);
  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    const { getPool } = await import("./db");
    await (await getPool())?.end();
    await database?.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  it("rechaza un secreto incorrecto y no confirma cuando la base no está disponible", async () => {
    expect((await post({ messages: [fileEvent("unauthorized")] }, "wrong")).status).toBe(401);
    available = false;
    try { expect((await post({ messages: [fileEvent("unavailable")] })).status).toBe(503); }
    finally { available = true; }
    expect((await messages()).length).toBe(0);
  });
  it("confirma sólo después de conservar el lote, sobrevive a detener el consumidor y muestra PDF y texto", async () => {
    const response = await post({ messages: [fileEvent("pdf-1"), {
      id: "text-1", number: "50255550001", type: "text", text: "Este es mi CV", from_me: false,
    }] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: 2, queued: 2 });
    // No hay worker en ejecución: el acuse significa conservación, no análisis.
    expect((await messages()).length).toBe(0);
    // Otro consumidor, sin memoria del request original, recupera el trabajo.
    expect(await runApiChatReceiptSweep(database.pool, processApiChatMessage)).toEqual({ completed: 2, failed: 0 });
    const rows = await messages();
    expect(rows.map(row => row.message_type)).toEqual(["file", "text"]);
    expect(rows[0]).toMatchObject({ media_file_name: "curriculum.pdf", media_processing_status: "pendiente" });
    expect(rows[0].media_storage_key).toMatch(/^in-\d+\/[a-f0-9]{64}$/);
  });
  it("descarga los mismos bytes y rangos mediante la URL exacta usada por la bandeja", async () => {
    const row = (await messages()).find(row => row.media_file_name === "curriculum.pdf")!;
    const url = base + "/api/inbox/files/" + encodeURIComponent(row.media_storage_key);
    expect((await fetch(url)).status).toBe(403);
    const response = await fetch(url, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(sha(Buffer.from(await response.arrayBuffer()))).toBe(sha(pdf));
    const range = await fetch(url, { headers: { cookie, range: "bytes=-8" } });
    expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(pdf.subarray(-8));
  });
  it("repeticiones concurrentes y cruces webhook/historial no duplican mensaje, documento ni trabajo", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => post({ messages: [fileEvent("pdf-1")] })));
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ queued: 0, duplicates: 1 });
    }
    const { enqueueApiChatReceipts } = await import("./apiChatReceipts");
    expect(await enqueueApiChatReceipts(database.pool, [{ message: fileEvent("pdf-1") }], "sondeo")).toMatchObject({ duplicates: 1 });
    await runApiChatReceiptSweep(database.pool, processApiChatMessage);
    expect((await messages()).filter(row => row.media_file_name === "curriculum.pdf")).toHaveLength(1);
    expect((await database.pool.query("SELECT count(*)::int n FROM candidate_knowledge_files")).rows[0].n).toBe(1);
    expect((await database.pool.query("SELECT count(*)::int n FROM candidate_document_jobs")).rows[0].n).toBe(1);
  });
  it("el PDF real pasa de pendiente a analizado; sólo el proveedor de IA se simula", async () => {
    const analyze = vi.fn(async (_pool: unknown, _fileId: number, text: string) => {
      expect(text).toContain("Software engineer");
      return { summary: "Experiencia en sistemas.", deepAnalysis: "Cinco años en ingeniería.",
        model: "gpt-4.1-mini-2025-04-14" as const, keySlot: "primary" as const, documentClass: "cv" as const };
    });
    const result = await runCandidateDocumentSweep(database.pool, { dependencies: { analyze: analyze as never } });
    expect(result).toHaveLength(1);
    expect(analyze).toHaveBeenCalledOnce();
    const row = (await messages()).find(row => row.media_file_name === "curriculum.pdf")!;
    expect(row.media_processing_status).toBe("analizado");
  });
  it("conserva los miembros válidos de un lote mixto y distingue salida propia", async () => {
    const response = await post({ messages: [{ no: "message" }, { ...fileEvent("outgoing-1"), from_me: true }] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ queued: 1, rejected: 1 });
    await runApiChatReceiptSweep(database.pool, processApiChatMessage);
    const rows = await messages();
    expect(rows.filter(row => row.direction === "outbound")).toHaveLength(1);
    expect((await database.pool.query("SELECT count(*)::int n FROM candidate_knowledge_files")).rows[0].n).toBe(1);
  });
  it("un adjunto sin contenido permanece visible con motivo explícito", async () => {
    expect((await post({ messages: [{ id: "missing-1", number: "50255550001", type: "file", filename: "faltante.pdf" }] })).status).toBe(200);
    await runApiChatReceiptSweep(database.pool, processApiChatMessage);
    expect((await messages()).find(row => row.media_file_name === "faltante.pdf")).toMatchObject({
      media_processing_outcome: "rejected", media_processing_reason: "contenido_no_disponible",
    });
  });
  it("un fallo transitorio conserva la carga y se recupera sin duplicar", async () => {
    await post({ messages: [{ id: "retry-1", number: "50255550001", type: "text", text: "Recuperación" }] });
    expect(await runApiChatReceiptSweep(database.pool, async () => { throw new Error("synthetic-failure"); })).toMatchObject({ failed: 1 });
    expect((await messages()).filter(row => row.body === "Recuperación")).toHaveLength(0);
    await database.pool.query("UPDATE apichat_inbound_receipts SET next_attempt_at=now() WHERE provider_message_id='retry-1'");
    await runApiChatReceiptSweep(database.pool, processApiChatMessage);
    expect((await messages()).filter(row => row.body === "Recuperación")).toHaveLength(1);
    const receipt = (await database.pool.query("SELECT payload,status FROM apichat_inbound_receipts WHERE provider_message_id='retry-1'")).rows[0];
    expect(receipt).toEqual({ payload: null, status: "completed" });
  });
});

