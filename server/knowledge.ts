import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import type { Pool } from "pg";
import { z } from "zod";
import { APP_VERSION } from "../shared/release";
import { getAgentRuntimeSettings } from "./agentSettings";
import { observeOpenAIClient } from "./observability/langfuse";

export const KNOWLEDGE_PROVIDER = "knowledge";
export const KNOWLEDGE_SUMMARY_WORD_LIMIT = 66;
export const KNOWLEDGE_ANALYSIS_WORD_LIMIT = 325;
export const KNOWLEDGE_ANALYSIS_MODEL = "gpt-4.1-mini-2025-04-14";

export const KNOWLEDGE_EXTENSION_WHITELIST = [
  "jpg",
  "jpeg",
  "png",
  "mp4",
  "mp3",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "pdf",
] as const;

export const KNOWLEDGE_DEFAULT_MAX_SIZE_MB = 20;
export const KNOWLEDGE_MIN_SIZE_MB = 1;
export const KNOWLEDGE_MAX_SIZE_MB = 30;

const SETTING_ALLOWED_EXTENSIONS = "allowed_extensions";
const SETTING_MAX_SIZE_MB = "max_size_mb";
const EXTRACTED_TEXT_LIMIT = 120_000;

export type KnowledgeSettings = {
  allowedExtensions: string[];
  maxSizeMb: number;
};

export type KnowledgeFileKind =
  | "imagen"
  | "video"
  | "audio"
  | "documento"
  | "hoja"
  | "otro";

export function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function limitWords(value: string, maximum: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maximum) return value.trim();
  return words.slice(0, maximum).join(" ");
}

export function extensionOf(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot < 0 ? "" : normalized.slice(dot + 1).slice(0, 16);
}

export function knowledgeFileKind(extension: string): KnowledgeFileKind {
  if (["jpg", "jpeg", "png"].includes(extension)) return "imagen";
  if (["mp4"].includes(extension)) return "video";
  if (["mp3"].includes(extension)) return "audio";
  if (["doc", "docx", "pdf"].includes(extension)) return "documento";
  if (["xls", "xlsx", "csv"].includes(extension)) return "hoja";
  return "otro";
}

export function knowledgeMimeType(extension: string) {
  const table: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    pdf: "application/pdf",
  };
  return table[extension] ?? "application/octet-stream";
}

function normalizeExtensions(value: string | null) {
  const parsed = (value ?? "")
    .split(",")
    .map(extension => extension.trim().toLowerCase())
    .filter(extension =>
      (KNOWLEDGE_EXTENSION_WHITELIST as readonly string[]).includes(extension)
    );
  return Array.from(new Set(parsed));
}

export async function getKnowledgeSettings(pool: Pool | null) {
  if (!pool) {
    return {
      allowedExtensions: [...KNOWLEDGE_EXTENSION_WHITELIST],
      maxSizeMb: KNOWLEDGE_DEFAULT_MAX_SIZE_MB,
    } satisfies KnowledgeSettings;
  }
  const result = await pool.query(
    `SELECT setting_key,setting_value FROM integration_settings WHERE provider=$1`,
    [KNOWLEDGE_PROVIDER]
  );
  const values = new Map(
    result.rows.map(
      (row: { setting_key: string; setting_value: string | null }) => [
        row.setting_key,
        row.setting_value,
      ]
    )
  );
  const parsedExtensions = normalizeExtensions(
    values.get(SETTING_ALLOWED_EXTENSIONS) ?? null
  );
  const parsedSize = Number(values.get(SETTING_MAX_SIZE_MB) ?? NaN);
  return {
    allowedExtensions:
      parsedExtensions.length > 0
        ? parsedExtensions
        : [...KNOWLEDGE_EXTENSION_WHITELIST],
    maxSizeMb:
      Number.isFinite(parsedSize) &&
      parsedSize >= KNOWLEDGE_MIN_SIZE_MB &&
      parsedSize <= KNOWLEDGE_MAX_SIZE_MB
        ? Math.round(parsedSize)
        : KNOWLEDGE_DEFAULT_MAX_SIZE_MB,
  } satisfies KnowledgeSettings;
}

