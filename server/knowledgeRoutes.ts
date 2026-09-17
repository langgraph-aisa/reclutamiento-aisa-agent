import type { Express, Request, Response } from "express";
import fs from "node:fs";
import { getPool, getUserById } from "./db";
import {
  knowledgeFilePath,
  knowledgeFileStats,
  renderCsvPreview,
  renderDocxHtml,
  renderPlainTextPreview,
  renderSpreadsheetHtml,
} from "./knowledge";
import { readLocalSession } from "./localAuth";
import { VIEWER_SECURITY_HEADERS, verifyViewerToken } from "./viewerAccess";

type KnowledgeRow = {
  id: number;
  original_name: string;
  storage_key: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
};

/**
 * Autoriza la entrega de un archivo de conocimiento. La sesión de
 * administración es la vía primaria; el vale firmado permite que las peticiones
 * emitidas por el propio navegador (visor incrustado) no dependan de la cookie,
 * que los navegadores omiten en contextos incrustados o tras caducar la sesión.
 */
async function authorizeKnowledgeAccess(
  req: Request,
  res: Response,
  fileId: number
) {
  if (
    verifyViewerToken("knowledge", fileId, req.query.t as string | undefined)
  ) {
    return true;
  }
  const localUserId = await readLocalSession(req);
  const user = localUserId ? await getUserById(localUserId) : null;
  if (user?.active && user.role === "admin") return true;
  res.status(403).json({ error: "Acceso restringido a administración." });
  return false;
}

async function resolveKnowledgeFile(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identificador de archivo inválido." });
    return null;
  }
  if (!(await authorizeKnowledgeAccess(req, res, id))) return null;
  const pool = await getPool();
  if (!pool) {
    res.status(503).json({ error: "Base de datos no disponible." });
    return null;
  }
  const result = await pool.query<KnowledgeRow>(
    `SELECT id,original_name,storage_key,mime_type,extension,size_bytes
       FROM knowledge_files WHERE id=$1 LIMIT 1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "Archivo no encontrado." });
    return null;
  }
  return row;
}

/**
 * Entrega binaria con soporte de rangos. El tipo se declara de forma explícita
 * y se prohíbe la adivinación del navegador, de modo que el visor reciba el
 * `Content-Type` real del archivo reconstruido.
 */
function sendRange(
  res: Response,
  filePath: string,
  size: number,
  mimeType: string,
  rangeHeader?: string
) {
  const common = {
    ...VIEWER_SECURITY_HEADERS,
    "Content-Type": mimeType,
    "Cache-Control": "private, max-age=3600",
  };
  if (!rangeHeader) {
    res.writeHead(200, {
      ...common,
      "Content-Length": size,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    res.status(416).set("Content-Range", `bytes */${size}`).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size || end < 0) {
    res.status(416).set("Content-Range", `bytes */${size}`).end();
    return;
  }
  res.writeHead(206, {
    ...common,
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Accept-Ranges": "bytes",
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

/**
 * Vistas previas textuales. Cada extensión representable recibe su propia
 * conversión y todas comparten el mismo documento HTML con estilo, de modo que
 * el visor muestre contenido legible en lugar de bytes sin interpretación.
 */
async function renderKnowledgePreview(row: KnowledgeRow) {
  const name = row.original_name;
  switch (row.extension) {
    case "docx":
      return renderDocxHtml(row.storage_key, name);
    case "csv":
      return renderCsvPreview(row.storage_key, name);
    case "xlsx":
    case "xls":
      return renderSpreadsheetHtml(row.storage_key, name);
    case "txt":
      return renderPlainTextPreview(row.storage_key);
    default:
      return null;
  }
}

/**
 * El visor incrusta el archivo en `iframe`, `img`, `video` y `audio`: el
 * navegador pide esas direcciones con `Accept: text/html`. Cuando la entrega
 * falla, devolver JSON hace que el operador vea un objeto crudo dentro del
 * visor y no la causa. Esta función decide el formato de la respuesta de error
 * según quien la solicite, de modo que el visor reciba una explicación legible
 * y las integraciones sigan recibiendo JSON.
 */
function prefersHtml(req: Request) {
  return (req.headers.accept ?? "").includes("text/html");
}

function viewerErrorDocument(title: string, message: string, hint: string) {
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)}</title>
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
    background: #f6f8fa;
    color: #0b2d4b;
  }
  .card {
    max-width: 30rem;
    border: 1px solid #d7dee6;
    border-radius: 16px;
    background: #ffffff;
    padding: 24px 26px;
    box-shadow: 0 10px 30px rgba(11, 45, 75, 0.08);
  }
  h1 { margin: 0 0 10px; font-size: 15px; }
  p { margin: 0 0 10px; font-size: 13px; line-height: 1.65; }
  .hint { margin: 0; color: #40556b; font-size: 12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escape(title)}</h1>
    <p>${escape(message)}</p>
    <p class="hint">${escape(hint)}</p>
  </div>
</body>
</html>`;
}

