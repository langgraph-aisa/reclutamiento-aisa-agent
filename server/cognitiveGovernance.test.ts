import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_TITLE_WORD_LIMIT,
  DEFAULT_AGENT_SETTINGS,
  OPENAI_API_ENDPOINTS,
  OPENAI_TRANSCRIPTION_EXTENSIONS,
  SALARY_GOVERNANCE_POLICY,
} from "../shared/agentConfig";
import {
  ASSESSMENT_GOVERNANCE_RULES,
  ASSESSMENT_METHODOLOGY_NOTICE,
  missingPsychometricEvidenceTerms,
} from "../shared/assessmentGovernance";
import {
  activityTitle,
  countWords,
  normalizeAdminPath,
} from "../shared/activityAudit";
import {
  assertNoAutomatedSalaryOffer,
  extractExplicitSalaryExpectation,
} from "./salaryPolicy";

vi.mock("./agentSettings", () => ({
  getAgentRuntimeSettings: vi.fn(async () => ({
    ...DEFAULT_AGENT_SETTINGS,
    secrets: {
      openai_api_key: "sk-primary",
      openai_api_key_backup: "sk-backup",
      langfuse_public_key: null,
      langfuse_secret_key: null,
    },
  })),
}));

import {
  synthesizeSpeech,
  transcribeAudio,
} from "./_core/voiceTranscription";

