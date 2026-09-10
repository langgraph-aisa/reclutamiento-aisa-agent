import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructorOptions, getAgentRuntimeSettings, parse } = vi.hoisted(
  () => ({
    constructorOptions: [] as Array<Record<string, unknown>>,
    getAgentRuntimeSettings: vi.fn(),
    parse: vi.fn(),
  })
);

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { parse };

    constructor(options: Record<string, unknown>) {
      constructorOptions.push(options);
    }
  },
}));

vi.mock("./agentSettings", () => ({ getAgentRuntimeSettings }));

import {
  compactRequirements,
  normalizeProfileRequirements,
  PROFILE_EDITORIAL_MODEL,
} from "./profileEditorial";

beforeEach(() => {
  constructorOptions.length = 0;
  vi.clearAllMocks();
});

describe("profile requirement editorial validation", () => {
  it("removes visual bullets, internal line breaks, and duplicates", () => {
    expect(
      compactRequirements([
        "• Licencia de conducir tipo B\n vigente.",
        "Licencia de conducir tipo B vigente.",
        "  2) Cinco años de experiencia.  ",
      ])
    ).toEqual([
      "Licencia de conducir tipo B vigente.",
      "Cinco años de experiencia.",
    ]);
  });

  it("uses GPT-4.1 mini, structured output, and no response storage", async () => {
    getAgentRuntimeSettings.mockResolvedValue({
      useResponsesApi: true,
      secrets: {
        openai_api_key: "primary-secret",
        openai_api_key_backup: null,
      },
    });
    parse.mockResolvedValue({
      output_parsed: {
        requirements: ["Licencia de conducir tipo B vigente."],
      },
    });

    await expect(
      normalizeProfileRequirements({} as never, ["licensia tipo B"])
    ).resolves.toEqual({
      requirements: ["Licencia de conducir tipo B vigente."],
      model: PROFILE_EDITORIAL_MODEL,
      keySlot: "primary",
    });

    expect(PROFILE_EDITORIAL_MODEL).toBe("gpt-4.1-mini-2025-04-14");
    expect(constructorOptions[0]).toMatchObject({
      apiKey: "primary-secret",
      maxRetries: 0,
    });
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: PROFILE_EDITORIAL_MODEL,
        store: false,
        text: { format: expect.anything() },
      })
    );
  });

  it("rotates to the backup key without exposing either credential", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    getAgentRuntimeSettings.mockResolvedValue({
      useResponsesApi: true,
      secrets: {
        openai_api_key: "primary-secret",
        openai_api_key_backup: "backup-secret",
      },
    });
    parse
      .mockRejectedValueOnce(new Error("Unauthorized: primary-secret"))
      .mockResolvedValueOnce({
        output_parsed: { requirements: ["Bachillerato concluido."] },
      });

    await expect(
      normalizeProfileRequirements({} as never, ["bachillerato concluido"])
    ).resolves.toMatchObject({ keySlot: "backup" });

    expect(constructorOptions.map(options => options.apiKey)).toEqual([
      "primary-secret",
      "backup-secret",
    ]);
    expect(warning.mock.calls.flat().join(" ")).not.toMatch(
      /primary-secret|backup-secret/
    );
    warning.mockRestore();
  });

  it("fails closed when no OpenAI credential is configured", async () => {
    getAgentRuntimeSettings.mockResolvedValue({
      useResponsesApi: true,
      secrets: { openai_api_key: null, openai_api_key_backup: null },
    });

    await expect(
      normalizeProfileRequirements({} as never, ["Experiencia comercial"])
    ).rejects.toThrow(
      "Configure y verifique una API Key de OpenAI antes de guardar o publicar requisitos del puesto."
    );
    expect(parse).not.toHaveBeenCalled();
  });
});
