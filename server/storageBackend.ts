import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Costura de almacenamiento del RAG.
 *
 * El catálogo vive en PostgreSQL y los binarios en un backend de
 * almacenamiento. Hoy el backend es el sistema de archivos local
 * (`KNOWLEDGE_STORAGE_DIR`); esta costura separa la semántica —escribir, leer,
 * borrar y medir— de la implementación, de modo que un backend alterno
 * (Google Drive) pueda sustituir al local sin tocar los métodos que consumen
 * el almacenamiento.
 *
 * La escritura es atómica: se escribe un archivo temporal y se renombra, de
 * modo que la ruta final solo publica archivos completos incluso durante un
 * reintento. La lectura, el borrado y la medida conservan la semántica del
 * sistema de archivos vigente: la ausencia se propaga como error para que el
 * llamador la declare con su propio código.
 */

export type StorageStat = {
  size: number;
  mtime: Date;
};

export interface StorageBackend {
  /** Escribe bytes en la ruta absoluta, creando los directorios intermedios. */
  write(filePath: string, data: Buffer): Promise<void>;
  /** Lee los bytes completos de una ruta. */
  read(filePath: string): Promise<Buffer>;
  /** Borra una ruta sin fallar cuando no existe. */
  remove(filePath: string): Promise<void>;
  /** Metadatos del archivo; la ausencia se propaga como error. */
  stat(filePath: string): Promise<StorageStat>;
}

export class LocalStorageBackend implements StorageBackend {
  async write(filePath: string, data: Buffer): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      await fs.promises.rename(temporary, filePath);
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async read(filePath: string): Promise<Buffer> {
    return fs.promises.readFile(filePath);
  }

  async remove(filePath: string): Promise<void> {
    await fs.promises.rm(filePath, { force: true });
  }

  async stat(filePath: string): Promise<StorageStat> {
    const info = await fs.promises.stat(filePath);
    return { size: info.size, mtime: info.mtime };
  }
}

let activeBackend: StorageBackend = new LocalStorageBackend();

/** Backend vigente del proceso; punto único de conmutación hacia otro backend. */
export function currentStorageBackend(): StorageBackend {
  return activeBackend;
}

/** Sustituye el backend vigente; reservado para pruebas y para fases posteriores. */
export function useStorageBackend(backend: StorageBackend): void {
  activeBackend = backend;
}