describe("gobierno cognitivo de caja negra", () => {
  it("mantiene 64 criterios únicos sin atribuirles cumplimiento ni validez psicométrica", () => {
    expect(ASSESSMENT_GOVERNANCE_RULES).toHaveLength(64);
    expect(
      new Set(ASSESSMENT_GOVERNANCE_RULES.map(rule => rule.id)).size
    ).toBe(64);
    expect(ASSESSMENT_METHODOLOGY_NOTICE).toContain(
      "no constituyen por sí mismas una prueba psicométrica"
    );
    expect(ASSESSMENT_METHODOLOGY_NOTICE).toContain("confiabilidad");
    expect(ASSESSMENT_METHODOLOGY_NOTICE).toContain("equidad");
    expect(
      missingPsychometricEvidenceTerms(
        "Constructo, validez, confiabilidad, población, equidad, estandarización y aprobación competente."
      )
    ).toEqual([]);
    expect(missingPsychometricEvidenceTerms("Solo validez")).toContain(
      "confiabilidad"
    );
  });

  it("proyecta títulos asertivos de máximo 11 palabras sin fórmulas fijas", () => {
    const title = activityTitle("protocol_saved", "/admin/assessments");
    expect(countWords(title)).toBeLessThanOrEqual(ACTIVITY_TITLE_WORD_LIMIT);
    expect(title).toBe("Protocolo guardado en Pruebas");
    expect(activityTitle("page_opened", "/admin/config")).toBe(
      "Apertura autorizada en Configuración"
    );
    expect(activityTitle("credential_rotated", "/admin/config")).toBe(
      "Credencial rotada en Configuración"
    );
    expect(activityTitle("inbox_message_deleted", "/admin/inbox")).toBe(
      "Mensaje de bandeja eliminado en Bandeja"
    );
    expect(title).not.toMatch(/Control ISO|Talento AISA|hoy|evidencia/i);
    expect(normalizeAdminPath("/admin/forms/25?tab=rules")).toBe(
      "/admin/jobs"
    );
  });

  it("conserva la expectativa en cero sin intención y monto explícitos", () => {
    expect(
      extractExplicitSalaryExpectation(
        "Tengo 15 años de experiencia y administré Q 250,000 en ventas.",
        "message"
      )
    ).toBeNull();
    expect(
      extractExplicitSalaryExpectation(
        "Mi expectativa salarial es de Q 8,500 mensuales.",
        "message"
      )
    ).toEqual({ amountGtq: 8500, source: "message" });
    expect(
      extractExplicitSalaryExpectation(
        "Pretensión de 12000 quetzales.",
        "cv"
      )
    ).toEqual({ amountGtq: 12000, source: "cv" });
    expect(
      extractExplicitSalaryExpectation(
        "Vendí Q 250,000; mi expectativa salarial no está definida.",
        "message"
      )
    ).toBeNull();
    expect(
      extractExplicitSalaryExpectation(
        "Q 7,500 es mi expectativa salarial mensual.",
        "message"
      )
    ).toEqual({ amountGtq: 7500, source: "message" });
  });

  it("bloquea ofertas económicas automáticas con una política inalterable", () => {
    expect(SALARY_GOVERNANCE_POLICY).toContain(
      "el agente de IA no debe ofrecer"
    );
    expect(() =>
      assertNoAutomatedSalaryOffer("Le ofrecemos un salario de Q 9,000.")
    ).toThrow(/bloqueada/);
    expect(() =>
      assertNoAutomatedSalaryOffer(
        "La persona declaró una expectativa salarial de Q 9,000."
      )
    ).not.toThrow();
    expect(() =>
      assertNoAutomatedSalaryOffer("Podemos pagar Q 9,000 mensuales.")
    ).toThrow(/bloqueada/);
  });

  it("mantiene endpoints oficiales cerrados y admite OGG", () => {
    expect(OPENAI_API_ENDPOINTS).toEqual({
      responses: "https://api.openai.com/v1/responses",
      transcriptions: "https://api.openai.com/v1/audio/transcriptions",
      speech: "https://api.openai.com/v1/audio/speech",
    });
    expect(OPENAI_TRANSCRIPTION_EXTENSIONS).toContain("ogg");
  });

  it("mantiene una única migración 0014 registrada y un snapshot coherente", () => {
    const migrationFiles = readdirSync("drizzle/migrations").filter(file =>
      /^0014_.*\.sql$/.test(file)
    );
    const journal = JSON.parse(
      readFileSync("drizzle/migrations/meta/_journal.json", "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> };
    const migration = readFileSync(
      "drizzle/migrations/0014_cognitive_governance.sql",
      "utf8"
    );
    const apiChatMigration = readFileSync(
      "drizzle/migrations/0013_apichat_credential_vault.sql",
      "utf8"
    );
    const snapshotPath = "drizzle/migrations/meta/0014_snapshot.json";
    const snapshot = readFileSync(snapshotPath, "utf8");

    expect(migrationFiles).toEqual(["0014_cognitive_governance.sql"]);
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 14,
      tag: "0014_cognitive_governance",
    });
    expect(existsSync(snapshotPath)).toBe(true);
    expect(migration).not.toMatch(/^\s*(?:BEGIN|COMMIT);/m);
    // 0013 ya es una migración histórica: conservar su contenido evita
    // divergencias de checksum en ambientes que ya la ejecutaron.
    expect(apiChatMigration).toMatch(/^\s*BEGIN;/m);
    expect(apiChatMigration).toMatch(/^\s*COMMIT;/m);
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS agent_user_assignments_agent_key_uq"
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS admin_activity_events_correlation_uq"
    );
    expect(snapshot).toContain("applications_salary_expectation_evidence_ck");
    expect(snapshot).toContain("conversation_messages_provider_idx");
    expect(snapshot).toContain("audit_log_created_idx");
  });

  it("transcribe el límite exacto, rechaza un byte adicional y rota la clave", async () => {
    const transcriptions = vi.fn(async () => ({ text: "Transcripción válida" }));
    const factory = vi.fn((key: string) => ({
      audio: {
        transcriptions: {
          create:
            key === "sk-primary"
              ? vi.fn(async () => {
                  throw new Error("Fallo primario");
                })
              : transcriptions,
        },
        speech: { create: vi.fn() },
      },
    }));
    const accepted = await transcribeAudio(
      {} as never,
      {
        data: Buffer.alloc(5 * 1024 * 1024),
        fileName: "nota.ogg",
        mimeType: "audio/ogg",
      },
      factory as never
    );
    expect(accepted).toMatchObject({
      text: "Transcripción válida",
      model: "gpt-4o-mini-transcribe",
      keySlot: "backup",
    });
    expect(transcriptions).toHaveBeenCalledOnce();
    await expect(
      transcribeAudio(
        {} as never,
        {
          data: Buffer.alloc(5 * 1024 * 1024 + 1),
          fileName: "nota.ogg",
          mimeType: "audio/ogg",
        },
        factory as never
      )
    ).rejects.toThrow(/supera la cuota/);
  });

  it("genera Opus mediante el modelo y la voz configurados", async () => {
    const create = vi.fn(async () => ({
      arrayBuffer: async () => Uint8Array.from([79, 103, 103, 83]).buffer,
    }));
    const result = await synthesizeSpeech(
      {} as never,
      { text: "Mensaje institucional", format: "opus" },
      (() => ({
        audio: {
          transcriptions: { create: vi.fn() },
          speech: { create },
        },
      })) as never
    );
    expect(result).toMatchObject({
      format: "opus",
      mimeType: "audio/ogg",
      model: "gpt-4o-mini-tts",
      keySlot: "primary",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini-tts",
        voice: "coral",
        response_format: "opus",
      })
    );
  });
});
