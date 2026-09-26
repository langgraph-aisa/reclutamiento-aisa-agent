import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  knowledgeFilePath,
  knowledgeMimeType,
  knowledgeStorageHealth,
  limitWords,
  renderCsvPreviewFromBuffer,
  renderPlainTextPreviewFromBuffer,
  renderSpreadsheetHtmlFromBuffer,
} from "./knowledge";
import { encryptAgentSecret, integrationSecretContext } from "./agentSettings";

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

/**
 * Diagnóstico del almacenamiento.
 *
 * Hasta 2.0.240 el informe comprobaba siempre el volumen del servidor, de modo
 * que un proyecto custodiado en Dropbox declaraba ausentes todos sus documentos
 * y recomendaba revisar un directorio que no participaba en esa custodia.
 */
describe("knowledge storage health by custody", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jarvi-health-"));
  const presentKey = "7/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf";
  const missingKey = "7/bbbbbbbb-cccc-dddd-eeee-ffffffffffff.pdf";

  beforeEach(() => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    vi.stubEnv("KNOWLEDGE_STORAGE_DIR", storageRoot);
    fs.mkdirSync(path.dirname(knowledgeFilePath(presentKey)), {
      recursive: true,
    });
    fs.writeFileSync(knowledgeFilePath(presentKey), "informe");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const rows = () => [
    {
      id: 1,
      original_name: "Informe presente.pdf",
      storage_key: presentKey,
      uploaded_at: new Date("2026-09-26T10:00:00Z"),
    },
    {
      id: 2,
      original_name: "Informe ausente.pdf",
      storage_key: missingKey,
      uploaded_at: new Date("2026-09-26T11:00:00Z"),
    },
  ];

  function poolFor(mode: "local" | "dropbox") {
    const settings =
      mode === "dropbox"
        ? [
            {
              setting_key: "oauth_client_id",
              setting_value: "dropbox-app-key",
              is_secret: false,
            },
            {
              setting_key: "oauth_client_secret",
              setting_value: encryptAgentSecret(
                "secret",
                integrationSecretContext("dropbox", "oauth_client_secret")
              ),
              is_secret: true,
            },
            {
              setting_key: "refresh:9",
              setting_value: encryptAgentSecret(
                JSON.stringify({
                  refreshToken: "refresh",
                  email: "e@aisa.com.gt",
                }),
                integrationSecretContext("dropbox", "refresh:9")
              ),
              is_secret: true,
            },
          ]
        : [];
    const query = vi.fn(async (sql: string) => {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes("row_number() OVER")) return { rows: [] };
      if (text.includes("FROM knowledge_files")) return { rows: rows() };
      if (text.includes("SELECT storage_mode FROM knowledge_projects"))
        return { rows: [{ storage_mode: mode }] };
      if (text.includes("FROM integration_settings")) return { rows: settings };
      if (text.includes("SELECT dropbox_connection_user_id, created_by_user_id"))
        return {
          rows: [{ dropbox_connection_user_id: null, created_by_user_id: 9 }],
        };
      if (text.includes("SELECT created_by_user_id FROM knowledge_projects"))
        return { rows: [{ created_by_user_id: 9 }] };
      if (text.includes("SELECT name FROM knowledge_projects"))
        return { rows: [{ name: "Solar Guatemala" }] };
      if (text.includes("FROM knowledge_projects")) return { rows: [{ id: 7 }] };
      return { rows: [] };
    });
    return { query } as never;
  }

  it("declara ausente solo lo que falta en el volumen cuando la custodia es local", async () => {
    const health = await knowledgeStorageHealth(poolFor("local"), 7);
    expect(health.custody).toBe("volumen");
    expect(health.storageMode).toBe("local");
    expect(health.registered).toBe(2);
    expect(health.verified).toBe(2);
    expect(health.present).toBe(1);
    expect(health.missing).toBe(1);
    expect(health.missingInVolume).toBe(1);
    expect(health.missingInDropbox).toBe(0);
    expect(health.missingSample[0]?.custody).toBe("volumen");
    expect(health.missingSample[0]?.originalName).toBe("Informe ausente.pdf");
  });

  it("no declara ausentes los documentos custodiados en Dropbox", async () => {
    // El canje del token y los metadatos se responden en memoria: el informe
    // debe comprobar Dropbox, no el volumen del servidor.
    const metadataCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/oauth2/token"))
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "access" }),
          } as unknown as Response;
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          path?: string;
        };
        metadataCalls.push(String(body.path));
        if (String(body.path).endsWith("bbbbbbbb-cccc-dddd-eeee-ffffffffffff.pdf"))
          return {
            ok: false,
            status: 409,
            json: async () => ({ error_summary: "path/not_found/.." }),
          } as unknown as Response;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ".tag": "file",
            size: 123,
            server_modified: "2026-09-26T10:00:00Z",
          }),
        } as unknown as Response;
      }) as unknown as typeof fetch
    );

    const health = await knowledgeStorageHealth(poolFor("dropbox"), 7);
    expect(health.custody).toBe("dropbox");
    expect(health.storageMode).toBe("dropbox");
    expect(health.missingInVolume).toBe(0);
    expect(health.missingInDropbox).toBe(1);
    expect(health.missing).toBe(1);
    expect(health.present).toBe(1);
    expect(health.missingSample[0]?.custody).toBe("dropbox");
    expect(metadataCalls.some(call => call.includes("JARVI RH"))).toBe(true);
  });
});
