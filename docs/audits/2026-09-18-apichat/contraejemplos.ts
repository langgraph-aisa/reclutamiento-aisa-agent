/**
 * Caracterización reproducible de defectos existentes; NO certifica corrección.
 *
 * Ejecutar desde la raíz del repositorio:
 *   node --import tsx docs/audits/2026-09-18-apichat/contraejemplos.ts
 *
 * Todos los datos son ficticios. No se abre un puerto, no se accede a una base
 * de datos y no se descarga contenido. El pool simulado valida el argumento que
 * la función real envía a PostgreSQL como jsonb mediante JSON.parse.
 * Si una corrección modifica el comportamiento caracterizado, una aserción
 * fallará: el éxito significa que los contraejemplos siguen siendo observables.
 */
import assert from "node:assert/strict";
import express from "express";
import { normalizeApiChatWebhookPayload } from "../../../server/apiChatWebhook.ts";
import { registerInboxFileRoutes } from "../../../server/inboxFiles.ts";
import {
  describeTransportShape,
  recordTransportTrace,
  redactTransportPayload,
  summarizeTransportTrace,
  transportPayloadBytes,
  TRANSPORT_TRACE_LIMIT_BYTES,
  type TransportTrace,
} from "../../../server/transportTrace.ts";

// Toda llamada accidental a fetch aborta la ejecución sin iniciar una conexión.
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("Esta caracterización prohíbe solicitudes de red.");
};

const results: Record<string, unknown>[] = [];

// 1. Se registra la ruta real y se consulta su matcher; no se llama listen().
const app = express();
registerInboxFileRoutes(app);
type RouteLayer = {
  route?: { path: string };
  match: (path: string) => boolean;
  params?: Record<string, string>;
};
const layers = (app as unknown as { _router: { stack: RouteLayer[] } })._router.stack;
const fileRoute = layers.find(layer => layer.route?.path === "/api/inbox/files/:key");
assert.ok(fileRoute, "Debe existir la ruta real de archivos de la bandeja.");
const storageKey = "in-42/11111111-2222-3333-4444-555555555555";
const rawPath = `/api/inbox/files/${storageKey}`;
const encodedPath = `/api/inbox/files/${encodeURIComponent(storageKey)}`;
const rawMatches = fileRoute.match(rawPath);
const encodedMatches = fileRoute.match(encodedPath);
assert.equal(rawMatches, false);
assert.equal(encodedMatches, true);
assert.equal(fileRoute.params?.key, storageKey);
results.push({
  id: "C01_ruta_con_barra",
  confirmado: true,
  funcion: "registerInboxFileRoutes",
  observado: { rawPath, rawMatches, encodedPath, encodedMatches, claveDecodificadaCorrecta: true },
});

// 2. Misma carga ficticia dentro del sobre messages[] y directamente.
// La cadena tiene firma PDF; aquí no se afirma que sea un PDF completo legible.
const syntheticBytes = Buffer.from("%PDF-1.4\n% fixture de auditoria sin datos personales\n%%EOF\n");
const dataUri = `data:application/pdf;base64,${syntheticBytes.toString("base64")}`;
const message = {
  id: "audit-fixture-message-001",
  number: "000000000000",
  time: 1789737600,
  from_me: false,
  type: "file",
  filename: "fixture-auditoria.pdf",
  mime_type: "application/pdf",
  url: dataUri,
};
const callbackResult = normalizeApiChatWebhookPayload({ messages: [message] });
const directResult = normalizeApiChatWebhookPayload(message);
assert.equal(callbackResult, null);
assert.ok(directResult);
assert.equal(directResult.id, message.id);
assert.equal(directResult.contentValue, dataUri);
results.push({
  id: "C02_sobre_messages",
  confirmado: true,
  funcion: "normalizeApiChatWebhookPayload",
  observado: {
    sobre: "{ messages: [mensaje] }",
    mensajesEnSobre: 1,
    resultadoSobre: callbackResult,
    resultadoDirectoAceptado: directResult !== null,
    campoContenidoDirecto: directResult.contentField,
    bytesBinariosFicticios: syntheticBytes.length,
  },
});

