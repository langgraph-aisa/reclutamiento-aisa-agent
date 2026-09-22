import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { constructorOptions, create, parse } = vi.hoisted(() => ({
  constructorOptions: [] as Array<Record<string, unknown>>,
  create: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { parse };
    chat = { completions: { create } };

    constructor(options: Record<string, unknown>) {
      constructorOptions.push(options);
    }
  },
}));

import {
  buildResilientChain,
  openAiCompatibleClient,
  structuredModelFor,
  structuredOutput,
} from "./agentProviders";

const SampleSchema = z.object({ value: z.string() });

function runtimeSettings(input: {
  primaryProvider: "openai" | "deepseek";
  openai?: string | null;
  openaiBackup?: string | null;
  deepseek?: string | null;
  deepseekBackup?: string | null;
}) {
  return {
    primaryProvider: input.primaryProvider,
    deepseekModel: "deepseek-chat",
    secrets: {
      openai_api_key: input.openai ?? null,
      openai_api_key_backup: input.openaiBackup ?? null,
      deepseek_api_key: input.deepseek ?? null,
      deepseek_api_key_backup: input.deepseekBackup ?? null,
    },
  };
}

describe("cadena resiliente de proveedores", () => {
  it("ordena OpenAI primero cuando es el proveedor activo", () => {
    const chain = buildResilientChain(
      runtimeSettings({
        primaryProvider: "openai",
        openai: "sk-openai",
        openaiBackup: "sk-openai-b",
        deepseek: "sk-deepseek",
        deepseekBackup: "sk-deepseek-b",
      })
    );
    expect(chain).toEqual([
      { provider: "openai", slot: "primary", apiKey: "sk-openai" },
      { provider: "openai", slot: "backup", apiKey: "sk-openai-b" },
      { provider: "deepseek", slot: "primary", apiKey: "sk-deepseek" },
      { provider: "deepseek", slot: "backup", apiKey: "sk-deepseek-b" },
    ]);
  });

  it("ordena DeepSeek primero cuando es el proveedor activo", () => {
    const chain = buildResilientChain(
      runtimeSettings({
        primaryProvider: "deepseek",
        openai: "sk-openai",
        openaiBackup: null,
        deepseek: "sk-deepseek",
        deepseekBackup: "sk-deepseek-b",
      })
    );
    expect(chain).toEqual([
      { provider: "deepseek", slot: "primary", apiKey: "sk-deepseek" },
      { provider: "deepseek", slot: "backup", apiKey: "sk-deepseek-b" },
      { provider: "openai", slot: "primary", apiKey: "sk-openai" },
    ]);
  });

  it("excluye las credenciales ausentes sin alterar el orden", () => {
    const chain = buildResilientChain(
      runtimeSettings({
        primaryProvider: "openai",
        openai: null,
        openaiBackup: "sk-openai-b",
        deepseek: null,
        deepseekBackup: "sk-deepseek-b",
      })
    );
    expect(chain).toEqual([
      { provider: "openai", slot: "backup", apiKey: "sk-openai-b" },
      { provider: "deepseek", slot: "backup", apiKey: "sk-deepseek-b" },
    ]);
  });
});

describe("cliente compatible con el proveedor", () => {
  it("usa la base de DeepSeek para el proveedor deepseek", () => {
    constructorOptions.length = 0;
    openAiCompatibleClient(
      { provider: "deepseek", slot: "primary", apiKey: "sk-deepseek" },
      { timeout: 45_000, maxRetries: 0 }
    );
    expect(constructorOptions[0]).toMatchObject({
      apiKey: "sk-deepseek",
      baseURL: "https://api.deepseek.com",
      timeout: 45_000,
      maxRetries: 0,
    });
  });

  it("no fija base para OpenAI", () => {
    constructorOptions.length = 0;
    openAiCompatibleClient(
      { provider: "openai", slot: "primary", apiKey: "sk-openai" }
    );
    expect(constructorOptions[0]).toMatchObject({ apiKey: "sk-openai" });
    expect(constructorOptions[0].baseURL).toBeUndefined();
  });
});

describe("modelo efectivo de salida estructurada", () => {
  it("ancla DeepSeek a deepseek-chat", () => {
    expect(structuredModelFor("deepseek", "deepseek-reasoner")).toBe(
      "deepseek-chat"
    );
    expect(structuredModelFor("openai", "gpt-5-mini")).toBe("gpt-5-mini");
  });
});

describe("salida estructurada neutra al proveedor", () => {
  it("conserva la Responses API para OpenAI", async () => {
    parse.mockResolvedValue({ output_parsed: { value: "confirmado" } });
    const client = openAiCompatibleClient({
      provider: "openai",
      slot: "primary",
      apiKey: "sk-openai",
    });
    const result = await structuredOutput({
      client,
      provider: "openai",
      model: "gpt-5-mini",
      instructions: "Instrucción institucional.",
      input: "Contenido de entrada.",
      schema: SampleSchema,
      schemaName: "muestra",
      maxOutputTokens: 800,
    });
    expect(result).toEqual({ value: "confirmado" });
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-mini",
        store: false,
        text: { format: expect.anything() },
      })
    );
  });

  it("usa Chat Completions con JSON para DeepSeek y valida con Zod", async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: '{"value":"por deepseek"}' } }],
    });
    const client = openAiCompatibleClient({
      provider: "deepseek",
      slot: "primary",
      apiKey: "sk-deepseek",
    });
    const result = await structuredOutput({
      client,
      provider: "deepseek",
      model: "deepseek-reasoner",
      instructions: "Instrucción institucional.",
      input: "Contenido de entrada.",
      schema: SampleSchema,
      schemaName: "muestra",
      maxOutputTokens: 800,
    });
    expect(result).toEqual({ value: "por deepseek" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-chat",
        response_format: { type: "json_object" },
      })
    );
  });

  it("acepta JSON envuelto en bloques de código", async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: '```json\n{"value":"con cerca"}\n```' } }],
    });
    const client = openAiCompatibleClient({
      provider: "deepseek",
      slot: "primary",
      apiKey: "sk-deepseek",
    });
    await expect(
      structuredOutput({
        client,
        provider: "deepseek",
        model: "deepseek-chat",
        instructions: "Instrucción.",
        input: "Contenido.",
        schema: SampleSchema,
        schemaName: "muestra",
        maxOutputTokens: 800,
      })
    ).resolves.toEqual({ value: "con cerca" });
  });

  it("declara el intento fallido cuando el JSON es inválido", async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: "esto no es JSON" } }],
    });
    const client = openAiCompatibleClient({
      provider: "deepseek",
      slot: "primary",
      apiKey: "sk-deepseek",
    });
    await expect(
      structuredOutput({
        client,
        provider: "deepseek",
        model: "deepseek-chat",
        instructions: "Instrucción.",
        input: "Contenido.",
        schema: SampleSchema,
        schemaName: "muestra",
        maxOutputTokens: 800,
      })
    ).rejects.toThrow("JSON inválido");
  });

  it("rechaza un JSON que no cumple el esquema", async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: '{"otro": true}' } }],
    });
    const client = openAiCompatibleClient({
      provider: "deepseek",
      slot: "primary",
      apiKey: "sk-deepseek",
    });
    await expect(
      structuredOutput({
        client,
        provider: "deepseek",
        model: "deepseek-chat",
        instructions: "Instrucción.",
        input: "Contenido.",
        schema: SampleSchema,
        schemaName: "muestra",
        maxOutputTokens: 800,
      })
    ).rejects.toThrow();
  });
});
