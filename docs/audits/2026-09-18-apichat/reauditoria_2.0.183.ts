/**
 * Reauditoría del conducto de adjuntos sobre JARVI RH 2.0.183.
 *
 * Sustituye a `contraejemplos.ts`, que caracterizaba la versión 2.0.179 y hoy
 * falla porque los defectos que describía (rechazo del sobre `messages[]`) ya
 * no existen. **El fallo de aquel archivo es la evidencia del delta.**
 *
 * Ejecutar desde la raíz del repositorio:
 *   node --import tsx docs/audits/2026-09-18-apichat/reauditoria_2.0.183.ts
 *
 * Todos los datos son ficticios. No se abre un puerto, no se contacta ninguna
 * red, no se descarga contenido y no se accede a base de datos alguna.
 *
 * Cada caso declara su nivel de evidencia:
 *   R (reproducción) — la función real recibe una entrada determinista;
 *   C (código)       — el resultado se deduce leyendo la instrucción auditada.
 */
import assert from "node:assert/strict";
import {
  normalizeApiChatMessage,
  normalizeApiChatBatch,
  ATTACHMENT_MESSAGE_TYPES,
} from "../../../server/apiChatContract.ts";
import { summarizeAttachmentPipeline } from "../../../server/attachmentPipeline.ts";
import {
  AttachmentTransportError,
  decodeRemoteAttachment,
  decodeTransport,
  detectContentSignature,
} from "../../../server/base64Transport.ts";
import { describeTransportShape } from "../../../server/transportTrace.ts";

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("Esta caracterización prohíbe solicitudes de red.");
};

const cases: Record<string, unknown>[] = [];
const pdfBytes = Buffer.from(
  "%PDF-1.4\n% fixture de auditoria sin datos personales\n%%EOF\n"
);

// ---------------------------------------------------------------- A. Adaptador
// A1. El contrato oficial recuperado declara el medio en `url`. Una URL que no
// sea HTTPS no se reconoce como contenido transportable.
const conHttps = normalizeApiChatMessage({
  id: "audit-a1",
  number: "000000000000",
  type: "document",
  filename: "cv.pdf",
  mime_type: "application/pdf",
  url: "https://media.invalid/fixture.pdf",
});
const conHttp = normalizeApiChatMessage({
  id: "audit-a2",
  number: "000000000000",
  type: "document",
  filename: "cv.pdf",
  mime_type: "application/pdf",
  url: "http://media.invalid/fixture.pdf",
});
assert.equal(conHttps?.contentField, "url");
assert.equal(conHttps?.contentValue, "https://media.invalid/fixture.pdf");
assert.ok(conHttp);
assert.equal(conHttp.contentField, undefined);
assert.equal(conHttp.contentValue, undefined);
cases.push({
  id: "A1_url_http_no_reconocida",
  nivel: "R",
  funcion: "normalizeApiChatMessage",
  observado: {
    https: { campo: conHttps?.contentField ?? null, resuelto: Boolean(conHttps?.contentValue) },
    http: { campo: conHttp.contentField ?? null, resuelto: Boolean(conHttp.contentValue), urlCopiado: conHttp.url },
  },
  consecuencia:
    "El campo `url` se copia SIN validar el esquema, pero `contentValue` no se resuelve. Como el receptor usa `source = contentValue ?? url`, el origen no vacío llega al transporte, que devuelve null sin intentar conexión: el receptor lanza AttachmentContentUnavailable y el recibo agota 8 intentos hasta «dead». El mensaje NO se asienta y la bandeja queda vacía. Reproducido en `reproduccion_pdf_bandeja.ts`, casos B1, B2 y C.",
});

