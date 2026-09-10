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
  normalizePublicCopy,
  normalizeProfileRequirements,
  PROFILE_EDITORIAL_MODEL,
  PUBLIC_COPY_EDITORIAL_POLICY_VERSION,
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
        fields: [],
        lists: [
          {
            key: "requiredRequirements",
            items: ["Licencia de conducir tipo B vigente."],
          },
        ],
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
    expect(PUBLIC_COPY_EDITORIAL_POLICY_VERSION).toBe("2026-09-10.3");
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
        output_parsed: {
          fields: [],
          lists: [
            {
              key: "requiredRequirements",
              items: ["Bachillerato concluido."],
            },
          ],
        },
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
      "Configure y verifique una API Key de OpenAI antes de guardar o publicar textos públicos."
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("corrects every keyed field and recomposes fragmented public lists", async () => {
    getAgentRuntimeSettings.mockResolvedValue({
      useResponsesApi: true,
      secrets: {
        openai_api_key: "primary-secret",
        openai_api_key_backup: null,
      },
    });
    parse.mockResolvedValue({
      output_parsed: {
        fields: [
          {
            key: "title",
            text: "Ejecutivo de Negocios (Ventas)",
          },
          {
            key: "message",
            text: "Hola {{nombre}}.\n\nSu plaza es {{plaza}}.",
          },
        ],
        lists: [
          {
            key: "responsibilities",
            items: [
              "Prospectar nuevos clientes mediante contacto en frío y referidos.",
              "Crear documentos, incluidas presentaciones y hojas de cálculo en Excel.",
            ],
          },
        ],
      },
    });

    await expect(
      normalizePublicCopy({} as never, {
        fields: [
          { key: "title", text: "executivo ventas", style: "title" },
          {
            key: "message",
            text: "Hola {{nombre}}.\n\nSu plaza es {{plaza}}.",
            style: "message",
          },
        ],
        lists: [
          {
            key: "responsibilities",
            items: [
              "Prospectar nuevos clientes (toque frío",
              "referidos)",
              "Crear documentos (presentaciones",
              "Excel)",
            ],
          },
        ],
      })
    ).resolves.toMatchObject({
      fields: {
        title: "Ejecutivo de Negocios (Ventas)",
        message: "Hola {{nombre}}.\n\nSu plaza es {{plaza}}.",
      },
      lists: {
        responsibilities: [
          "Prospectar nuevos clientes mediante contacto en frío y referidos.",
          "Crear documentos, incluidas presentaciones y hojas de cálculo en Excel.",
        ],
      },
    });
  });

  it("fails closed if the model changes keys or protected variables", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    getAgentRuntimeSettings.mockResolvedValue({
      useResponsesApi: true,
      secrets: {
        openai_api_key: "primary-secret",
        openai_api_key_backup: null,
      },
    });
    parse.mockResolvedValue({
      output_parsed: {
        fields: [{ key: "message", text: "Hola, candidato." }],
        lists: [],
      },
    });

    await expect(
      normalizePublicCopy({} as never, {
        fields: [
          {
            key: "message",
            text: "Hola {{nombre}}.",
            style: "message",
          },
        ],
        lists: [],
      })
    ).rejects.toThrow(
      "No fue posible validar editorialmente los textos públicos con OpenAI."
    );
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("rejects fragmented or nominal responsibilities and accepts a corrected backup", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    getAgentRuntimeSettings.mockResolvedValue({
      useResponsesApi: true,
      secrets: {
        openai_api_key: "primary-secret",
        openai_api_key_backup: "backup-secret",
      },
    });
    parse
      .mockResolvedValueOnce({
        output_parsed: {
          fields: [],
          lists: [
            {
              key: "responsibilities",
              items: [
                "Prospectar nuevos clientes (contacto en frío",
                "referidos)",
                "Apoyo a Gerencia de Ventas.",
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        output_parsed: {
          fields: [],
          lists: [
            {
              key: "responsibilities",
              items: [
                "Prospectar nuevos clientes mediante contacto en frío y referidos.",
                "Apoyar a la Gerencia de Ventas.",
              ],
            },
          ],
        },
      });

    await expect(
      normalizePublicCopy({} as never, {
        fields: [],
        lists: [
          {
            key: "responsibilities",
            items: [
              "Prospectar nuevos clientes (contacto en frío",
              "referidos)",
              "Apoyo a Gerencia de Ventas",
            ],
          },
        ],
      })
    ).resolves.toMatchObject({
      keySlot: "backup",
      lists: {
        responsibilities: [
          "Prospectar nuevos clientes mediante contacto en frío y referidos.",
          "Apoyar a la Gerencia de Ventas.",
        ],
      },
    });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("rejects incomplete requirement fragments even when the JSON schema is valid", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    getAgentRuntimeSettings.mockResolvedValue({
      useResponsesApi: true,
      secrets: {
        openai_api_key: "primary-secret",
        openai_api_key_backup: null,
      },
    });
    parse.mockResolvedValue({
      output_parsed: {
        fields: [],
        lists: [
          {
            key: "requiredRequirements",
            items: ["Experiencia en ventas (tecnología", "industrial)"],
          },
        ],
      },
    });

    await expect(
      normalizeProfileRequirements({} as never, [
        "Experiencia en ventas (tecnología",
        "industrial)",
      ])
    ).rejects.toThrow(
      "No fue posible validar editorialmente los textos públicos con OpenAI."
    );
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
