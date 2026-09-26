import { describe, expect, it } from "vitest";
import {
  DropboxStorageBackend,
  DROPBOX_API_BASE,
  DROPBOX_CONTENT_BASE,
  DROPBOX_ROOT_FOLDER,
  sanitizeDropboxSegment,
} from "./dropboxStorage";

type StoredFile = { id: string; content: Buffer; modified: string };

/**
 * Dropbox en memoria: carpetas, archivos y las cabeceras que el backend real
 * usa. Ninguna prueba sale a internet.
 */
function fakeDropbox(options: { downloadStatus?: number } = {}) {
  const files = new Map<string, StoredFile>();
  const folders = new Set<string>();
  const calls: string[] = [];
  let counter = 0;

  const json = (payload: unknown, ok = true, status = 200) =>
    ({
      ok,
      status,
      json: async () => payload,
    }) as unknown as Response;

  const binary = (content: Buffer, status = 200) =>
    ({
      ok: true,
      status,
      arrayBuffer: async () =>
        content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength
        ),
    }) as unknown as Response;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers as Record<string, string>) ?? {};
    calls.push(`${method} ${url}`);

    if (url === `${DROPBOX_API_BASE}/files/create_folder_v2`) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { path: string };
      folders.add(body.path);
      return json({ metadata: { name: body.path.split("/").pop() } });
    }
    if (url === `${DROPBOX_API_BASE}/files/get_metadata`) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { path: string };
      const file = files.get(body.path);
      if (file) {
        return json({
          ".tag": "file",
          id: file.id,
          name: body.path.split("/").pop(),
          size: file.content.length,
          server_modified: file.modified,
        });
      }
      if (folders.has(body.path)) {
        return json({ ".tag": "folder", name: body.path.split("/").pop() });
      }
      return json({ error_summary: "path/not_found/.." }, false, 409);
    }
    if (url === `${DROPBOX_CONTENT_BASE}/files/upload`) {
      const args = JSON.parse(headers["Dropbox-API-Arg"] ?? "{}") as {
        path: string;
      };
      files.set(args.path, {
        id: `id-${++counter}`,
        content: Buffer.from(init?.body as Buffer),
        modified: "2026-09-25T10:00:00Z",
      });
      return json({ name: args.path.split("/").pop() });
    }
    if (url === `${DROPBOX_CONTENT_BASE}/files/download`) {
      if (options.downloadStatus) {
        return json({ error_summary: "path/not_found/.." }, false, options.downloadStatus);
      }
      const args = JSON.parse(headers["Dropbox-API-Arg"] ?? "{}") as {
        path: string;
      };
      const file = files.get(args.path);
      if (!file) return json({ error_summary: "path/not_found/.." }, false, 409);
      const range = /^bytes=(\d+)-(\d+)$/.exec(String(headers.Range ?? ""));
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (start > end || start >= file.content.length) {
          return json({ error_summary: "range/.." }, false, 416);
        }
        return binary(
          file.content.subarray(start, Math.min(end + 1, file.content.length)),
          206
        );
      }
      return binary(file.content);
    }
    if (url === `${DROPBOX_API_BASE}/files/list_folder`) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { path: string };
      const prefix = body.path === "/" ? "/" : `${body.path}/`;
      const entries: Array<Record<string, unknown>> = [];
      for (const folder of folders) {
        if (!folder.startsWith(prefix)) continue;
        const rest = folder.slice(prefix.length);
        if (rest && !rest.includes("/"))
          entries.push({ ".tag": "folder", name: rest, path_display: folder });
      }
      for (const [path, file] of files) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest && !rest.includes("/"))
          entries.push({
            ".tag": "file",
            name: rest,
            path_display: path,
            size: file.content.length,
            server_modified: file.modified,
          });
      }
      return json({ entries });
    }
    if (url === `${DROPBOX_API_BASE}/files/delete_v2`) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { path: string };
      if (!files.delete(body.path)) {
        return json({ error_summary: "path/not_found/.." }, false, 409);
      }
      return json({ metadata: {} });
    }
    return json({ error_summary: "unsupported" }, false, 404);
  }) as unknown as typeof fetch;

  return { fetchImpl, files, folders, calls };
}

