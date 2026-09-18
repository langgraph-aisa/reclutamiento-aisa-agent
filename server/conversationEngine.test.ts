import { describe, expect, it } from "vitest";
import {
  buildConversationInstructions,
  buildConversationUserInput,
  conversationStageForTurn,
  evidenceIsLiteral,
  deniesReceivedAttachments,
} from "./conversationEngine";
import {
  buildConversationContext,
  type ConversationContextSource,
} from "./conversationContext";
import { POSITION_KNOWLEDGE_FALLBACK } from "./knowledgeContext";

const baseSource: ConversationContextSource = {
  applicationId: 12,
  position: {
    id: 4,
    title: "Auxiliar Administrativo-Contable",
    locationLabel: "Zona 4, Ciudad de Guatemala",
    description: null,
  },
  profile: { name: "Auxiliar Administrativo-Contable" },
  answers: [],
  salary: { expectationGtq: 0, source: "no_declarada", declared: false },
  declaredLocation: {
    zone: null,
    municipality: null,
    department: null,
    country: null,
  },
  knowledge: {
    positionId: 4,
    available: false,
    degraded: false,
    projects: [],
    provenance: [],
    fileCount: 0,
    characters: 0,
    fingerprint: "b".repeat(64),
    rendered: POSITION_KNOWLEDGE_FALLBACK,
  },
  methodologies: [],
  notes: [],
  cycles: [],
  summary: null,
  turns: [],
  attachments: [],
  lastInboundAt: null,
};

describe("motor conversacional: contrato verificable", () => {
  it("impide negar un adjunto registrado aunque su extracción haya fallado", () => {
    const source = {
      attachments: [
        { originalName: "cv.pdf", category: "unclassified", status: "error" },
      ],
    };
    expect(
      deniesReceivedAttachments("No aparece adjunto el PDF en el chat.", source)
    ).toBe(true);
    expect(
      deniesReceivedAttachments(
        "En el expediente no aparecen documentos adjuntos.",
        source
      )
    ).toBe(true);
    expect(
      deniesReceivedAttachments(
        "El archivo fue recibido y su lectura requiere revisión.",
        source
      )
    ).toBe(false);
  });
  it("no acepta como nota de conocimiento una evidencia que no es literal", () => {
    expect(
      evidenceIsLiteral(
        "cuenta con licencia tipo A",
        "Sí, cuenta con licencia tipo A vigente"
      )
    ).toBe(true);
    expect(
      evidenceIsLiteral(
        "cuenta con licencia tipo B",
        "Sí, cuenta con licencia tipo A vigente"
      )
    ).toBe(false);
    expect(evidenceIsLiteral("corto", "corto")).toBe(false);
  });

  it("avanza de etapa según los turnos y los ciclos abiertos", () => {
    expect(conversationStageForTurn(0, 0)).toBe("apertura");
    expect(conversationStageForTurn(1, 2)).toBe("descubrimiento");
    expect(conversationStageForTurn(3, 1)).toBe("confirmacion");
    expect(conversationStageForTurn(2, 0)).toBe("cierre");
  });

  it("inyecta la conducta, la política salarial y el expediente en las instrucciones", () => {
    const context = buildConversationContext(
      baseSource,
      new Date("2026-09-16")
    );
    const instructions = buildConversationInstructions(
      baseSource,
      context,
      [
        {
          kind: "unknown_required",
          dimension: "disponibilidad_logistica",
          reason: "La ubicación declarada está incompleta.",
          suggestion: "¿En qué zona reside actualmente?",
          askable: true,
          evidence: null,
        },
      ],
      "apertura"
    );
    expect(instructions).toContain(
      "Conducta institucional del agente conversacional"
    );
    expect(instructions).toContain("REGLA INALTERABLE DE REMUNERACIÓN");
    expect(instructions).toContain("EXPEDIENTE Y CONTEXTO VIGENTE");
    expect(instructions).toContain("¿En qué zona reside actualmente?");
    expect(buildConversationUserInput(baseSource, "Hola")).toContain(
      "Mensaje más reciente de la persona: Hola"
    );
  });
});
