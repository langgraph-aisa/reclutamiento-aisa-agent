import type { Express, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getPool, getUserById } from "./db";
import { readLocalSession } from "./localAuth";
import { verifyViewerToken, VIEWER_SECURITY_HEADERS } from "./viewerAccess";
import { currentStorageBackend, type StorageStat } from "./storageBackend";

/**
 * Almacenamiento de archivos de la bandeja conversacional.
 *
 * Los adjuntos de WhatsApp (entrantes y salientes) se guardan en el mismo
 * volumen persistente del RAG del proyecto (`KNOWLEDGE_STORAGE_DIR`), de modo
 * que el candidato disponga de visor y navegación equivalentes a los del
 * módulo de conocimiento. Sin el volumen, los archivos se pierden entre
 * despliegues: el mensaje de error distingue ese caso.
 */

export function inboxFilesDirectory() {
  return path.resolve(
    process.env.KNOWLEDGE_STORAGE_DIR ??
      path.join(process.cwd(), "data", "knowledge-files"),
    "inbox-files"
  );
}

const INBOX_FILE_KEY_PATTERN = /^[a-z0-9-]+\/[a-f0-9-]{12,64}$/;

export function buildInboxFileKey(kind: "in" | "out", messageId: number | string) {
  return `${kind}-${String(messageId)}/${randomUUID()}`;
}

export function inboxFilePath(key: string) {
  if (!INBOX_FILE_KEY_PATTERN.test(key)) {
    throw new Error("La referencia de almacenamiento no es válida.");
  }
  const target = path.join(inboxFilesDirectory(), ...key.split("/"));
  if (!target.startsWith(inboxFilesDirectory())) {
    throw new Error("La referencia de almacenamiento no es válida.");
  }
  return target;
}

export async function writeInboxFile(key: string, data: Buffer) {
  const target = inboxFilePath(key);
  await currentStorageBackend().write(target, data);
  return target;
}

/**
 * Lectura del binario conservado.
 *
 * La bandeja es también una fuente de recuperación: un adjunto que llegó y no
 * se incorporó al expediente por política administrativa conserva aquí sus
 * bytes, de modo que la incorporación puede reintentarse sin exigir al
 * candidato un envío nuevo. La ausencia del archivo se propaga como error de
 * sistema de archivos, que el llamador declara con su propio código.
 */
export async function readInboxFile(key: string) {
  return currentStorageBackend().read(inboxFilePath(key));
}

export async function removeInboxFile(key: string) {
  await currentStorageBackend().remove(inboxFilePath(key));
}

export function inboxFileStats(key: string): Promise<StorageStat> {
  return currentStorageBackend().stat(inboxFilePath(key));
}

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
  if (!match || (!match[1] && !match[2]) || size === 0) {
    res.status(416).set("Content-Range", `bytes */${size}`).end();
    return;
  }
  const suffix = !match[1];
  const first = Number(match[1] || match[2]);
  const last = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || (suffix && first <= 0)) {
    res.status(416).set("Content-Range", `bytes */${size}`).end();
    return;
  }
  const start = suffix ? Math.max(0, size - first) : first;
  const end = suffix ? size - 1 : Math.min(last, size - 1);
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

async function resolveInboxAttachment(req: Request, res: Response) {
  const key = String(req.params.key ?? "");
  // La entrega al proveedor **no puede traer sesión**: ApiChat descarga la
  // dirección desde sus servidores, y la ruta administrativa le devolvía 403.
  // El acceso viaja como capacidad firmada, acotada a este archivo y con
  // caducidad corta: la sesión sigue siendo la vía primaria y el vale no eleva
  // privilegios, autoriza la lectura de un recurso concreto mientras siga
  // vigente.
  const capability = verifyViewerToken("inbox", key, req.query.t);
  if (!capability) {
    const localUserId = await readLocalSession(req);
    const user = localUserId ? await getUserById(localUserId) : null;
    // Misma política de rol que recruiterProcedure, usada por inbox.detail.
    if (!user?.active || !["admin", "reclutador"].includes(user.role)) {
      res.status(403).json({ error: "Se requiere rol de reclutador o administrador." });
      return null;
    }
  }
  const pool = await getPool();
  if (!pool) {
    res.status(503).json({ error: "Base de datos no disponible." });
    return null;
  }
  const result = await pool.query(
    `SELECT m.id,
            COALESCE(m.original_file_name,metadata->'media'->>'fileName','Adjunto') AS original_name,
            COALESCE(m.mime_type,metadata->'media'->>'mimeType') AS mime_type,
            COALESCE(m.storage_key,metadata->'media'->>'storageKey') AS storage_key
       FROM conversation_messages m
      WHERE COALESCE(m.storage_key,metadata->'media'->>'storageKey')=$1 LIMIT 1`,
    [key]
  );
  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "Archivo no encontrado." });
    return null;
  }
  return row as {
    id: number;
    original_name: string;
    mime_type: string | null;
    storage_key: string;
  };
}

export function registerInboxFileRoutes(app: Express) {
  app.get("/api/inbox/files/:key", async (req: Request, res: Response) => {
    try {
      const row = await resolveInboxAttachment(req, res);
      if (!row) return;
      const stats = await inboxFileStats(row.storage_key);
      res.set(
        "Content-Disposition",
        `inline; filename="${row.original_name.replace(/[^\w.\- ]/g, "_")}"`
      );
      sendRange(
        res,
        inboxFilePath(row.storage_key),
        stats.size,
        row.mime_type || "application/octet-stream",
        req.headers.range
      );
    } catch (error) {
      const missing =
        error instanceof Error && "code" in error && error.code === "ENOENT";
      console.warn(
        `[InboxFiles] Entrega fallida (${error instanceof Error ? error.name : "unknown"}).`
      );
      res.status(missing ? 410 : 500).json({
        error: missing
          ? "El archivo no está en el volumen de almacenamiento; verifique la persistencia del volumen en EasyPanel."
          : "No fue posible entregar el archivo.",
      });
    }
  });
}
