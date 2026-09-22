import type { StorageBackend, StorageStat } from "./storageBackend";

/**
 * Backend de Google Drive para la costura de almacenamiento.
 *
 * Resuelve cada clave relativa contra una jerarquía de carpetas en el Drive del
 * propietario, bajo la raíz `JARVI RH`. La clave `<proyecto>/<uuid>.pdf` se
 * traduce a la carpeta `JARVI RH/<proyecto>` con el archivo `<uuid>.pdf`, y la
 * clave `applications/<postulación>/<uuid>` a su carpeta correspondiente, de
 * modo que la estructura del Drive refleja la estructura lógica del RAG.
 *
 * El acceso se realiza con un token de acceso renovado por el llamador
 * (`tokenSource`); el backend no conserva credenciales. Toda la entrada y
 * salida de red se inyecta para que las pruebas no salgan a internet.
 */

export const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
export const DRIVE_ROOT_FOLDER = "JARVI RH";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

type FetchImpl = typeof fetch;

export type DriveTokenSource = () => Promise<string>;

/** Reescribe una clave antes de resolverla contra Drive (p. ej., anidar el candidato bajo su proyecto). */
export type DriveKeyMapper = (key: string) => string;

/**
 * Mapper que anida la carpeta del candidato bajo la carpeta de su proyecto:
 * `applications/<postulación>/<uuid>` pasa a `<proyecto>/candidatos/<postulación>/<uuid>`.
 */
export function candidateUnderProjectKeyMapper(
  projectId: number | string
): DriveKeyMapper {
  const prefix = `${projectId}/candidatos/`;
  return key =>
    key.replace(/^applications\/([^/]+)\//, `${prefix}$1/`);
}

type DriveFileRef = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
};

function missingFileError() {
  return Object.assign(
    new Error("El archivo no existe en el almacenamiento."),
    { code: "ENOENT" }
  );
}

/**
 * Error de la API de Drive con causa nombrada. Sin un código propio, un fallo
 * de autenticación, de cuota o de red se presentaría al operador con la misma
 * frase genérica; el código permite que el llamador lo declare con su motivo.
 */
function driveApiError(operation: string, status: number): Error {
  const code =
    status === 401
      ? "drive_unauthenticated"
      : status === 403
        ? "drive_forbidden"
        : status === 404
          ? "ENOENT"
          : status === 429
            ? "drive_rate_limited"
            : "drive_unavailable";
  return Object.assign(
    new Error(
      `Google Drive rechazó ${operation} con estado HTTP ${status}.`
    ),
    { code }
  );
}

export class DriveStorageBackend implements StorageBackend {
  constructor(
    private readonly tokenSource: DriveTokenSource,
    private readonly options: {
      fetchImpl?: FetchImpl;
      rootFolderName?: string;
      keyMapper?: DriveKeyMapper;
    } = {}
  ) {}

  private fetchImpl(): FetchImpl {
    return this.options.fetchImpl ?? fetch;
  }

  private rootName(): string {
    return this.options.rootFolderName ?? DRIVE_ROOT_FOLDER;
  }

