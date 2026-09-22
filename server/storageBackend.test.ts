import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentStorageBackend,
  LocalStorageBackend,
  useStorageBackend,
} from "./storageBackend";

async function temporaryRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "storage-backend-"));
}

describe("costura de almacenamiento local", () => {
  it("escribe por clave con atomicidad y crea los niveles intermedios", async () => {
    const directory = await temporaryRoot();
    const backend = new LocalStorageBackend(() => directory);
    await backend.write("a/b/archivo.pdf", Buffer.from("contenido"));
    expect(
      await fs.readFile(path.join(directory, "a", "b", "archivo.pdf"), "utf8")
    ).toBe("contenido");
    const leftovers = (
      await fs.readdir(path.join(directory, "a", "b"))
    ).filter(name => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("lee, mide y borra por clave con la semántica del sistema de archivos", async () => {
    const directory = await temporaryRoot();
    const backend = new LocalStorageBackend(() => directory);
    await backend.write("archivo.bin", Buffer.from("bytes"));
    expect((await backend.read("archivo.bin")).toString()).toBe("bytes");
    const stat = await backend.stat("archivo.bin");
    expect(stat.size).toBe(5);
    await backend.remove("archivo.bin");
    await expect(backend.stat("archivo.bin")).rejects.toThrow();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("rechaza claves que intentan salir del directorio", async () => {
    const directory = await temporaryRoot();
    const backend = new LocalStorageBackend(() => directory);
    await expect(
      backend.write("../escape.pdf", Buffer.from("x"))
    ).rejects.toThrow(/no es válida/);
    await expect(backend.read("a/../../etc")).rejects.toThrow(/no es válida/);
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
