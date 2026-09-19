/**
 * Reproducción forense del síntoma: el candidato envía su CV en PDF y no llega
 * a la bandeja.
 *
 * Ejecutar desde la raíz del repositorio, con la instancia PostgreSQL de prueba
 * local (base cuyo nombre termina en `_test`):
 *
 *   MEDIA_TEST_DATABASE_URL=postgresql://postgres:<clave>@127.0.0.1:55439/aisa_media_test \
 *     node --import tsx docs/audits/2026-09-18-apichat/reproduccion_pdf_bandeja.ts
 *
 * Método: se crea una base aislada con TODAS las migraciones, una postulación y
 * una conversación reales, y se inyecta el mismo mensaje del PDF en tres formas
 * distintas que el proveedor puede usar. Se ejecuta el trabajador real
 * (`runApiChatReceiptSweep`) y se observa qué queda en la bandeja.
 *
 * Datos ficticios. La única conexión de red es la resolución DNS del nombre
 * reservado `media.apichat.invalid`, que por definición no resuelve.
 *
 * Este archivo CARACTERIZA el comportamiento vigente. Si una corrección cambia
 * lo que aquí se afirma, una aserción fallará: eso es señal de que hay que
 * actualizar el expediente, no un defecto de la prueba.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMediaTestDatabase } from "../../../server/testSupport/mediaDatabase.ts";
import { processApiChatMessage } from "../../../server/apiChatWebhook.ts";
import { enqueueApiChatReceipts, runApiChatReceiptSweep } from "../../../server/apiChatReceipts.ts";
import { summarizeAttachmentPipeline } from "../../../server/attachmentPipeline.ts";

const supplied = process.env.MEDIA_TEST_DATABASE_URL;
if (!supplied) {
  console.error("Falta MEDIA_TEST_DATABASE_URL (base local cuyo nombre termina en _test).");
  process.exit(2);
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-forense-"));
process.env.KNOWLEDGE_STORAGE_DIR = directory;
process.env.APICHAT_WEBHOOK_SECRET = "fixture-forense";
process.env.DOCUMENT_OCR_ENABLED = "false";

const database = await createMediaTestDatabase();
const pool = database.pool;
const phone = "50255550001";
const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
);
const inline = `data:application/pdf;base64,${pdf.toString("base64")}`;

async function seed() {
  const position = (await pool.query(
    `INSERT INTO job_positions(public_slug,code,title,agent_key)
     VALUES('forense-pdf','forense-pdf','Ingeniero','forense') RETURNING id`
  )).rows[0].id;
  const form = (await pool.query(
    `INSERT INTO application_forms(job_position_id,title) VALUES($1,'Forense') RETURNING id`,
    [position]
  )).rows[0].id;
  const candidate = (await pool.query(
    `INSERT INTO candidates(phone_international,full_name)
     VALUES('+50255550001','Candidato sintético') RETURNING id`
  )).rows[0].id;
  const application = (await pool.query(
    `INSERT INTO applications(candidate_id,job_position_id,form_id) VALUES($1,$2,$3) RETURNING id`,
    [candidate, position, form]
  )).rows[0].id;
  const conversation = (await pool.query(
    `INSERT INTO conversations(application_id) VALUES($1) RETURNING id`,
    [application]
  )).rows[0].id;
  return { conversationId: Number(conversation), applicationId: Number(application) };
}

/** Ejecuta el trabajador real hasta agotar los intentos de un recibo. */
async function sweepUntilTerminal(rounds = 12) {
  for (let round = 0; round < rounds; round += 1) {
    await pool.query(`UPDATE apichat_inbound_receipts SET next_attempt_at=now()`);
    await runApiChatReceiptSweep(pool, processApiChatMessage, 1);
  }
}