// A2. Un nombre de campo no enumerado en `contentFields` tampoco se resuelve,
// aunque su valor sea una URL HTTPS válida.
const campoNoEnumerado = normalizeApiChatMessage({
  id: "audit-a3",
  number: "000000000000",
  type: "document",
  filename: "cv.pdf",
  document: "https://media.invalid/fixture.pdf",
});
assert.ok(campoNoEnumerado);
assert.equal(campoNoEnumerado.contentValue, undefined);
cases.push({
  id: "A2_campo_no_enumerado",
  nivel: "R",
  funcion: "normalizeApiChatMessage",
  observado: { camposPresentes: campoNoEnumerado.contentFieldsPresent, resuelto: false },
  consecuencia:
    "La lista de alias es finita y local. Aquí NO hay `url` ni contenido resoluble, de modo que `source` es vacío: es el único caso en que el receptor asienta el mensaje, con processingOutcome 'rejected' y motivo contenido_no_disponible, y sin documento. Reproducido en `reproduccion_pdf_bandeja.ts`, caso E.",
});

// A3. El umbral de base64 (64 caracteres) puede descartar un contenido real.
const base64Corta = "A".repeat(48);
const corta = normalizeApiChatMessage({
  id: "audit-a4",
  number: "000000000000",
  type: "audio",
  url: base64Corta,
});
assert.ok(corta);
assert.equal(corta.contentValue, undefined);
cases.push({
  id: "A3_base64_bajo_umbral",
  nivel: "R",
  funcion: "normalizeApiChatMessage",
  observado: { longitud: base64Corta.length, resuelto: false, umbral: 64 },
  consecuencia:
    "El umbral heurístico de 64 caracteres decide si el contenido se reconoce. Un base64 real por debajo del umbral, entregado en `url`, sigue llegando al transporte como origen no vacío: no es rechazo asentado, es pérdida con recibo agotado (misma clase que A1).",
});

// A4. El lote completo se rechaza si supera cien elementos: la anulación es
// total, no por elemento.
const loteCien = Array.from({ length: 101 }, (_, index) => ({
  id: `audit-bulk-${index}`,
  number: "000000000000",
  type: "text",
  text: "fixture",
}));
let loteGigante = "no lanzó";
try {
  normalizeApiChatBatch(loteCien);
} catch (error) {
  loteGigante = error instanceof Error ? error.message : "error no tipado";
}
assert.match(loteGigante, /cien mensajes/);
cases.push({
  id: "A4_lote_mayor_a_cien",
  nivel: "R",
  funcion: "normalizeApiChatBatch",
  observado: { entradas: loteCien.length, resultado: loteGigante },
  consecuencia:
    "La excepción ocurre antes de la transacción de la cola: el lote entero responde 503 y ninguno de sus elementos se conserva. Un lote del proveedor mayor de cien no se degrada parcialmente.",
});

// A5. Una posición inválida no elimina a las válidas del mismo lote.
const loteMixto = normalizeApiChatBatch({
  messages: [
    { id: "audit-c1", number: "000000000000", type: "text", text: "uno" },
    { sin: "forma" },
    { id: "audit-c2", number: "000000000000", type: "image", url: "data:image/png;base64," + "iVBORw0KGgo=" },
  ],
});
assert.equal(loteMixto.length, 3);
assert.ok(loteMixto[0]);
assert.equal(loteMixto[1], null);
assert.ok(loteMixto[2]);
cases.push({
  id: "A5_lote_mixto_conserva_posiciones",
  nivel: "R",
  funcion: "normalizeApiChatBatch",
  observado: { largo: loteMixto.length, invalidas: 1, validas: 2 },
  consecuencia: "Cada elemento recibe su propio desenlace; el comportamiento es el exigido por H01.",
});

// A6. El conjunto de tipos admite imagen, documento y audio por igual: la
// asimetría observada no proviene de esta puerta.
cases.push({
  id: "A6_tipos_admitidos",
  nivel: "R",
  funcion: "ATTACHMENT_MESSAGE_TYPES",
  observado: { tipos: [...ATTACHMENT_MESSAGE_TYPES] },
  consecuencia:
    "Imagen, documento y audio entran por la misma rama: la asimetría del incidente no se explica en esta puerta.",
});