type DeliveryFailure = {
  status: number;
  message: string;
  reason: string;
};

/**
 * Clasifica el fallo de entrega. Antes toda causa respondía con el mismo texto
 * genérico, de modo que un archivo ausente del volumen era indistinguible de un
 * error de permisos o de una referencia inválida.
 */
function classifyDeliveryFailure(error: unknown): DeliveryFailure {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (code === "ENOENT") {
    return {
      status: 410,
      reason: "volumen-sin-archivo",
      message:
        "El archivo no está en el volumen de almacenamiento. El registro existe en la base de datos, pero el documento binario no se encuentra en la ruta configurada.",
    };
  }
  if (code === "EACCES" || code === "EPERM") {
    return {
      status: 500,
      reason: "permiso-denegado",
      message:
        "El servicio no tiene permiso de lectura sobre el volumen de almacenamiento.",
    };
  }
  if (code === "EISDIR") {
    return {
      status: 500,
      reason: "ruta-es-directorio",
      message:
        "La ruta configurada apunta a un directorio y no al documento almacenado.",
    };
  }
  if (error instanceof Error && /no es válida/i.test(error.message)) {
    return {
      status: 500,
      reason: "referencia-invalida",
      message:
        "La referencia de almacenamiento del documento no es válida; vuelva a cargar el archivo.",
    };
  }
  return {
    status: 500,
    reason: "error-no-clasificado",
    message: "No fue posible entregar el archivo.",
  };
}

const DELIVERY_HINT =
  "Verifique que KNOWLEDGE_STORAGE_DIR apunte a un volumen persistente en EasyPanel. Si el volumen se recreó, los documentos deben volver a cargarse.";

function respondDeliveryFailure(
  req: Request,
  res: Response,
  failure: DeliveryFailure,
  context: { fileId?: number; storageKey?: string }
) {
  // La bitácora conserva la causa y la referencia interna (opaca, sin datos
  // personales) para que la operación pueda reconstruir el incidente.
  console.warn(
    `[Knowledge] entrega fallida motivo=${failure.reason} fileId=${context.fileId ?? "n/d"} clave=${context.storageKey ?? "n/d"}`
  );
  if (prefersHtml(req)) {
    res
      .status(failure.status)
      .type("html")
      .send(
        viewerErrorDocument(
          "No fue posible abrir el documento",
          failure.message,
          DELIVERY_HINT
        )
      );
    return;
  }
  res.status(failure.status).json({ error: failure.message });
}

export function registerKnowledgeRoutes(app: Express) {
  app.get("/api/knowledge/files/:id", async (req, res) => {
    let row: KnowledgeRow | null = null;
    try {
      row = await resolveKnowledgeFile(req, res);
      if (!row) return;
      const filePath = knowledgeFilePath(row.storage_key);
      const stats = await knowledgeFileStats(row.storage_key);
      res.set(
        "Content-Disposition",
        `inline; filename="${row.original_name.replace(/[^\w.\- ]/g, "_")}"`
      );
      sendRange(res, filePath, stats.size, row.mime_type, req.headers.range);
    } catch (error) {
      respondDeliveryFailure(req, res, classifyDeliveryFailure(error), {
        fileId: row?.id,
        storageKey: row?.storage_key,
      });
    }
  });

  app.get("/api/knowledge/render/:id", async (req, res) => {
    let row: KnowledgeRow | null = null;
    try {
      row = await resolveKnowledgeFile(req, res);
      if (!row) return;
      const html = await renderKnowledgePreview(row);
      if (!html) {
        const message =
          "Este tipo de archivo no dispone de vista previa integrada; descárguelo para revisarlo.";
        if (prefersHtml(req)) {
          res
            .status(415)
            .type("html")
            .send(
              viewerErrorDocument(
                "Sin vista previa para este formato",
                message,
                "Los formatos con vista previa son imagen, video, audio, PDF, Word, Excel, CSV y texto."
              )
            );
          return;
        }
        res.status(415).json({ error: message });
        return;
      }
      res
        .set({
          ...VIEWER_SECURITY_HEADERS,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, max-age=600",
        })
        .send(html);
    } catch (error) {
      respondDeliveryFailure(req, res, classifyDeliveryFailure(error), {
        fileId: row?.id,
        storageKey: row?.storage_key,
      });
    }
  });
}