async function deliver(id: string, url: string | undefined, extra: Record<string, unknown> = {}) {
  const body = {
    messages: [
      {
        id,
        number: phone,
        type: "document",
        filename: "curriculum.pdf",
        mime_type: "application/pdf",
        from_me: false,
        time: 1789730700,
        ...(url === undefined ? {} : { url }),
        ...extra,
      },
    ],
  };
  const accepted = await enqueueApiChatReceipts(pool, body, "webhook");
  await sweepUntilTerminal();
  const receipt = (await pool.query(
    `SELECT status,outcome,attempts,last_error,payload IS NOT NULL AS carga_conservada
       FROM apichat_inbound_receipts WHERE provider_message_id=$1`,
    [id]
  )).rows[0];
  const message = (await pool.query(
    `SELECT id,message_type,
            metadata->'media'->>'processingOutcome' AS ingreso,
            metadata->'media'->>'processingReason'  AS motivo,
            metadata->'media'->>'candidateFileId'   AS documento
       FROM conversation_messages WHERE provider_message_id=$1`,
    [id]
  )).rows[0];
  return { accepted, receipt, message };
}

const { conversationId, applicationId } = await seed();
const casos: Record<string, unknown>[] = [];

// ── Caso A: el proveedor entrega el PDF incrustado (forma que la caja negra sí
//            prueba). Es la referencia de que el conducto funciona.
const a = await deliver("forense-a-inline", inline);
assert.ok(a.message, "El PDF incrustado debe aparecer en la bandeja.");
assert.equal(a.receipt.status, "completed");
casos.push({
  caso: "A · PDF incrustado en base64 (data: URI)",
  forma: "url = data:application/pdf;base64,…",
  recibo: { estado: a.receipt.status, desenlace: a.receipt.outcome, intentos: a.receipt.attempts, error: a.receipt.last_error },
  bandeja: { fila_de_mensaje: Boolean(a.message), documento: a.message.documento },
  veredicto: "El PDF llega a la bandeja y entra al expediente.",
});

// ── Caso B1: URL remota que no supera la guarda de destino público.
const b1 = await deliver("forense-b1-no-publico", "https://127.0.0.1/media/curriculum.pdf");
assert.equal(b1.message, undefined);
assert.equal(b1.receipt.status, "dead");
assert.equal(b1.receipt.attempts, 8);
assert.equal(b1.receipt.last_error, "unsafe_destination:permanente");
casos.push({
  caso: "B1 · PDF por URL remota con destino no público",
  forma: "url = https://127.0.0.1/media/curriculum.pdf",
  recibo: { estado: b1.receipt.status, desenlace: b1.receipt.outcome, intentos: b1.receipt.attempts, error: b1.receipt.last_error },
  bandeja: { fila_de_mensaje: Boolean(b1.message) },
  veredicto:
    "NO llega a la bandeja. El recibo agota ocho intentos y queda en «dead», ahora con el motivo tipado en el asiento: distingue un destino no permitido de un corte de red, y declara que el fallo es permanente.",
});

// ── Caso B2: URL remota pública que no responde (nombre reservado .invalid).
const b2 = await deliver("forense-b2-no-resuelve", "https://media.apichat.invalid/curriculum.pdf");
assert.equal(b2.message, undefined);
assert.equal(b2.receipt.status, "dead");
assert.equal(b2.receipt.last_error, "network_error:reintentable");
casos.push({
  caso: "B2 · PDF por URL remota pública que no responde",
  forma: "url = https://media.apichat.invalid/curriculum.pdf",
  recibo: { estado: b2.receipt.status, desenlace: b2.receipt.outcome, intentos: b2.receipt.attempts, error: b2.receipt.last_error },
  bandeja: { fila_de_mensaje: Boolean(b2.message) },
  veredicto:
    "NO llega a la bandeja. El asiento declara el fallo como de red y reintentable, que es la información necesaria para decidir entre reprocesar y corregir la configuración.",
});

