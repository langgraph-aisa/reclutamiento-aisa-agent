import { beforeEach, describe, expect, it, vi } from "vitest";

type ObservationRecord = {
  options: Record<string, unknown>;
  updates: Array<Record<string, unknown>>;
};

const observationRecords = vi.hoisted(() => [] as Array<ObservationRecord>);

vi.mock("../agentSettings", () => ({
  getAgentRuntimeSettings: vi.fn(async () => ({
    audioMaxMb: 5,
    transcriptionModel: "gpt-4o-mini-transcribe",
    ttsModel: "gpt-4o-mini-tts",
    ttsVoice: "coral",
    secrets: {
      openai_api_key: "sk-primary-private-sentinel",
      openai_api_key_backup: "sk-backup-private-sentinel",
    },
  })),
}));

vi.mock("../observability/langfuse", () => ({
  withLangfuseObservation: vi.fn(
    async (
      options: Record<string, unknown>,
      fn: (observation: {
        id: string;
        traceId: string;
        update: (attributes: Record<string, unknown>) => void;
      }) => unknown
    ) => {
      const record: ObservationRecord = { options, updates: [] };
      observationRecords.push(record);
      return fn({
        id: "test-observation",
        traceId: "test-trace",
        update: attributes => record.updates.push(attributes),
      });
    }
  ),
}));

import { synthesizeSpeech, transcribeAudio } from "./voiceTranscription";

beforeEach(() => {
  observationRecords.length = 0;
});

describe("observabilidad de voz sin contenido privado", () => {
  it("registra la rotación y el modelo sin audio, transcripción ni contexto", async () => {
    const privateTranscript = "transcripcion-privada-sentinel";
    const privateContext = "contexto-privado-sentinel";
    const factory = vi.fn((key: string) => ({
      audio: {
        transcriptions: {
          create:
            key === "sk-primary-private-sentinel"
              ? vi.fn(async () => {
                  throw new Error("Fallo primario");
                })
              : vi.fn(async () => ({
                  text: privateTranscript,
                  language: "es",
                })),
        },
        speech: { create: vi.fn() },
      },
    }));

    const result = await transcribeAudio(
      {} as never,
      {
        data: Buffer.from([79, 103, 103, 83]),
        fileName: "private-audio.ogg",
        mimeType: "audio/ogg",
        prompt: privateContext,
      },
      factory as never
    );

    expect(result).toMatchObject({
      text: privateTranscript,
      keySlot: "backup",
      model: "gpt-4o-mini-transcribe",
    });
    const workflow = observationRecords.find(
      item => item.options.name === "voice.transcription.workflow"
    );
    expect(workflow?.updates.at(-1)).toMatchObject({
      metadata: { outcome: "success", keySlot: "backup" },
    });
    expect(
      observationRecords.filter(
        item => item.options.name === "openai.audio.transcription"
      )
    ).toHaveLength(2);
    const serialized = JSON.stringify(observationRecords);
    expect(serialized).not.toContain(privateTranscript);
    expect(serialized).not.toContain(privateContext);
    expect(serialized).not.toContain("sk-primary-private-sentinel");
    expect(serialized).not.toContain("sk-backup-private-sentinel");
  });

  it("mide el audio generado sin registrar el texto ni sus instrucciones", async () => {
    const privateText = "texto-tts-privado-sentinel";
    const privateInstructions = "instrucciones-tts-privadas-sentinel";
    const create = vi.fn(async () => ({
      arrayBuffer: async () => Uint8Array.from([79, 103, 103, 83]).buffer,
    }));

    const result = await synthesizeSpeech(
      {} as never,
      {
        text: privateText,
        instructions: privateInstructions,
        format: "opus",
      },
      (() => ({
        audio: {
          transcriptions: { create: vi.fn() },
          speech: { create },
        },
      })) as never
    );

    expect(result).toMatchObject({
      format: "opus",
      model: "gpt-4o-mini-tts",
      keySlot: "primary",
    });
    const generation = observationRecords.find(
      item => item.options.name === "openai.audio.speech"
    );
    expect(generation?.options).toMatchObject({ asType: "generation" });
    expect(generation?.updates.at(-1)).toMatchObject({
      metadata: { outcome: "success", outputBytes: 4 },
    });
    const serialized = JSON.stringify(observationRecords);
    expect(serialized).not.toContain(privateText);
    expect(serialized).not.toContain(privateInstructions);
  });
});
