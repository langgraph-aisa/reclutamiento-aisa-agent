import OpenAI, { toFile } from "openai";
import type { Pool } from "pg";
import {
  OPENAI_SPEECH_FORMATS,
  OPENAI_TRANSCRIPTION_EXTENSIONS,
  type OpenAiTtsVoice,
} from "../../shared/agentConfig";
import { getAgentRuntimeSettings } from "../agentSettings";
import { withLangfuseObservation } from "../observability/langfuse";

export type TranscribeOptions = {
  data: Buffer | Uint8Array;
  fileName: string;
  mimeType: string;
  language?: string;
  prompt?: string;
};

export type TranscriptionResponse = {
  text: string;
  model: string;
  keySlot: "primary" | "backup";
  language: string | null;
};

export type SpeechOptions = {
  text: string;
  format?: (typeof OPENAI_SPEECH_FORMATS)[number];
  voice?: OpenAiTtsVoice;
  instructions?: string;
};

export type SpeechResponse = {
  data: Buffer;
  mimeType: string;
  format: (typeof OPENAI_SPEECH_FORMATS)[number];
  model: string;
  keySlot: "primary" | "backup";
};

type AudioClient = Pick<OpenAI, "audio">;
type AudioClientFactory = (apiKey: string) => AudioClient;

const mimeExtension: Record<string, string> = {
  "audio/flac": "flac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "video/mp4": "mp4",
};

const outputMime: Record<(typeof OPENAI_SPEECH_FORMATS)[number], string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/L16",
};

function clientFactory(apiKey: string): AudioClient {
  return new OpenAI({ apiKey, maxRetries: 0, timeout: 30_000 });
}

function normalizedExtension(fileName: string, mimeType: string) {
  const fromName = fileName.split(".").pop()?.toLowerCase().trim();
  const extension =
    fromName && OPENAI_TRANSCRIPTION_EXTENSIONS.includes(fromName as never)
      ? fromName
      : mimeExtension[mimeType.toLowerCase().split(";", 1)[0]];
  if (
    !extension ||
    !OPENAI_TRANSCRIPTION_EXTENSIONS.includes(extension as never)
  ) {
    throw new Error("El formato de audio no está admitido para transcripción.");
  }
  return extension;
}

function assertSize(data: Buffer | Uint8Array, maximumMb: number) {
  const maximumBytes = maximumMb * 1024 * 1024;
  if (data.byteLength === 0) throw new Error("El archivo de audio está vacío.");
  if (data.byteLength > maximumBytes) {
    throw new Error(
      `El archivo de audio supera la cuota configurada de ${maximumMb} MB.`
    );
  }
}

