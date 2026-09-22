import { describe, expect, it } from "vitest";
import {
  DriveStorageBackend,
  DRIVE_API_BASE,
  DRIVE_UPLOAD_BASE,
} from "./driveStorage";

type StoredFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content?: Buffer;
  modifiedTime: string;
};

function fakeDrive() {
  const files = new Map<string, StoredFile>();
  let counter = 0;
  const id = () => `drive-${++counter}`;

  const find = (name: string, parent: string, mimeType?: string) =>
    [...files.values()].filter(
      file =>
        file.name === name &&
        file.parents.includes(parent) &&
        (!mimeType || file.mimeType === mimeType)
    );

  const jsonResponse = (payload: unknown, ok = true, status = 200) =>
    ({
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }) as unknown as Response;

  const binaryResponse = (content: Buffer) =>
    ({
      ok: true,
      status: 200,
      arrayBuffer: async () => content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength
      ),
    }) as unknown as Response;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.startsWith(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`)) {
      const body = String(init?.body ?? "");
      const name = /"name":"([^"]+)"/.exec(body)?.[1] ?? "archivo";
      const parent = /"parents":\["([^"]+)"\]/.exec(body)?.[1] ?? "root";
      const marker = "application/octet-stream\r\n\r\n";
      const contentStart = body.indexOf(marker);
      const content = contentStart >= 0 ? body.slice(contentStart + marker.length) : "";
      const contentEnd = content.indexOf("\r\n--jarvi-");
      const payload =
        contentEnd >= 0 ? content.slice(0, contentEnd) : content;
      const created: StoredFile = {
        id: id(),
        name,
        mimeType: "application/octet-stream",
        parents: [parent],
        content: Buffer.from(payload, "utf8"),
        modifiedTime: "2026-09-22T00:00:00.000Z",
      };
      files.set(created.id, created);
      return jsonResponse({ id: created.id });
    }
    if (url.startsWith(`${DRIVE_UPLOAD_BASE}/files/`) && url.includes("uploadType=media")) {
      const fileId = url.split("/files/")[1].split("?")[0];
      const file = files.get(fileId);
      if (!file) return jsonResponse({}, false, 404);
      file.content = Buffer.from((init?.body as Buffer) ?? Buffer.from(""));
      return jsonResponse({ id: fileId });
    }
    if (url.startsWith(`${DRIVE_API_BASE}/files?`)) {
      const q = decodeURIComponent(url.split("q=")[1].split("&")[0]);
      const name = /name='([^']+)'/.exec(q)?.[1] ?? "";
      const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? "";
      const mimeType = /mimeType='([^']+)'/.exec(q)?.[1];
      return jsonResponse({
        files: find(name, parent, mimeType).map(file => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: String(file.content?.length ?? 0),
          modifiedTime: file.modifiedTime,
        })),
      });
    }
    if (url.startsWith(`${DRIVE_API_BASE}/files/`)) {
      const fileId = url.split("/files/")[1].split("?")[0];
      const file = files.get(fileId);
      if (!file) return jsonResponse({}, false, 404);
      if (method === "DELETE") {
        files.delete(fileId);
        return jsonResponse({});
      }
      if (url.includes("alt=media")) {
        return binaryResponse(file.content ?? Buffer.from(""));
      }
      return jsonResponse({ id: file.id });
    }
    if (url === `${DRIVE_API_BASE}/files` && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        name?: string;
        mimeType?: string;
        parents?: string[];
      };
      const created: StoredFile = {
        id: id(),
        name: body.name ?? "",
        mimeType: body.mimeType ?? "application/octet-stream",
        parents: body.parents ?? ["root"],
        modifiedTime: "2026-09-22T00:00:00.000Z",
      };
      files.set(created.id, created);
      return jsonResponse({ id: created.id });
    }
    return jsonResponse({}, false, 404);
  }) as unknown as typeof fetch;

  return { files, fetchImpl };
}

describe("backend de almacenamiento en Google Drive", () => {
  it("escribe, lee, mide y borra por clave bajo la jerarquía de carpetas", async () => {
    const { files, fetchImpl } = fakeDrive();
    const backend = new DriveStorageBackend(async () => "access-token", {
      fetchImpl,
    });

    await backend.write("3/uuid-1234.pdf", Buffer.from("contenido-del-pdf"));
    expect(
      [...files.values()].some(
        file =>
          file.name === "JARVI RH" &&
          file.mimeType === "application/vnd.google-apps.folder"
      )
    ).toBe(true);
    expect(
      [...files.values()].some(
        file =>
          file.name === "3" &&
          file.mimeType === "application/vnd.google-apps.folder"
      )
    ).toBe(true);
    expect(
      [...files.values()].some(
        file =>
          file.name === "uuid-1234.pdf" &&
          file.content?.toString() === "contenido-del-pdf"
      )
    ).toBe(true);

    expect((await backend.read("3/uuid-1234.pdf")).toString()).toBe(
      "contenido-del-pdf"
    );
    expect((await backend.stat("3/uuid-1234.pdf")).size).toBe(17);

    await backend.remove("3/uuid-1234.pdf");
    await expect(backend.stat("3/uuid-1234.pdf")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("sobrescribe una clave existente en lugar de duplicar", async () => {
    const { files, fetchImpl } = fakeDrive();
    const backend = new DriveStorageBackend(async () => "access-token", {
      fetchImpl,
    });
    await backend.write("3/uuid.pdf", Buffer.from("primero"));
    await backend.write("3/uuid.pdf", Buffer.from("segundo"));
    const matches = [...files.values()].filter(
      file => file.name === "uuid.pdf"
    );
    expect(matches).toHaveLength(1);
    expect((await backend.read("3/uuid.pdf")).toString()).toBe("segundo");
  });

  it("declara la ausencia con el código del sistema de archivos", async () => {
    const { fetchImpl } = fakeDrive();
    const backend = new DriveStorageBackend(async () => "access-token", {
      fetchImpl,
    });
    await expect(backend.read("3/inexistente.pdf")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
