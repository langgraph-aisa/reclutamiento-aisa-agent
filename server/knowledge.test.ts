import { describe, expect, it, vi } from "vitest";
import {
  buildStorageKey,
  countWords,
  extensionOf,
  getKnowledgeSettings,
  KNOWLEDGE_ANALYSIS_WORD_LIMIT,
  KNOWLEDGE_DEFAULT_MAX_SIZE_MB,
  KNOWLEDGE_EXTENSION_WHITELIST,
  KNOWLEDGE_MAX_SIZE_MB,
  KNOWLEDGE_SUMMARY_WORD_LIMIT,
  knowledgeFileKind,
  knowledgeMimeType,
  limitWords,
  renderCsvPreviewFromBuffer,
  renderPlainTextPreviewFromBuffer,
  renderSpreadsheetHtmlFromBuffer,
} from "./knowledge";

describe("project knowledge settings and limits", () => {
  it("compone la vista previa a partir de bytes para CSV y texto", () => {
    // El visor por ruta de Dropbox reutiliza estas conversiones: los bytes ya
    // leídos del backend se convierten a HTML igual que en el RAG por catálogo.
    const csv = renderCsvPreviewFromBuffer(
      Buffer.from("nombre;edad\nAna;30\n"),
      "Hoja"
    );
    expect(csv).toContain("<th>nombre</th>");
    expect(csv).toContain("<td>Ana</td>");

    const text = renderPlainTextPreviewFromBuffer(
      Buffer.from("<b>hola</b>")
    );
    expect(text).toContain("&lt;b&gt;hola&lt;/b&gt;");
  });

  it("compone la vista previa de la hoja de cálculo a partir de bytes", async () => {
    // La hoja de cálculo viaja por la misma ruta que Word y el texto: el
    // visor la sirve por ruta de Dropbox y no solo por clave de catálogo.
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["nombre", "edad"],
        ["Ana", 30],
      ]),
      "Hoja1"
    );
    const data = XLSX.write(book, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;
    const html = await renderSpreadsheetHtmlFromBuffer(
      Buffer.from(data),
      "Hoja"
    );
    expect(html).toContain("<th>nombre</th>");
    expect(html).toContain("<td>Ana</td>");
  });

  it("declares the institutional word limits for summaries and deep analysis", () => {
    expect(KNOWLEDGE_SUMMARY_WORD_LIMIT).toBe(66);
    expect(KNOWLEDGE_ANALYSIS_WORD_LIMIT).toBe(325);
  });

  it("limits words deterministically", () => {
    const text = Array.from({ length: 40 }, (_, index) => `palabra${index + 1}`).join(" ");
    expect(countWords(limitWords(text, 12))).toBe(12);
    expect(countWords(limitWords("Una sola oración breve.", 12))).toBe(4);
  });

  it("classifies extensions and resolves institutional mime types", () => {
    expect(extensionOf("Capital.PDF")).toBe("pdf");
    expect(extensionOf("archivo.sin.extension")).toBe("extension");
    expect(knowledgeFileKind("png")).toBe("imagen");
    expect(knowledgeFileKind("mp4")).toBe("video");
    expect(knowledgeFileKind("mp3")).toBe("audio");
    expect(knowledgeFileKind("docx")).toBe("documento");
    expect(knowledgeFileKind("csv")).toBe("hoja");
    expect(knowledgeMimeType("pdf")).toBe("application/pdf");
    expect(knowledgeMimeType("docx")).toContain("wordprocessingml");
    expect(KNOWLEDGE_EXTENSION_WHITELIST).toContain("pdf");
    expect(KNOWLEDGE_EXTENSION_WHITELIST).toContain("xlsx");
    expect(KNOWLEDGE_MAX_SIZE_MB).toBeGreaterThanOrEqual(
      KNOWLEDGE_DEFAULT_MAX_SIZE_MB
    );
  });

  it("generates storage keys scoped to the owning project", () => {
    expect(buildStorageKey(7, "pdf")).toMatch(/^7\/[a-f0-9-]{36}\.pdf$/);
  });

  it("falls back to defaults when no settings are persisted", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as Parameters<typeof getKnowledgeSettings>[0];
    const settings = await getKnowledgeSettings(pool);
    expect(settings.maxSizeMb).toBe(KNOWLEDGE_DEFAULT_MAX_SIZE_MB);
    expect(settings.allowedExtensions).toEqual([
      ...KNOWLEDGE_EXTENSION_WHITELIST,
    ]);
  });

  it("parses the configured extensions and maximum size", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          { setting_key: "allowed_extensions", setting_value: "pdf,docx,png" },
          { setting_key: "max_size_mb", setting_value: "8" },
        ],
      })),
    } as unknown as Parameters<typeof getKnowledgeSettings>[0];
    const settings = await getKnowledgeSettings(pool);
    expect(settings.allowedExtensions).toEqual(["pdf", "docx", "png"]);
    expect(settings.maxSizeMb).toBe(8);
  });
});