// ── Caso C: el proveedor declara la dirección de medios sin TLS.
//    Observado: el adaptador copia `url` sin validar el esquema, el transporte
//    no puede mover ese origen y devuelve null; el receptor lanza entonces
//    AttachmentContentUnavailable. El mensaje NO se asienta.
const c = await deliver("forense-c-http", "http://media.apichat.invalid/curriculum.pdf");
assert.equal(c.message, undefined);
assert.equal(c.receipt.status, "dead");
assert.equal(c.receipt.attempts, 8);
casos.push({
  caso: "C · PDF por URL sin TLS",
  forma: "url = http://…",
  recibo: { estado: c.receipt.status, desenlace: c.receipt.outcome, intentos: c.receipt.attempts, error: c.receipt.last_error },
  bandeja: { fila_de_mensaje: Boolean(c.message) },
  veredicto:
    "NO llega a la bandeja y tampoco queda asentado como rechazo: el receptor no puede decodificar el origen y lanza una excepción que no es de transporte, de modo que el asiento sólo conserva el nombre genérico del error. Es una pérdida total con rastro sólo en la cola de recepción.",
});

// ── Caso E: el proveedor entrega la dirección en un campo no enumerado.
//    Aquí no hay `url` ni contenido resoluble: el receptor SÍ asienta el
//    mensaje con su motivo, pero no crea documento.
const e = await deliver("forense-e-campo", undefined, { document: "https://media.apichat.invalid/curriculum.pdf" });
assert.ok(e.message, "El mensaje se asienta cuando falta el origen del contenido.");
assert.equal(e.message.ingreso, "rejected");
assert.equal(e.message.motivo, "contenido_no_disponible");
assert.equal(e.message.documento, null);
casos.push({
  caso: "E · PDF en un campo no enumerado del proveedor",
  forma: 'document = "https://…" (campo distinto de url/base64/media)',
  recibo: { estado: e.receipt.status, desenlace: e.receipt.outcome, intentos: e.receipt.attempts, error: e.receipt.last_error },
  bandeja: {
    fila_de_mensaje: Boolean(e.message),
    ingreso: e.message.ingreso,
    motivo: e.message.motivo,
    documento: e.message.documento,
  },
  veredicto:
    "El mensaje aparece en la bandeja como texto con su motivo, pero NO entra al expediente: no hay documento que el motor pueda leer. El detalle de qué claves llegaron no se conserva en el asiento; sí en la traza de transporte.",
});

// ── Diagnóstico agregado del conducto para los dos casos perdidos.
const mortandad = summarizeAttachmentPipeline({ receiptsReceived: 2, receiptsDead: 2, documentsReceived: 1 });
casos.push({
  caso: "D · Qué ve el operador en el informe del conducto",
  estado: mortandad.state,
  veredicto: mortandad.verdict,
  limite:
    "El informe es de SOLO LECTURA: no reintenta ni reprocesa. Un recibo en «dead» es terminal y no existe operación administrativa que lo devuelva a la cola.",
});

// ── Comprobación del número de filas que ve la bandeja del candidato.
const enBandeja = (await pool.query(
  `SELECT count(*)::int AS total FROM conversation_messages
    WHERE conversation_id=$1 AND direction='inbound'`,
  [conversationId]
)).rows[0].total;
const documentos = (await pool.query(
  `SELECT count(*)::int AS total FROM candidate_knowledge_files WHERE application_id=$1`,
  [applicationId]
)).rows[0].total;

console.log(JSON.stringify({
  version_examinada: "2.0.183",
  telefono_ficticio: phone,
  resumen: {
    mensajes_del_pdf_en_bandeja: enBandeja,
    documentos_en_expediente: documentos,
    envios_realizados: 5,
    llegaron_a_la_bandeja: enBandeja,
    no_llegaron: 5 - enBandeja,
  },
  casos,
}, null, 2));

await database.close();
await fs.rm(directory, { recursive: true, force: true });
console.log("\nBase aislada eliminada. Ninguna instancia productiva fue tocada.");