async function withKeyRotation<T>(
  pool: Pool,
  operation: (
    client: AudioClient,
    slot: "primary" | "backup",
    settings: Awaited<ReturnType<typeof getAgentRuntimeSettings>>
  ) => Promise<T>,
  factory: AudioClientFactory
) {
  const settings = await getAgentRuntimeSettings(pool);
  const keys = [
    ["primary", settings.secrets.openai_api_key],
    ["backup", settings.secrets.openai_api_key_backup],
  ] as const;
  let lastError: unknown;
  for (const [slot, apiKey] of keys) {
    if (!apiKey) continue;
    try {
      return await operation(factory(apiKey), slot, settings);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error("No hay una API key de OpenAI configurada.");
}

export async function transcribeAudio(
  pool: Pool,
  options: TranscribeOptions,
  factory: AudioClientFactory = clientFactory
): Promise<TranscriptionResponse> {
  return withLangfuseObservation(
    {
      name: "voice.transcription.workflow",
      asType: "chain",
      traceName: "voice-transcription",
      tags: ["voice", "openai"],
      metadata: {
        operation: "transcribe",
        inputBytes: options.data.byteLength,
        languageSupplied: Boolean(options.language?.trim()),
        contextHintSupplied: Boolean(options.prompt?.trim()),
      },
    },
    async workflow => {
      const response = await withKeyRotation(
        pool,
        async (client, keySlot, settings) => {
          assertSize(options.data, settings.audioMaxMb);
          const extension = normalizedExtension(
            options.fileName,
            options.mimeType
          );
          return withLangfuseObservation(
            {
              name: "openai.audio.transcription",
              asType: "generation",
              metadata: {
                provider: "openai",
                operation: "transcribe",
                model: settings.transcriptionModel,
                keySlot,
                format: extension,
                inputBytes: options.data.byteLength,
              },
            },
            async generation => {
              const file = await toFile(
                Buffer.from(options.data),
                `audio.${extension}`,
                { type: options.mimeType }
              );
              const result = await client.audio.transcriptions.create({
                file,
                model: settings.transcriptionModel,
                language: options.language?.trim().slice(0, 8) || "es",
                prompt: options.prompt?.trim().slice(0, 500),
                temperature: 0,
              });
              if (!result.text?.trim()) {
                throw new Error("OpenAI devolvió una transcripción vacía.");
              }
              const language =
                "language" in result && typeof result.language === "string"
                  ? result.language
                  : null;
              generation.update({
                model: settings.transcriptionModel,
                output: { status: "completed" },
                metadata: {
                  outcome: "success",
                  keySlot,
                  locale: language ?? "unknown",
                },
              });
              return {
                text: result.text.trim(),
                model: settings.transcriptionModel,
                keySlot,
                language,
              };
            }
          );
        },
        factory
      );
      workflow.update({
        output: { status: "completed" },
        metadata: {
          outcome: "success",
          model: response.model,
          keySlot: response.keySlot,
        },
      });
      return response;
    }
  );
}

export async function synthesizeSpeech(
  pool: Pool,
  options: SpeechOptions,
  factory: AudioClientFactory = clientFactory
): Promise<SpeechResponse> {
  const text = options.text.trim();
  if (!text) throw new Error("El texto para voz está vacío.");
  if (text.length > 4_096) {
    throw new Error("El texto para voz supera el límite de 4,096 caracteres.");
  }
  const format = options.format ?? "mp3";
  if (!OPENAI_SPEECH_FORMATS.includes(format)) {
    throw new Error("El formato de salida de voz no está admitido.");
  }
  return withLangfuseObservation(
    {
      name: "voice.synthesis.workflow",
      asType: "chain",
      traceName: "voice-synthesis",
      tags: ["voice", "openai"],
      metadata: {
        operation: "synthesize",
        textCharacters: text.length,
        format,
        styleDirectiveSupplied: Boolean(options.instructions?.trim()),
      },
    },
    async workflow => {
      const result = await withKeyRotation(
        pool,
        async (client, keySlot, settings) =>
          withLangfuseObservation(
            {
              name: "openai.audio.speech",
              asType: "generation",
              metadata: {
                provider: "openai",
                operation: "synthesize",
                model: settings.ttsModel,
                keySlot,
                format,
                textCharacters: text.length,
              },
            },
            async generation => {
              const response = await client.audio.speech.create({
                input: text,
                model: settings.ttsModel,
                voice: options.voice ?? settings.ttsVoice,
                response_format: format,
                instructions: options.instructions?.trim().slice(0, 500),
              });
              const data = Buffer.from(await response.arrayBuffer());
              if (!data.byteLength)
                throw new Error("OpenAI devolvió un audio vacío.");
              generation.update({
                model: settings.ttsModel,
                output: { status: "completed" },
                metadata: {
                  outcome: "success",
                  outputBytes: data.byteLength,
                  format,
                  keySlot,
                },
              });
              return {
                data,
                mimeType: outputMime[format],
                format,
                model: settings.ttsModel,
                keySlot,
              };
            }
          ),
        factory
      );
      workflow.update({
        output: { status: "completed" },
        metadata: {
          outcome: "success",
          model: result.model,
          keySlot: result.keySlot,
          outputBytes: result.data.byteLength,
        },
      });
      return result;
    }
  );
}
