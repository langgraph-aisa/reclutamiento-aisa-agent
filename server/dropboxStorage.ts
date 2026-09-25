import type { StorageBackend, StorageStat } from "./storageBackend";

/**
 * Backend de Dropbox para la costura de almacenamiento.
 *
 * Cada clave relativa del RAG se resuelve contra una **ruta** dentro de la
 * carpeta de la aplicación —`Dropbox/Aplicaciones/<Aplicación>` cuando la
 * credencial declara acceso «App folder»—. El llamador inyecta el resolutor de
 * rutas —`pathResolver`—, que traduce la clave lógica a la jerarquía visible
 * `Proyecto/Plaza/Candidato`; sin él, la clave se sanea segmento a segmento.
 *
 * El acceso se realiza con un token de acceso renovado por el llamador
 * (`tokenSource`); el backend no conserva credenciales. Toda la entrada y salida
 * de red se inyecta para que las pruebas no salgan a internet.
 */

export const DROPBOX_API_BASE = "https://api.dropboxapi.com/2";
export const DROPBOX_CONTENT_BASE = "https://content.dropboxapi.com/2";
export const DROPBOX_ROOT_FOLDER = "JARVI RH";

/** Un segmento de ruta de Dropbox no puede contener la barra ni caracteres de control. */
const MAX_SEGMENT_LENGTH = 120;

type FetchImpl = typeof fetch;

export type DropboxTokenSource = () => Promise<string>;

/** Traduce una clave lógica a la ruta relativa visible en la carpeta de la aplicación. */
export type DropboxPathResolver = (
  key: string
) => string | Promise<string>;

/**
 * Sanea un segmento de nombre para que sea una carpeta válida y legible.
 * Conserva acentos y espacios —la navegación del usuario es el criterio— y
 * retira la barra, los caracteres de control y los puntos suspensivos que
 * Dropbox interpreta como rutas especiales.
 */
export function sanitizeDropboxSegment(raw: string): string {
  const cleaned = raw
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim();
  const trimmed = cleaned.slice(0, MAX_SEGMENT_LENGTH).trim();
  return trimmed || "Sin nombre";
}

function normalizeSegment(segment: string): string {
  if (!segment || segment.includes("..")) {
    throw new Error("La referencia de almacenamiento no es válida.");
  }
  return sanitizeDropboxSegment(segment);
}

type DropboxMetadata = {
  ".tag"?: string;
  id?: string;
  name?: string;
  size?: number;
  server_modified?: string;
  client_modified?: string;
};

type DropboxErrorBody = {
  error_summary?: string;
  error?: unknown;
};

function missingFileError() {
  return Object.assign(
    new Error("El archivo no existe en el almacenamiento."),
    { code: "ENOENT" }
  );
}

/**
 * Error de la API de Dropbox con causa nombrada. Sin un código propio, un fallo
 * de autenticación, de cuota o de red se presentaría al operador con la misma
 * frase genérica; el código permite que el llamador lo declare con su motivo.
 */
function dropboxApiError(operation: string, status: number, summary = ""): Error {
  if (status === 409 && /not_found/i.test(summary)) return missingFileError();
  const code =
    status === 401
      ? "dropbox_unauthenticated"
      : status === 403
        ? "dropbox_forbidden"
        : status === 429
          ? "dropbox_rate_limited"
          : "dropbox_unavailable";
  return Object.assign(
    new Error(`Dropbox rechazó ${operation} con estado HTTP ${status}.`),
    { code }
  );
}

export class DropboxStorageBackend implements StorageBackend {
  /** Carpetas ya confirmadas en esta instancia para no repetir la creación. */
  private readonly knownFolders = new Set<string>();

  constructor(
    private readonly tokenSource: DropboxTokenSource,
    private readonly options: {
      fetchImpl?: FetchImpl;
      rootFolderName?: string;
      pathResolver?: DropboxPathResolver;
    } = {}
  ) {}

  private fetchImpl(): FetchImpl {
    return this.options.fetchImpl ?? fetch;
  }

  private rootName(): string {
    return this.options.rootFolderName ?? DROPBOX_ROOT_FOLDER;
  }

  private async relativePath(key: string): Promise<string> {
    const resolved = this.options.pathResolver
      ? await this.options.pathResolver(key)
      : key;
    const raw = String(resolved ?? "").trim();
    if (!raw || raw.includes("..")) {
      throw new Error("La referencia de almacenamiento no es válida.");
    }
    const segments = raw
      .split("/")
      .filter(segment => segment.length > 0)
      .map(normalizeSegment);
    if (!segments.length) {
      throw new Error("La referencia de almacenamiento no es válida.");
    }
    return segments.join("/");
  }

