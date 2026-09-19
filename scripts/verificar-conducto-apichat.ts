/**
 * Prueba de vida del conducto de adjuntos de ApiChat.
 *
 * Comprueba, contra la instancia real, que un PDF, un Word, una imagen y un
 * audio recorren el conducto completo: notificación, recibo durable, mensaje en
 * la bandeja, documento en el expediente del candidato y derivación.
 *
 * Uso:
 *   # 1) Autoprueba local: valida los archivos sintéticos con las funciones
 *   #    reales del proyecto. No usa red ni base de datos.
 *   node --import tsx scripts/verificar-conducto-apichat.ts --autoprueba
 *
 *   # 2) Prueba contra la instancia:
 *   APICHAT_PUBLIC_BASE_URL=https://<host> \
 *   APICHAT_WEBHOOK_SECRET=<secreto> \
 *   DATABASE_URL=postgres://... \
 *   node --import tsx scripts/verificar-conducto-apichat.ts --telefono 50255550001
 *
 * La prueba ESCRIBE mensajes reales para el teléfono indicado: envíe el número
 * de un candidato de prueba con conversación activa. No modifica ningún otro
 * registro y no pide reenvíos al candidato.
 *
 * La salida nunca imprime el secreto ni la cadena de conexión.
 */
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { Pool } from "pg";
import { syntheticPdf } from "../server/testSupport/mediaFixtures";
import {
  decodeTransport,
  detectContentSignature,
} from "../server/base64Transport";
import { extractDocumentText } from "../server/documentExtraction";

type Fixture = {
  clave: string;
  etiqueta: string;
  extension: string;
  mime: string;
  nombre: string;
  bytes: Buffer;
};

/** Imagen PNG real de un píxel; sirve como contenido de prueba verificable. */
function syntheticPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
}

