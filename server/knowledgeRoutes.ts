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

export function registerKnowledgeRoutes(app: Express) {
  app.get("/api/knowledge/files/:id", async (req, res) => {
    try {
      const row = await resolveKnowledgeFile(req, res);
      if (!row) return;
      const filePath = knowledgeFilePath(row.storage_key);
      const stats = await knowledgeFileStats(row.storage_key);
      res.set(
        "Content-Disposition",
        `inline; filename="${row.original_name.replace(/[^\w.\- ]/g, "_")}"`
      );
      sendRange(res, filePath, stats.size, row.mime_type, req.headers.range);
    } catch (error) {
      console.warn(
        `[Knowledge] File delivery failed (${error instanceof Error ? error.name : "unknown"}).`
      );
      res.status(500).json({ error: "No fue posible entregar el archivo." });
    }
  });

  app.get("/api/knowledge/render/:id", async (req, res) => {
    try {
      const row = await resolveKnowledgeFile(req, res);
      if (!row) return;
      const html = await renderKnowledgePreview(row);
      if (!html) {
        res.status(415).json({
          error: "Este tipo de archivo no dispone de vista previa textual.",
        });
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
      console.warn(
        `[Knowledge] Render failed (${error instanceof Error ? error.name : "unknown"}).`
      );
      res.status(500).json({ error: "No fue posible generar la vista previa." });
    }
  });
}
