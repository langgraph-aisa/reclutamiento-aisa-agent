import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const execute = promisify(execFile);
export const DOCUMENT_TEXT_LIMIT = 120_000;
const MAX_OCR_PAGES = 20;
export class DocumentExtractionError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

export type ExtractedDocument = {
  text: string;
  method: string;
  truncated: boolean;
};

function result(text: string, method: string): ExtractedDocument {
  const normalized = text.trim();
  if (!normalized)
    throw new DocumentExtractionError(
      "no_extractable_text",
      "El archivo fue recibido, pero no contiene texto reconocible."
    );
  return {
    text: normalized.slice(0, DOCUMENT_TEXT_LIMIT),
    method,
    truncated: normalized.length > DOCUMENT_TEXT_LIMIT,
  };
}

async function command(binary: string, args: string[], timeout = 90_000) {
  try {
    const output = await execute(binary, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    });
    return output.stdout;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new DocumentExtractionError(
      code === "ENOENT" ? "decoder_unavailable" : "extraction_failed",
      code === "ENOENT"
        ? `El decodificador ${binary} no está instalado.`
        : `El decodificador ${binary} no pudo interpretar el archivo dentro de sus límites.`
    );
  }
}

export async function extractDocumentText(
  data: Buffer,
  extension: string
): Promise<ExtractedDocument> {
  const ext = extension.toLowerCase();
  if (ext === "docx") {
    try {
      return result(
        (await mammoth.extractRawText({ buffer: data })).value,
        "mammoth"
      );
    } catch (error) {
      if (error instanceof DocumentExtractionError) throw error;
      throw new DocumentExtractionError(
        "extraction_failed",
        "El documento Word no pudo interpretarse."
      );
    }
  }
  if (ext === "pdf") {
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const extracted = await parser.getText({ pageJoiner: "" });
      if (
        extracted.text.trim() &&
        extracted.pages.every(page => page.text.trim())
      )
        return result(extracted.text, "pdf-text");
    } catch {
      throw new DocumentExtractionError(
        "extraction_failed",
        "El PDF no pudo abrirse; puede estar dañado o protegido."
      );
    } finally {
      await parser.destroy();
    }
  }
  const image = ["jpg", "jpeg", "png", "webp"].includes(ext);
  if (!["doc", "pdf"].includes(ext) && !image) {
    throw new DocumentExtractionError(
      "unsupported_format",
      "El archivo está conservado; este formato no dispone de extracción de texto."
    );
  }
  if (ext !== "doc" && process.env.DOCUMENT_OCR_ENABLED !== "true") {
    throw new DocumentExtractionError(
      "ocr_disabled",
      "El archivo fue recibido y requiere OCR, que está deshabilitado."
    );
  }
  const deadline = Date.now() + 180_000;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0)
      throw new DocumentExtractionError(
        "extraction_limit",
        "El OCR excedió el tiempo total permitido."
      );
    return Math.min(ms, 90_000);
  };
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "candidate-extraction-")
  );
  try {
    const input = path.join(directory, `input.${ext}`);
    await fs.writeFile(input, data, { mode: 0o600 });
    if (ext === "doc")
      return result(
        await command("antiword", ["-m", "UTF-8.txt", input]),
        "antiword"
      );
    let images = [input];
    if (ext === "pdf") {
      const info = await command("pdfinfo", [input]);
      const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
      if (!pages || pages > MAX_OCR_PAGES)
        throw new DocumentExtractionError(
          "extraction_limit",
          `El PDF requiere revisión: el OCR admite hasta ${MAX_OCR_PAGES} páginas.`
        );
      await command("pdftoppm", [
        "-r",
        "120",
        "-scale-to",
        "2400",
        "-png",
        "-f",
        "1",
        "-l",
        String(pages),
        input,
        path.join(directory, "page"),
      ]);
      images = (await fs.readdir(directory))
        .filter(name => /^page-\d+\.png$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(name => path.join(directory, name));
      if (images.length !== pages)
        throw new DocumentExtractionError(
          "extraction_failed",
          "La conversión OCR no produjo todas las páginas."
        );
    }
    const pages: string[] = [];
    for (const imagePath of images)
      pages.push(
        await command(
          "tesseract",
          [imagePath, "stdout", "-l", "spa+eng"],
          remaining()
        )
      );
    return result(pages.join("\n\n"), "tesseract-ocr");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/** Conversión local de audio heredado; nunca consulta una URL del proveedor. */
export async function normalizeLegacyAudio(data: Buffer, extension: string) {
  if (!["amr", "aac", "opus", "3gp"].includes(extension)) return null;
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "candidate-audio-")
  );
  try {
    const input = path.join(directory, `input.${extension}`);
    const output = path.join(directory, "audio.mp3");
    await fs.writeFile(input, data, { mode: 0o600 });
    await command("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "48k",
      "-fs",
      "25000000",
      output,
    ]);
    const converted = await fs.readFile(output);
    if (converted.length >= 25_000_000)
      throw new DocumentExtractionError(
        "extraction_limit",
        "La conversión de audio alcanzó su límite; requiere revisión."
      );
    return converted;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
