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
} from "./knowledge";

describe("project knowledge settings and limits", () => {
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