// 3. El mismo normalizador sí admite message anidado; shape no lo recorre.
const nestedBody = { message };
assert.ok(normalizeApiChatWebhookPayload(nestedBody));
const nestedShape = describeTransportShape(nestedBody);
const nestedTrace: TransportTrace = {
  at: "2026-09-18T00:00:00.000Z",
  origin: "webhook",
  outcome: "registrado",
  providerType: "file",
  eventId: message.id,
  payloadBytes: transportPayloadBytes(nestedBody),
  shape: nestedShape,
  payload: redactTransportPayload(nestedBody),
};
const nestedSummary = summarizeTransportTrace([nestedTrace]);
const directSummary = summarizeTransportTrace([
  { ...nestedTrace, shape: describeTransportShape(message) },
]);
assert.equal(nestedSummary.state, "sin-adjuntos");
assert.equal(nestedSummary.withAttachment, 0);
assert.equal(directSummary.state, "con-adjuntos");
assert.equal(directSummary.withAttachment, 1);
assert.ok(nestedTrace.payloadBytes > syntheticBytes.length);
results.push({
  id: "C03_adjunto_anidado_invisible_para_resumen",
  confirmado: true,
  funciones: ["describeTransportShape", "summarizeTransportTrace"],
  observado: {
    shape: nestedShape,
    payloadBytes: nestedTrace.payloadBytes,
    bytesBinariosFicticios: syntheticBytes.length,
    resumenAnidado: nestedSummary,
    controlDirecto: { state: directSummary.state, withAttachment: directSummary.withAttachment },
  },
});

// 4. Cuarenta campos de texto alcanzan el truncamiento global aun después de
// la redacción. Se valida el JSON realmente enviado al pool por la función.
const broadBody = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => [`campo_${String(index).padStart(2, "0")}`, "x".repeat(2048)])
);
const completeRedactedJson = JSON.stringify(redactTransportPayload(broadBody));
assert.doesNotThrow(() => JSON.parse(completeRedactedJson));
assert.ok(completeRedactedJson.length > TRANSPORT_TRACE_LIMIT_BYTES);
let queryCalls = 0;
let truncatedJson = "";
let rejectedJson = false;
const fakePool = {
  async query(sql: string, values: unknown[]) {
    queryCalls += 1;
    assert.ok(sql.includes("$6::jsonb"));
    truncatedJson = String(values[5]);
    try {
      JSON.parse(truncatedJson);
    } catch (error) {
      rejectedJson = error instanceof SyntaxError;
      throw error; // Simula el rechazo del parámetro JSON inválido.
    }
    return { rows: [], rowCount: 1 };
  },
} as unknown as Parameters<typeof recordTransportTrace>[0];
const returned = await recordTransportTrace(fakePool, {
  origin: "webhook",
  outcome: "fixture",
  body: broadBody,
});
assert.equal(queryCalls, 1);
assert.equal(truncatedJson.length, TRANSPORT_TRACE_LIMIT_BYTES);
assert.equal(rejectedJson, true);
assert.equal(returned, undefined);
results.push({
  id: "C04_truncamiento_rompe_json",
  confirmado: true,
  funcion: "recordTransportTrace",
  observado: {
    camposFicticios: 40,
    caracteresJsonAntes: completeRedactedJson.length,
    caracteresJsonEnviados: truncatedJson.length,
    limiteDeclarado: TRANSPORT_TRACE_LIMIT_BYTES,
    parametroJsonbInvalido: rejectedJson,
    rechazoSimuladoAbsorbido: returned === undefined,
    llamadasPoolSimulado: queryCalls,
    baseDeDatosReal: false,
  },
});

// 5. El payload enmascara secret, pero shape conserva su valor corto alfanumérico;
// ambos conservan el texto ordinario. Los valores siguientes son marcadores.
const shortText = "TEXTO FICTICIO DE CARACTERIZACION";
const syntheticSecret = "SECRETO_SINTETICO_SIN_VALIDEZ";
const shortBody = { text: shortText, secret: syntheticSecret };
const shortShape = describeTransportShape(shortBody);
const redacted = redactTransportPayload(shortBody) as Record<string, unknown>;
assert.equal(shortShape.text.value, shortText);
assert.equal(shortShape.secret.value, syntheticSecret);
assert.equal(redacted.text, shortText);
assert.notEqual(redacted.secret, syntheticSecret);
results.push({
  id: "C05_contenido_corto_conservado",
  confirmado: true,
  funciones: ["describeTransportShape", "redactTransportPayload"],
  observado: {
    shapeConservaTexto: shortShape.text.value === shortText,
    shapeConservaSecretoSintetico: shortShape.secret.value === syntheticSecret,
    payloadConservaTexto: redacted.text === shortText,
    payloadEnmascaraSecretoSintetico: redacted.secret !== syntheticSecret,
    valoresRealesUtilizados: false,
  },
});

assert.equal(fetchCalls, 0);
process.stdout.write(`${JSON.stringify({
  tipo: "caracterizacion_de_defectos_existentes",
  interpretacion: "Exito confirma los cinco contraejemplos; no demuestra una correccion ni identifica por si solo la causa del incidente productivo.",
  alcance: "Funciones reales del checkout, entradas ficticias, sin red, sin servicios privados y sin base de datos real.",
  comando: "node --import tsx docs/audits/2026-09-18-apichat/contraejemplos.ts",
  llamadasFetch: fetchCalls,
  totalConfirmados: results.length,
  resultados: results,
}, null, 2)}\n`);