  private fullPath(...segments: string[]): string {
    return `/${[this.rootName(), ...segments].join("/")}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.tokenSource()}` };
  }

  private static async readError(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as DropboxErrorBody;
      return String(body.error_summary ?? "");
    } catch {
      return "";
    }
  }

  private async call(
    endpoint: string,
    payload: unknown,
    operation: string
  ): Promise<unknown> {
    const response = await this.fetchImpl()(`${DROPBOX_API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        ...(await this.authHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
    });
    if (!response.ok) {
      throw dropboxApiError(
        operation,
        response.status,
        await DropboxStorageBackend.readError(response)
      );
    }
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  private async metadata(absolutePath: string): Promise<DropboxMetadata | null> {
    const response = await this.fetchImpl()(
      `${DROPBOX_API_BASE}/files/get_metadata`,
      {
        method: "POST",
        headers: {
          ...(await this.authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: absolutePath }),
      }
    );
    if (response.status === 409) return null;
    if (!response.ok) {
      throw dropboxApiError(
        "la consulta de metadatos",
        response.status,
        await DropboxStorageBackend.readError(response)
      );
    }
    return (await response.json()) as DropboxMetadata;
  }

  private async ensureFolder(absolutePath: string): Promise<void> {
    if (this.knownFolders.has(absolutePath)) return;
    const response = await this.fetchImpl()(
      `${DROPBOX_API_BASE}/files/create_folder_v2`,
      {
        method: "POST",
        headers: {
          ...(await this.authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: absolutePath, autorename: false }),
      }
    );
    if (response.ok) {
      this.knownFolders.add(absolutePath);
      return;
    }
    const summary = await DropboxStorageBackend.readError(response);
    // La carpeta ya existe —conflicto esperado en un reintento—: es un acierto.
    if (response.status === 409 && /conflict/i.test(summary)) {
      this.knownFolders.add(absolutePath);
      return;
    }
    throw dropboxApiError("la creación de la carpeta", response.status, summary);
  }

  /** Crea la jerarquía de carpetas que precede al archivo y devuelve la ruta completa. */
  private async ensureParents(relativePath: string): Promise<string> {
    const segments = relativePath.split("/");
    const name = segments[segments.length - 1];
    let current = `/${this.rootName()}`;
    await this.ensureFolder(current);
    for (const segment of segments.slice(0, -1)) {
      current = `${current}/${segment}`;
      await this.ensureFolder(current);
    }
    return `${current}/${name}`;
  }

  private async upload(absolutePath: string, data: Buffer): Promise<void> {
    const response = await this.fetchImpl()(
      `${DROPBOX_CONTENT_BASE}/files/upload`,
      {
        method: "POST",
        headers: {
          ...(await this.authHeaders()),
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            path: absolutePath,
            mode: "overwrite",
            autorename: false,
            mute: true,
          }),
        },
        body: data as unknown as BodyInit,
      }
    );
    if (!response.ok) {
      throw dropboxApiError(
        "la escritura",
        response.status,
        await DropboxStorageBackend.readError(response)
      );
    }
  }

  async write(key: string, data: Buffer): Promise<void> {
    const relative = await this.relativePath(key);
    const absolute = await this.ensureParents(relative);
    await this.upload(absolute, data);
  }

  async read(key: string): Promise<Buffer> {
    const absolute = this.fullPath(await this.relativePath(key));
    const headers: Record<string, string> = {
      ...(await this.authHeaders()),
      "Dropbox-API-Arg": JSON.stringify({ path: absolute }),
    };
    const response = await this.fetchImpl()(
      `${DROPBOX_CONTENT_BASE}/files/download`,
      { method: "POST", headers }
    );
    if (!response.ok) {
      throw dropboxApiError(
        "la lectura",
        response.status,
        await DropboxStorageBackend.readError(response)
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Lectura parcial con rango. Dropbox respeta la cabecera `Range` sobre la
   * descarga, de modo que el visor conserve el paginado de PDF y el
   * desplazamiento de audio y video sin descargar el binario completo.
   */
  async readRange(key: string, start: number, end: number): Promise<Buffer> {
    const absolute = this.fullPath(await this.relativePath(key));
    const headers: Record<string, string> = {
      ...(await this.authHeaders()),
      "Dropbox-API-Arg": JSON.stringify({ path: absolute }),
      Range: `bytes=${start}-${end}`,
    };
    const response = await this.fetchImpl()(
      `${DROPBOX_CONTENT_BASE}/files/download`,
      { method: "POST", headers }
    );
    if (response.status === 416) return Buffer.alloc(0);
    if (!response.ok) {
      throw dropboxApiError(
        "la lectura con rango",
        response.status,
        await DropboxStorageBackend.readError(response)
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const absolute = this.fullPath(await this.relativePath(key));
    const response = await this.fetchImpl()(
      `${DROPBOX_API_BASE}/files/delete_v2`,
      {
        method: "POST",
        headers: {
          ...(await this.authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: absolute }),
      }
    );
    if (response.ok || response.status === 409) return;
    throw dropboxApiError(
      "el borrado",
      response.status,
      await DropboxStorageBackend.readError(response)
    );
  }

  async stat(key: string): Promise<StorageStat> {
    const absolute = this.fullPath(await this.relativePath(key));
    const metadata = await this.metadata(absolute);
    if (!metadata || metadata[".tag"] === "folder") throw missingFileError();
    return {
      size: Number(metadata.size ?? 0),
      mtime: metadata.server_modified
        ? new Date(metadata.server_modified)
        : new Date(0),
    };
  }
}
