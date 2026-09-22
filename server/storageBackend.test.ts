import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentStorageBackend,
  LocalStorageBackend,
  useStorageBackend,
} from "./storageBackend";

const backend = new LocalStorageBackend();

async function temporaryRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "storage-backend-"));
}

describe("costura de almacenamiento local", () => {
  it("escribe con atomicidad y crea los directorios intermedios", async () => {
    const directory = await temporaryRoot();
    const target = path.join(directory, "a", "b", "archivo.pdf");
    await backend.write(target, Buffer.from("contenido"));
    expect(await fs.readFile(target, "utf8")).toBe("contenido");
    const leftovers = (await fs.readdir(path.dirname(target))).filter(name =>
      name.includes(".tmp")
    );
    expect(leftovers).toEqual([]);
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("lee, mide y borra con la semántica del sistema de archivos", async () => {
    const directory = await temporaryRoot();
    const target = path.join(directory, "archivo.bin");
    await backend.write(target, Buffer.from("bytes"));
    expect((await backend.read(target)).toString()).toBe("bytes");
    const stat = await backend.stat(target);
    expect(stat.size).toBe(5);
    await backend.remove(target);
    await expect(backend.stat(target)).rejects.toThrow();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("permite conmutar el backend vigente desde un único punto", () => {
    const original = currentStorageBackend();
    const stub = {
      ...original,
      write: async () => undefined,
    };
    useStorageBackend(stub);
    expect(currentStorageBackend()).toBe(stub);
    useStorageBackend(original);
    expect(currentStorageBackend()).toBe(original);
  });
});