  private mapKey(key: string): string {
    return this.options.keyMapper ? this.options.keyMapper(key) : key;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.tokenSource()}` };
  }

  private async listByName(
    name: string,
    parentId: string,
    mimeType?: string
  ): Promise<DriveFileRef[]> {
    const conditions = [
      `name='${name.replace(/'/g, "\\'")}'`,
      `'${parentId}' in parents`,
      "trashed=false",
    ];
    if (mimeType) conditions.push(`mimeType='${mimeType}'`);
    const q = encodeURIComponent(conditions.join(" and "));
    const headers = await this.authHeaders();
    const response = await this.fetchImpl()(
      `${DRIVE_API_BASE}/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)`,
      { headers }
    );
    if (!response.ok) {
      throw driveApiError("el listado", response.status);
    }
    const data = (await response.json()) as { files?: DriveFileRef[] };
    return data.files ?? [];
  }

  private async createFolder(name: string, parentId: string): Promise<string> {
    const headers = {
      ...(await this.authHeaders()),
      "Content-Type": "application/json",
    };
    const response = await this.fetchImpl()(`${DRIVE_API_BASE}/files`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME,
        parents: [parentId],
      }),
    });
    if (!response.ok) {
      throw driveApiError("la creación de la carpeta", response.status);
    }
    const data = (await response.json()) as { id?: string };
    return String(data.id);
  }

  private async ensureFolder(name: string, parentId: string): Promise<string> {
    const existing = await this.listByName(name, parentId, DRIVE_FOLDER_MIME);
    if (existing.length) return existing[0].id;
    return this.createFolder(name, parentId);
  }

  private async rootFolderId(): Promise<string> {
    return this.ensureFolder(this.rootName(), "root");
  }

  private async resolveParentAndName(
    key: string
  ): Promise<{ parentId: string; name: string }> {
    const segments = this.mapKey(key).split("/");
    const name = segments.pop();
    if (!name || segments.some(segment => !segment || segment.includes(".."))) {
      throw new Error("La referencia de almacenamiento no es válida.");
    }
    let parentId = await this.rootFolderId();
    for (const segment of segments) {
      parentId = await this.ensureFolder(segment, parentId);
    }
    return { parentId, name };
  }

  private async uploadNew(
    name: string,
    parentId: string,
    data: Buffer
  ): Promise<void> {
    const boundary = `jarvi-${Date.now()}`;
    const metadata = Buffer.from(
      JSON.stringify({ name, parents: [parentId] }),
      "utf8"
    );
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
      ),
      metadata,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const headers = {
      ...(await this.authHeaders()),
      "Content-Type": `multipart/related; boundary=${boundary}`,
    };
    const response = await this.fetchImpl()(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
      { method: "POST", headers, body: body as unknown as BodyInit }
    );
    if (!response.ok) {
      throw driveApiError("la escritura", response.status);
    }
  }

  private async uploadMedia(fileId: string, data: Buffer): Promise<void> {
    const headers = {
      ...(await this.authHeaders()),
      "Content-Type": "application/octet-stream",
    };
    const response = await this.fetchImpl()(
      `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`,
      { method: "PATCH", headers, body: data as unknown as BodyInit }
    );
    if (!response.ok) {
      throw driveApiError("la actualización", response.status);
    }
  }

  async write(key: string, data: Buffer): Promise<void> {
    const { parentId, name } = await this.resolveParentAndName(key);
    const existing = await this.listByName(name, parentId);
    if (existing.length) {
      await this.uploadMedia(existing[0].id, data);
    } else {
      await this.uploadNew(name, parentId, data);
    }
  }

  async read(key: string): Promise<Buffer> {
    const { parentId, name } = await this.resolveParentAndName(key);
    const existing = await this.listByName(name, parentId);
    if (!existing.length) throw missingFileError();
    const headers = await this.authHeaders();
    const response = await this.fetchImpl()(
      `${DRIVE_API_BASE}/files/${existing[0].id}?alt=media`,
      { headers }
    );
    if (!response.ok) {
      throw driveApiError("la lectura", response.status);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Lectura parcial con rango. Google Drive respeta la cabecera `Range` sobre
   * `alt=media`, de modo que el visor conserve el paginado de PDF y el
   * desplazamiento de audio y video sin descargar el binario completo.
   */
  async readRange(
    key: string,
    start: number,
    end: number
  ): Promise<Buffer> {
    const { parentId, name } = await this.resolveParentAndName(key);
    const existing = await this.listByName(name, parentId);
    if (!existing.length) throw missingFileError();
    const headers = {
      ...(await this.authHeaders()),
      Range: `bytes=${start}-${end}`,
    };
    const response = await this.fetchImpl()(
      `${DRIVE_API_BASE}/files/${existing[0].id}?alt=media`,
      { headers }
    );
    if (response.status === 416) {
      return Buffer.alloc(0);
    }
    if (!response.ok) {
      throw driveApiError("la lectura con rango", response.status);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const { parentId, name } = await this.resolveParentAndName(key);
    const existing = await this.listByName(name, parentId);
    for (const file of existing) {
      const headers = await this.authHeaders();
      await this.fetchImpl()(`${DRIVE_API_BASE}/files/${file.id}`, {
        method: "DELETE",
        headers,
      });
    }
  }

  async stat(key: string): Promise<StorageStat> {
    const { parentId, name } = await this.resolveParentAndName(key);
    const existing = await this.listByName(name, parentId);
    if (!existing.length) throw missingFileError();
    const file = existing[0];
    return {
      size: Number(file.size ?? 0),
      mtime: file.modifiedTime ? new Date(file.modifiedTime) : new Date(0),
    };
  }
}