// ------------------------------------------------------------------ B. Bytes
// B1. El PDF se reconoce por firma y se decodifica sin política de extensiones.
const decodificado = decodeTransport({
  dataBase64: `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
  fileName: "cv.pdf",
  mimeType: "application/pdf",
});
assert.equal(decodificado.extension, "pdf");
assert.equal(decodificado.detectedMimeType, "application/pdf");
cases.push({
  id: "B1_pdf_reconocido_por_firma",
  nivel: "R",
  funcion: "decodeTransport",
  observado: { extension: decodificado.extension, sha256: decodificado.sha256.slice(0, 16) },
  consecuencia: "El transporte canónico no es el eslabón que pierde un PDF.",
});

// B2. La política de extensiones del expediente puede rechazarlo después de
// haberlo recibido.
let politica = "no lanzó";
try {
  decodeTransport(
    { dataBase64: pdfBytes.toString("base64"), fileName: "cv.pdf" },
    { allowedExtensions: ["jpg", "png"] }
  );
} catch (error) {
  politica = error instanceof Error ? error.message : "error no tipado";
}
assert.match(politica, /Extensión no permitida/);
cases.push({
  id: "B2_politica_de_extensiones",
  nivel: "R",
  funcion: "decodeTransport",
  observado: { resultado: politica },
  consecuencia:
    "El rechazo por política es correcto, pero ocurre después de la recepción: el hecho «llegó y fue rechazado» es distinto de «no llegó» y debe conservarse con su motivo.",
});

// B3. Una fuente que no es `data:`, ni HTTPS, ni base64 válida no se transporta.
const httpNoTransportable = await decodeRemoteAttachment("http://media.invalid/cv.pdf");
assert.equal(httpNoTransportable, null);
assert.equal(fetchCalls, 0);
cases.push({
  id: "B3_fuente_no_transportable",
  nivel: "R",
  funcion: "decodeRemoteAttachment",
  observado: { resultado: null, solicitudesDeRed: fetchCalls },
  consecuencia:
    "El módulo de transporte declara explícitamente que no puede mover ese origen; el adaptador, en cambio, ya lo había descartado antes de llegar aquí.",
});

// B4. La firma de contenido sólo se comprueba en la posición cero.
const pdfConPrefijo = detectContentSignature(
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), pdfBytes])
);
assert.equal(pdfConPrefijo, null);
cases.push({
  id: "B4_firma_fuera_de_cero",
  nivel: "R",
  funcion: "detectContentSignature",
  observado: { firmaConBom: pdfConPrefijo },
  consecuencia:
    "Con un prefijo previo la firma no se detecta; la extensión declarada sostiene el archivo, de modo que el efecto es una degradación silenciosa del tipo, no una pérdida.",
});

// ----------------------------------------------------- C. Clasificación de error
// C1. El código de error del transporte y su condición de reintento no llegan a
// la cola: la cola guarda `error.name`.
const errorDeTransporte = new AttachmentTransportError("http_error", false, "HTTP 403.");
const errorDeContenido = new Error("AttachmentContentUnavailable");
assert.equal(errorDeTransporte.name, "AttachmentTransportError");
assert.equal(errorDeContenido.name, "Error");
cases.push({
  id: "C1_codigo_de_error_no_sobrevive",
  nivel: "C",
  funcion: "apiChatReceipts.ts · runApiChatReceiptSweep",
  observado: {
    asiento: "last_error = error.name",
    transportError: errorDeTransporte.name,
    codigoPerdido: (errorDeTransporte as { code?: string }).code,
    reintentablePerdido: (errorDeTransporte as { retryable?: boolean }).retryable,
    contenidoNoDisponible: errorDeContenido.name,
  },
  consecuencia:
    "El diagnóstico conserva «AttachmentTransportError» o «Error», nunca http_error, size_limit ni unsafe_destination. La condición `retryable` que el módulo calcula no se consume: se reintentan ocho veces por igual los fallos permanentes y los transitorios.",
});

// ------------------------------------------------------- D. Diagnóstico del conducto
// D1. Un recibo agotado se declara como recepción no confirmada.
const conMuertos = summarizeAttachmentPipeline({
  receiptsReceived: 3,
  receiptsDead: 1,
  documentsReceived: 2,
});
assert.equal(conMuertos.state, "recepcion_no_confirmada");
cases.push({
  id: "D1_recibo_agotado_visible",
  nivel: "R",
  funcion: "summarizeAttachmentPipeline",
  observado: { estado: conMuertos.state, veredicto: conMuertos.verdict.slice(0, 96) },
  consecuencia: "La pérdida por cola agotada deja de ser muda: este es el mejoramiento de 2.0.179 que sí quedó demostrado.",
});

// D2. Una lectura fallida se declara como incógnita, no como cero.
const sinLectura = summarizeAttachmentPipeline({ available: false });
assert.equal(sinLectura.state, "observabilidad_no_disponible");
cases.push({
  id: "D2_incognita_no_es_cero",
  nivel: "R",
  funcion: "summarizeAttachmentPipeline",
  observado: { estado: sinLectura.state },
  consecuencia: "La incógnita no se degrada a ausencia.",
});

// D3. HALLAZGO VIVO: un adjunto rechazado por política —o por contenido no
// disponible, cuando el asiento de recepción se cierra como registrado— no
// aparece en ningún contador del diagnóstico, y el conducto se declara cerrado.
const rechazadoPorPolitica = summarizeAttachmentPipeline({
  receiptsReceived: 1,
  receiptsCompleted: 1,
  receiptsRejected: 0,
  documentsReceived: 0,
});
assert.equal(rechazadoPorPolitica.state, "sin_pendientes");
assert.match(rechazadoPorPolitica.verdict, /constan completadas/);
cases.push({
  id: "D3_falso_verde_por_rechazo_de_politica",
  nivel: "R+C",
  funcion: "summarizeAttachmentPipeline",
  observado: {
    contadores: {
      receiptsReceived: 1,
      receiptsCompleted: 1,
      receiptsRejected: 0,
      documentsReceived: 0,
    },
    estado: rechazadoPorPolitica.state,
    veredicto: rechazadoPorPolitica.verdict,
  },
  fundamento: [
    "apiChatWebhook.ts: el recibo se cierra como `registered` porque el MENSAJE se escribió, aunque registerCandidateInboundDocument haya devuelto outcome 'rejected'.",
    "apiChatReceipts.ts: `terminal = registered || duplicado || saliente-ya-registrado` → status 'completed'.",
    "attachmentPipeline.ts: los contadores leen receipts y candidate_knowledge_files; el rechazo de política no crea documento y no se cuenta como recibo rechazado.",
  ],
  consecuencia:
    "El diagnóstico puede declarar «sin pendientes» mientras el PDF del candidato fue rechazado por política y no entró al expediente. Es un falso verde: la clase de error opuesta a la que el módulo fue escrito para eliminar. Los motivos extension_not_allowed y size_limit sólo son visibles en el manifiesto de la bandeja, nunca en el informe del conducto.",
});

// D4. La traza sí conserva el dato necesario para resolver el incidente: la
// ruta del campo y la huella del contenido.
const traza = describeTransportShape({
  messages: [
    {
      id: "audit-t1",
      number: "000000000000",
      type: "document",
      filename: "cv.pdf",
      url: "https://media.invalid/fixture.pdf",
    },
  ],
});
const rutas = Object.keys(traza);
assert.ok(rutas.some(path => path.endsWith(".url")));
assert.ok(rutas.some(path => path.endsWith(".type")));
cases.push({
  id: "D4_traza_permite_resolver_la_forma",
  nivel: "R",
  funcion: "describeTransportShape",
  observado: { rutas: rutas.filter(path => /url|type|filename/.test(path)) },
  consecuencia:
    "Si la traza del incidente existe, la forma del cuerpo y la huella del contenido están registradas: se puede resolver por consulta si ApiChat entregó la URL, en qué campo y con qué peso, sin depender del testimonio de las capturas.",
});

console.log(JSON.stringify({ version: "2.0.183", casos: cases }, null, 2));
console.log(`\nCaracterizaciones ejecutadas: ${cases.length}. Solicitudes de red: ${fetchCalls}.`);
