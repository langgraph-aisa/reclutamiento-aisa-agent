import type { Express, Request, Response } from "express";
import fs from "node:fs";
import { getPool, getUserById } from "./db";
import {
  knowledgeFilePath,
  knowledgeFileStats,
  renderCsvPreview,
  renderDocxHtml,
} from "./knowledge";
import { readLocalSession } from "./localAuth";

type KnowledgeRow = {
  id: number;
  original_name: string;
  storage_key: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
};

async function resolveKnowledgeFile(req: Request, res: Response) {
  const localUserId = await readLocalSession(req);
  const user = localUserId ? await getUserById(localUserId) : null;
  if (!user?.active || user.role !== "admin") {
    res.status(403).json({ error: "Acceso restringido a administración." });
    return null;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Identificador de archivo inválido." });
    return null;
  }
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

function sendRange(
  res: Response,
  filePath: string,
  size: number,
  mimeType: string,
  rangeHeader?: string
) {
  const common = {
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
      sendRange(
        res,
        filePath,
        stats.size,
        row.mime_type,
        req.headers.range
      );
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
      if (row.extension === "docx") {
        const html = await renderDocxHtml(row.storage_key);
        res.set("Content-Type", "text/html; charset=utf-8").send(html);
        return;
      }
      if (row.extension === "csv") {
        const preview = await renderCsvPreview(row.storage_key);
        res.set("Content-Type", "text/plain; charset=utf-8").send(preview);
        return;
      }
      res.status(415).json({
        error: "Este tipo de archivo no dispone de vista previa textual.",
      });
    } catch (error) {
      console.warn(
        `[Knowledge] Render failed (${error instanceof Error ? error.name : "unknown"}).`
      );
      res.status(500).json({ error: "No fue posible generar la vista previa." });
    }
  });
}
