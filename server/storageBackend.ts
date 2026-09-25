import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Costura de almacenamiento del RAG.
 *
 * El catálogo vive en PostgreSQL y los binarios en un backend de
 * almacenamiento identificados por una **clave relativa** —la misma referencia
 * que conserva la base—, no por una ruta absoluta. El backend resuelve la
 * clave contra su propio medio: el sistema de archivos local o el Dropbox del
 * propietario del proyecto.
 *
 * Formas de clave admitidas:
 *   · `<proyecto>/<uuid>.<extensión>`            — RAG de proyectos
 *   · `applications/<postulación>/<uuid>.<ext>`   — RAG del candidato
 *   · `inbox-files/<in|out>-<id>/<uuid>`          — bandeja conversacional
 *
 * La escritura es atómica en el backend local: se escribe un archivo temporal y
 * se renombra, de modo que la ruta final solo publica archivos completos
 * incluso durante un reintento. La ausencia se propaga como error para que el
 * llamador la declare con su propio código.
 */

export type StorageStat = {
  size: number;
  mtime: Date;
};

export interface StorageBackend {
  /** Escribe bytes bajo una clave, creando los niveles intermedios. */
  write(key: string, data: Buffer): Promise<void>;
  /** Lee los bytes completos de una clave. */
  read(key: string): Promise<Buffer>;
  /** Lee un rango cerrado `[start, end]`; los backend que no lo soportan lo omiten. */
  readRange?(key: string, start: number, end: number): Promise<Buffer>;
  /** Borra una clave sin fallar cuando no existe. */
  remove(key: string): Promise<void>;
  /** Metadatos de una clave; la ausencia se propaga como error. */
  stat(key: string): Promise<StorageStat>;
}

/** Directorio local resuelto en este proceso (compartido con el RAG y la bandeja). */
export function defaultStorageDirectory() {
  return path.resolve(
    process.env.KNOWLEDGE_STORAGE_DIR ??
      path.join(process.cwd(), "data", "knowledge-files")
  );
}

const KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

function keySegments(key: string): string[] {
  if (!key || key.includes("..")) {
    throw new Error("La referencia de almacenamiento no es válida.");
  }
  const segments = key.split("/");
  if (segments.some(segment => !segment || !KEY_SEGMENT.test(segment))) {
    throw new Error("La referencia de almacenamiento no es válida.");
  }
  return segments;
}

export class LocalStorageBackend implements StorageBackend {
  constructor(
    private readonly directory: () => string = defaultStorageDirectory
  ) {}

  private resolve(key: string): string {
    return path.join(this.directory(), ...keySegments(key));
  }

  async write(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      await fs.promises.rename(temporary, target);
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async read(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await fs.promises.rm(this.resolve(key), { force: true });
  }

  async stat(key: string): Promise<StorageStat> {
    const info = await fs.promises.stat(this.resolve(key));
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