export async function saveKnowledgeSettings(
  pool: Pool,
  input: { allowedExtensions: string[]; maxSizeMb: number },
  actorUserId: number
) {
  const extensions = normalizeExtensions(input.allowedExtensions.join(","));
  if (!extensions.length) {
    throw new Error(
      "Seleccione al menos una extensión permitida para el conocimiento de proyectos."
    );
  }
  const size = Math.round(input.maxSizeMb);
  if (
    !Number.isFinite(size) ||
    size < KNOWLEDGE_MIN_SIZE_MB ||
    size > KNOWLEDGE_MAX_SIZE_MB
  ) {
    throw new Error(
      `El peso máximo debe estar entre ${KNOWLEDGE_MIN_SIZE_MB} y ${KNOWLEDGE_MAX_SIZE_MB} MB.`
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of [
      [SETTING_ALLOWED_EXTENSIONS, extensions.join(",")],
      [SETTING_MAX_SIZE_MB, String(size)],
    ] as const) {
      await client.query(
        `INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at)
         VALUES ($1,$2,$3,false,now())
         ON CONFLICT (provider,setting_key)
         DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()`,
        [KNOWLEDGE_PROVIDER, key, value]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'integration_setting',0,'knowledge_settings_updated',$2::jsonb)`,
      [actorUserId, JSON.stringify({ extensions, maxSizeMb: size })]
    );
    await client.query("COMMIT");
    return getKnowledgeSettings(pool);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function knowledgeStorageDirectory() {
  return path.resolve(
    process.env.KNOWLEDGE_STORAGE_DIR ??
      path.join(process.cwd(), "data", "knowledge-files")
  );
}

const STORAGE_KEY_PATTERN = /^[0-9]+\/[a-f0-9-]{12,64}\.[A-Za-z0-9]{1,8}$/;

export function knowledgeFilePath(storageKey: string) {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error("La referencia de almacenamiento no es válida.");
  }
  return path.join(knowledgeStorageDirectory(), ...storageKey.split("/"));
}

export function buildStorageKey(projectId: number, extension: string) {
  return `${projectId}/${randomUUID()}.${extension || "bin"}`;
}

function resolveStoredPath(storageKey: string) {
  return knowledgeFilePath(storageKey);
}

export async function writeKnowledgeFile(
  storageKey: string,
  data: Buffer
) {
  const target = resolveStoredPath(storageKey);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, data);
  return target;
}

export function readKnowledgeFile(storageKey: string) {
  return fs.promises.readFile(resolveStoredPath(storageKey));
}

export async function removeKnowledgeFile(storageKey: string) {
  await fs.promises.rm(resolveStoredPath(storageKey), { force: true });
}

export function knowledgeFileStats(storageKey: string) {
  return fs.promises.stat(resolveStoredPath(storageKey));
}

export function knowledgeFileSha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function extractPdfText(data: Buffer) {
  try {
    const parser = new PDFParse({ data: new Uint8Array(data) });
    const result = (await parser.getText()) as { text?: string } | string;
    const text = typeof result === "string" ? result : (result?.text ?? "");
    return text.trim();
  } catch (error) {
    console.warn(
      `[Knowledge] PDF text extraction failed (${error instanceof Error ? error.name : "unknown"}).`
    );
    return "";
  }
}

async function extractDocxText(data: Buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer: data });
    return result.value.trim();
  } catch (error) {
    console.warn(
      `[Knowledge] Word text extraction failed (${error instanceof Error ? error.name : "unknown"}).`
    );
    return "";
  }
}

export async function extractKnowledgeText(
  storageKey: string,
  extension: string
) {
  const data = await readKnowledgeFile(storageKey);
  const raw =
    extension === "pdf"
      ? await extractPdfText(data)
      : extension === "docx"
        ? await extractDocxText(data)
        : "";
  return raw.slice(0, EXTRACTED_TEXT_LIMIT);
}

export async function renderDocxHtml(storageKey: string) {
  const data = await readKnowledgeFile(storageKey);
  const result = await mammoth.convertToHtml({ buffer: data });
  return result.value;
}

export async function renderCsvPreview(storageKey: string) {
  const data = await readKnowledgeFile(storageKey);
  return data
    .toString("utf8")
    .split(/\r?\n/)
    .slice(0, 100)
    .join("\n");
}

const KnowledgeAnalysisSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(1_600)
    .refine(
      value => countWords(value) <= KNOWLEDGE_SUMMARY_WORD_LIMIT,
      `El resumen debe tener como máximo ${KNOWLEDGE_SUMMARY_WORD_LIMIT} palabras.`
    ),
  deepAnalysis: z
    .string()
    .min(1)
    .max(8_000)
    .refine(
      value => countWords(value) <= KNOWLEDGE_ANALYSIS_WORD_LIMIT,
      `El análisis profundo debe tener como máximo ${KNOWLEDGE_ANALYSIS_WORD_LIMIT} palabras.`
    ),
});

export type KnowledgeAnalysisResult = {
  summary: string;
  deepAnalysis: string;
  model: typeof KNOWLEDGE_ANALYSIS_MODEL;
  keySlot: "primary" | "backup";
};

const ANALYSIS_INSTRUCTIONS = `Usted es el analista institucional de la base de conocimiento de proyectos de Talento AISA.

Redacte en español estándar, formal y profesional conforme a la RAE/ASALE, con tratamiento «usted».

Reglas obligatorias:
- Conserve hechos, cifras, nombres propios, condiciones y procedimientos del documento original.
- No invente contenido que no esté en el documento; ante ausencia de información, indíquelo como brecha.
- summary: resumen ejecutivo del documento con un máximo de ${KNOWLEDGE_SUMMARY_WORD_LIMIT} palabras.
- deepAnalysis: análisis profundo con un máximo de ${KNOWLEDGE_ANALYSIS_WORD_LIMIT} palabras que explique en qué consiste el documento, su propósito, alcance, responsables y reglas clave; este texto alimenta al Agente de IA como base de conocimiento.
- No agregue comentarios, viñetas de encabezado ni saltos de línea innecesarios dentro de cada campo.`;

export async function analyzeKnowledgeDocument(
  pool: Pool,
  fileId: number,
  sourceText: string
): Promise<KnowledgeAnalysisResult> {
  const settings = await getAgentRuntimeSettings(pool);
  if (!settings.useResponsesApi) {
    throw new Error(
      "La OpenAI Responses API debe estar habilitada para analizar documentos."
    );
  }
  const keyOptions = [
    ["primary", settings.secrets.openai_api_key],
    ["backup", settings.secrets.openai_api_key_backup],
  ] as const;
  const configuredKeys = keyOptions.filter(option => Boolean(option[1]));
  if (!configuredKeys.length) {
    throw new Error(
      "Configure y verifique una API Key de OpenAI antes de analizar documentos."
    );
  }
  for (
    let attemptIndex = 0;
    attemptIndex < configuredKeys.length;
    attemptIndex += 1
  ) {
    const [keySlot, apiKey] = configuredKeys[attemptIndex]!;
    try {
      const client = observeOpenAIClient(
        new OpenAI({ apiKey: apiKey!, timeout: 60_000, maxRetries: 0 }),
        {
          traceName: "knowledge-document-analysis",
          tags: ["knowledge", "rag", "responses-api"],
          generationName: `knowledge-analysis-${keySlot}`,
          generationMetadata: {
            feature: "project-knowledge-rag",
            keySlot,
            attempt: attemptIndex + 1,
            version: APP_VERSION,
            fileId,
            classification: "restricted-redacted",
          },
        }
      );
      const response = await client.responses.parse({
        model: KNOWLEDGE_ANALYSIS_MODEL,
        instructions: ANALYSIS_INSTRUCTIONS,
        input: `Documento (${fileId}):\n\n${sourceText}`,
        text: {
          format: zodTextFormat(
            KnowledgeAnalysisSchema,
            "analisis_documento_conocimiento"
          ),
        },
        max_output_tokens: 12_000,
        store: false,
      });
      if (!response.output_parsed) {
        throw new Error("El análisis del documento está vacío.");
      }
      return {
        summary: limitWords(response.output_parsed.summary, 66),
        deepAnalysis: limitWords(response.output_parsed.deepAnalysis, 325),
        model: KNOWLEDGE_ANALYSIS_MODEL,
        keySlot,
      };
    } catch (error) {
      console.warn(
        `[Knowledge] OpenAI ${keySlot} analysis failed (${error instanceof Error ? error.name : "unknown"}).`
      );
    }
  }
  throw new Error(
    "No fue posible analizar el documento con OpenAI. Verifique las credenciales e inténtelo de nuevo."
  );
}