describe("backend de almacenamiento en Dropbox", () => {
  it("lista el árbol visible y lee por ruta, incluidas carpetas y nombres originales", async () => {
    const { fetchImpl } = fakeDropbox();
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
    });

    // El alta materializa la jerarquía y el RAG del proyecto la recorre tal cual.
    await backend.ensureFolderPath(
      "Solar Guatemala/Ejecutivo de Negocios (Ventas)/Gustavo Martínez Fuentes"
    );
    await backend.write(
      "Solar Guatemala/ESTUDIO DE VIABILIDAD.pdf",
      Buffer.from("0123456789")
    );

    const entries = await backend.list("Solar Guatemala");
    expect(
      entries.some(
        entry => entry.type === "folder" && entry.name === "Ejecutivo de Negocios (Ventas)"
      )
    ).toBe(true);
    const file = entries.find(entry => entry.name === "ESTUDIO DE VIABILIDAD.pdf");
    expect(file?.type).toBe("file");
    expect(file?.size).toBe(10);

    await expect(
      backend.statVisible("Solar Guatemala/ESTUDIO DE VIABILIDAD.pdf")
    ).resolves.toMatchObject({ size: 10 });
    await expect(
      backend.readVisible("Solar Guatemala/ESTUDIO DE VIABILIDAD.pdf")
    ).resolves.toEqual(Buffer.from("0123456789"));
    await expect(
      backend.readRangeVisible(
        "Solar Guatemala/ESTUDIO DE VIABILIDAD.pdf",
        2,
        5
      )
    ).resolves.toEqual(Buffer.from("2345"));
  });

  it("escribe creando la jerarquía de carpetas y publica los bytes", async () => {
    const { files, folders, fetchImpl } = fakeDropbox();
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
    });

    await backend.write("3/11111111-2222-3333-4444-555555555555.pdf", Buffer.from("hola"));

    expect(folders.has(`/${DROPBOX_ROOT_FOLDER}`)).toBe(true);
    const stored = files.get(
      `/${DROPBOX_ROOT_FOLDER}/3/11111111-2222-3333-4444-555555555555.pdf`
    );
    expect(stored?.content.toString("utf8")).toBe("hola");
  });

  it("resuelve la ruta con el resolutor inyectado y sanea los segmentos", async () => {
    const { files, fetchImpl } = fakeDropbox();
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
      pathResolver: async key => `Solar Guatemala/Ing. Solar/José Ardón/${key.split("/").pop()}`,
    });

    await backend.write("applications/7/doc.pdf", Buffer.from("cv"));

    expect(
      files
        .get(
          `/${DROPBOX_ROOT_FOLDER}/Solar Guatemala/Ing. Solar/José Ardón/doc.pdf`
        )
        ?.content.toString("utf8")
    ).toBe("cv");
  });

  it("lee, informa metadatos y lee rangos", async () => {
    const { fetchImpl } = fakeDropbox();
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
    });
    const key = "3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.bin";
    await backend.write(key, Buffer.from("0123456789"));

    await expect(backend.read(key)).resolves.toEqual(Buffer.from("0123456789"));
    const stats = await backend.stat(key);
    expect(stats.size).toBe(10);
    await expect(backend.readRange(key, 2, 5)).resolves.toEqual(
      Buffer.from("2345")
    );
  });

  it("propaga ENOENT cuando el archivo no existe", async () => {
    const { fetchImpl } = fakeDropbox();
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
    });
    await expect(
      backend.read("3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.bin")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("declara la causa nombrada de un fallo de la API", async () => {
    const { fetchImpl } = fakeDropbox({ downloadStatus: 429 });
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
    });
    const key = "3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.bin";
    await expect(backend.read(key)).rejects.toMatchObject({
      code: "dropbox_rate_limited",
    });
  });

  it("lee el documento en su ruta anterior cuando el nombre visible cambió", async () => {
    // La mejora del nombre no puede dejar ilegible lo ya custodiado: el
    // documento escrito con el identificador interno se abre igual.
    const { files, fetchImpl } = fakeDropbox();
    const key = "3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf";
    const legacy = `/${DROPBOX_ROOT_FOLDER}/3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf`;
    files.set(legacy, {
      id: "id-legacy",
      content: Buffer.from("informe"),
      modified: "2026-09-26T10:00:00Z",
    });
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
      pathResolver: async () => "Solar Guatemala/Informe anual.pdf",
      legacyPathResolver: async () => "3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf",
    });

    await expect(backend.read(key)).resolves.toEqual(Buffer.from("informe"));
    await expect(backend.stat(key)).resolves.toMatchObject({ size: 7 });
    await backend.remove(key);
    expect(files.has(legacy)).toBe(false);
  });

  it("prefiere la ruta vigente y solo recurre a la anterior si falta", async () => {
    const { files, calls, fetchImpl } = fakeDropbox();
    const key = "3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf";
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
      pathResolver: async () => "Solar Guatemala/Informe anual.pdf",
      legacyPathResolver: async () => "3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf",
    });
    await backend.write(key, Buffer.from("vigente"));

    await expect(backend.read(key)).resolves.toEqual(Buffer.from("vigente"));
    expect(
      files.has(`/${DROPBOX_ROOT_FOLDER}/Solar Guatemala/Informe anual.pdf`)
    ).toBe(true);
    const downloads = calls.filter(call => call.includes("files/download"));
    expect(downloads).toHaveLength(1);
  });

  it("borra sin fallar cuando el archivo no existe", async () => {
    const { fetchImpl } = fakeDropbox();
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
    });
    await expect(
      backend.remove("3/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.bin")
    ).resolves.toBeUndefined();
  });

  it("sanea los nombres visibles conservando acentos y retirando la barra", () => {
    expect(sanitizeDropboxSegment("Ing. Solar / Planta")).toBe(
      "Ing. Solar - Planta"
    );
    expect(sanitizeDropboxSegment("José   Ardón")).toBe("José Ardón");
    expect(sanitizeDropboxSegment("..")).toBe("Sin nombre");
    expect(sanitizeDropboxSegment("")).toBe("Sin nombre");
  });

  it("rechaza claves con escape de directorio", async () => {
    const { fetchImpl } = fakeDropbox();
    const backend = new DropboxStorageBackend(async () => "access-token", {
      fetchImpl,
      pathResolver: () => "../fuera.pdf",
    });
    await expect(backend.read("x")).rejects.toThrow(/no es válida/);
  });
});