/** Audio WAV real: cabecera RIFF/WAVE con un décimo de segundo en silencio. */
function syntheticWav() {
  const rate = 8_000;
  const samples = 800;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Documento Word mínimo pero legible: un ZIP sin comprimir con las tres partes
 * que Mammoth necesita. Se calcula la suma de verificación de cada entrada
 * porque un ZIP con CRC incorrecto es rechazado como corrupto.
 */
function syntheticDocx() {
  const partes: Array<{ nombre: string; contenido: string }> = [
    {
      nombre: "[Content_Types].xml",
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    },
    {
      nombre: "_rels/.rels",
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    },
    {
      nombre: "word/document.xml",
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        "<w:p><w:r><w:t>Curriculum vitae sintetico. Ingeniero de software con cinco anos de experiencia.</w:t></w:r></w:p>" +
        "<w:p><w:r><w:t>Prueba de conducto: documento Word de verificacion.</w:t></w:r></w:p>" +
        "</w:body></w:document>",
    },
  ];
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  for (const parte of partes) {
    const nombre = Buffer.from(parte.nombre, "utf8");
    const contenido = Buffer.from(parte.contenido, "utf8");
    const suma = crc32(contenido) >>> 0;
    const local = Buffer.alloc(30 + nombre.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(contenido.length, 18);
    local.writeUInt32LE(contenido.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    nombre.copy(local, 30);
    locales.push(local, contenido);
    const central = Buffer.alloc(46 + nombre.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(suma, 16);
    central.writeUInt32LE(contenido.length, 20);
    central.writeUInt32LE(contenido.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nombre.copy(central, 46);
    centrales.push(central);
    offset += local.length + contenido.length;
  }
  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(centrales);
  const cierre = Buffer.alloc(22);
  cierre.writeUInt32LE(0x06054b50, 0);
  cierre.writeUInt16LE(0, 4);
  cierre.writeUInt16LE(0, 6);
  cierre.writeUInt16LE(partes.length, 8);
  cierre.writeUInt16LE(partes.length, 10);
  cierre.writeUInt32LE(directorio.length, 12);
  cierre.writeUInt32LE(cuerpo.length, 16);
  cierre.writeUInt16LE(0, 20);
  return Buffer.concat([cuerpo, directorio, cierre]);
}

function fixtures(): Fixture[] {
  return [
    {
      clave: "pdf",
      etiqueta: "PDF (base64 sin sobre)",
      extension: "pdf",
      mime: "application/pdf",
      nombre: "prueba-conducto.pdf",
      bytes: syntheticPdf(),
    },
    {
      clave: "docx",
      etiqueta: "Word DOCX",
      extension: "docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      nombre: "prueba-conducto.docx",
      bytes: syntheticDocx(),
    },
    {
      clave: "png",
      etiqueta: "Imagen PNG",
      extension: "png",
      mime: "image/png",
      nombre: "prueba-conducto.png",
      bytes: syntheticPng(),
    },
    {
      clave: "wav",
      etiqueta: "Audio WAV",
      extension: "wav",
      mime: "audio/wav",
      nombre: "prueba-conducto.wav",
      bytes: syntheticWav(),
    },
  ];
}

async function autoprueba() {
  console.log("Autoprueba local: los archivos se validan con las funciones reales.\n");
  let fallos = 0;
  for (const item of fixtures()) {
    const firma = detectContentSignature(item.bytes);
    const decodificado = decodeTransport(
      { dataBase64: item.bytes.toString("base64"), fileName: item.nombre },
      { maxBytes: 30 * 1024 * 1024 }
    );
    let extraccion = "no aplica";
    if (["pdf", "docx", "doc"].includes(item.extension)) {
      try {
        const texto = await extractDocumentText(item.bytes, item.extension);
        extraccion = `${texto.method} · ${texto.text.length} caracteres`;
      } catch (error) {
        extraccion = `FALLA · ${error instanceof Error ? error.name : "error"}`;
        fallos += 1;
      }
    }
    const firmaOk = firma?.extension === item.extension;
    const extensionOk = decodificado.extension === item.extension;
    if (!firmaOk || !extensionOk) fallos += 1;
    console.log(`${firmaOk && extensionOk ? "✓" : "✗"} ${item.etiqueta.padEnd(24)}`);
    console.log(`    firma detectada: ${firma?.extension ?? "ninguna"} · extensión resuelta: ${decodificado.extension}`);
    console.log(`    peso: ${item.bytes.length} bytes · sha256: ${createHash("sha256").update(item.bytes).digest("hex").slice(0, 16)}…`);
    console.log(`    extracción: ${extraccion}`);
  }
  console.log(`\n${fallos === 0 ? "Autoprueba correcta: los cuatro archivos son válidos para el conducto." : `Autoprueba con ${fallos} fallo(s).`}`);
  return fallos === 0;
}

type Opciones = {
  telefono: string;
  base: string;
  secreto: string;
  espera: number;
};

async function pruebaContraInstancia(opciones: Opciones) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const destino = opciones.base.replace(/\/$/, "") + "/api/apichat/webhook";
  try {
    const conversacion = await pool.query(
      `SELECT conv.id AS conversation_id, conv.status
         FROM candidates c
         JOIN applications a ON a.candidate_id = c.id
         JOIN conversations conv ON conv.application_id = a.id
        WHERE regexp_replace(c.phone_international,'\\D','','g')=$1
          AND conv.provider='apichat' AND conv.status IN ('pendiente','activo')
        ORDER BY conv.updated_at DESC, conv.id DESC LIMIT 1`,
      [opciones.telefono.replace(/\D/g, "")]
    );
    if (!conversacion.rows[0]) {
      console.error(
        `No hay conversación activa para el teléfono indicado. La prueba no crea candidatos: use un teléfono de prueba con postulación existente.`
      );
      return false;
    }
    console.log(
      `Conversación ${conversacion.rows[0].conversation_id} · estado ${conversacion.rows[0].status}`
    );

    const marca = Date.now().toString().slice(-6);
    const enviados: Array<{ fixture: Fixture; id: string }> = [];
    for (const fixture of fixtures()) {
      const id = `vida-${fixture.clave}-${marca}`;
      const cuerpo = {
        messages: [
          {
            id,
            number: opciones.telefono.replace(/\D/g, ""),
            type: fixture.clave === "png" ? "image" : fixture.clave === "wav" ? "audio" : "file",
            filename: fixture.nombre,
            mime_type: fixture.mime,
            from_me: false,
            time: Math.floor(Date.now() / 1000),
            // Con la notificación en base64 el proveedor entrega el contenido
            // sin el sobre `data:`: es la forma exacta del tráfico real.
            url: fixture.bytes.toString("base64"),
          },
        ],
      };
      const respuesta = await fetch(`${destino}?key=${encodeURIComponent(opciones.secreto)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const texto = await respuesta.text();
      console.log(
        `${respuesta.ok ? "✓" : "✗"} ${fixture.etiqueta.padEnd(24)} HTTP ${respuesta.status} ${texto.slice(0, 120)}`
      );
      if (!respuesta.ok) {
        console.error(
          respuesta.status === 401 || respuesta.status === 503
            ? "  El webhook rechazó la credencial. Revise APICHAT_WEBHOOK_SECRET y el ?key= del panel."
            : ""
        );
        return false;
      }
      enviados.push({ fixture, id });
    }

    console.log(`\nEsperando el procesamiento (hasta ${opciones.espera} s)…`);
    const limite = Date.now() + opciones.espera * 1_000;
    let pendientes = enviados.map(item => item.id);
    while (Date.now() < limite) {
      const filas = await pool.query(
        `SELECT provider_message_id, status FROM apichat_inbound_receipts
          WHERE provider_message_id = ANY($1)`,
        [enviados.map(item => item.id)]
      );
      pendientes = enviados
        .map(item => item.id)
        .filter(id => {
          const fila = filas.rows.find(candidata => candidata.provider_message_id === id);
          return !fila || fila.status === "pending" || fila.status === "processing";
        });
      if (pendientes.length === 0) break;
      await new Promise(resolve => setTimeout(resolve, 3_000));
    }

    const recibos = await pool.query(
      `SELECT provider_message_id, status, outcome, attempts, last_error
         FROM apichat_inbound_receipts WHERE provider_message_id = ANY($1)`,
      [enviados.map(item => item.id)]
    );
    const mensajes = await pool.query(
      `SELECT provider_message_id, message_type,
              metadata->'media'->>'processingOutcome' AS ingreso,
              metadata->'media'->>'processingReason'  AS motivo,
              metadata->'media'->>'candidateFileId'   AS documento
         FROM conversation_messages WHERE provider_message_id = ANY($1)`,
      [enviados.map(item => item.id)]
    );
    const documentos = await pool.query(
      `SELECT id, original_name, extension, size_bytes, analysis_status,
              processing_error_code
         FROM candidate_knowledge_files
        WHERE id = ANY($1::int[])`,
      [mensajes.rows.map(fila => Number(fila.documento)).filter(Boolean)]
    );

    let correctos = 0;
    console.log("\nResultado por formato:");
    for (const { fixture, id } of enviados) {
      const recibo = recibos.rows.find(fila => fila.provider_message_id === id);
      const mensaje = mensajes.rows.find(fila => fila.provider_message_id === id);
      const documento = mensaje?.documento
        ? documentos.rows.find(fila => String(fila.id) === String(mensaje.documento))
        : null;
      const llego = Boolean(mensaje);
      if (llego) correctos += 1;
      console.log(
        `${llego ? "✓" : "✗"} ${fixture.etiqueta.padEnd(24)} ` +
          `recibo=${recibo?.status ?? "ausente"}${recibo?.last_error ? ` (${recibo.last_error})` : ""} · ` +
          `bandeja=${llego ? "sí" : "NO"} · ` +
          `expediente=${documento ? `sí (${documento.analysis_status}${documento.processing_error_code ? ` · ${documento.processing_error_code}` : ""})` : "no"}`
      );
      if (!llego) {
        console.log(
          `    motivo del ingreso: ${mensaje?.motivo ?? "sin fila de mensaje"}${pendientes.includes(id) ? " · seguía en cola al vencer la espera" : ""}`
        );
      }
    }
    console.log(
      `\n${correctos === enviados.length ? "Conducto verificado: los cuatro formatos llegaron a la bandeja." : `${correctos} de ${enviados.length} formatos llegaron a la bandeja.`}`
    );
    return correctos === enviados.length;
  } finally {
    await pool.end();
  }
}

function argumento(nombre: string) {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
}

const telefono = argumento("telefono");
let exito: boolean;
if (!telefono || process.argv.includes("--autoprueba")) {
  exito = await autoprueba();
} else {
  const base = argumento("base-url") ?? process.env.APICHAT_PUBLIC_BASE_URL ?? "";
  const secreto = process.env.APICHAT_WEBHOOK_SECRET ?? "";
  if (!base || !secreto || !process.env.DATABASE_URL) {
    console.error(
      "Faltan APICHAT_PUBLIC_BASE_URL, APICHAT_WEBHOOK_SECRET o DATABASE_URL. Use --autoprueba para la validación local."
    );
    process.exit(2);
  }
  exito = await pruebaContraInstancia({
    telefono,
    base,
    secreto,
    espera: Number(argumento("espera") ?? 90),
  });
}
process.exit(exito ? 0 : 1);
