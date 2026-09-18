import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agentSettings", () => ({
  getAgentRuntimeSettings: vi.fn(),
}));
vi.mock("./knowledgeContext", () => ({
  loadPositionKnowledgeContext: vi.fn(),
}));

import { getAgentRuntimeSettings } from "./agentSettings";
import { loadPositionKnowledgeContext } from "./knowledgeContext";
import {
  RECRUITER_AGENT_MODELS,
  askRecruiterAgent,
  buildRecruiterInstructions,
  effectiveRecruiterModel,
  isRecruiterAgentModel,
  setRecruiterThreadModel,
} from "./recruiterAgent";

const candidate = {
  applicationId: 5,
  candidateName: "Byron Muñoz",
  positionTitle: "Ejecutivo de Negocios (Ventas)",
  status: "en_revision",
  profileSummary: "Candidato con experiencia comercial extensa.",
  score: 58,
  documents: [
    {
      name: "CV.pdf",
      status: "analizado",
      essence: "Quince años en ventas de equipo eléctrico.",
      summary: null,
    },
  ],
};

function fakePool(options: { messages?: unknown[] } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const text = String(sql);
    calls.push({ sql: text, values });
    if (text.includes("SELECT id,model FROM recruiter_agent_threads"))
      return { rows: [{ id: 7, model: null }] };
    if (text.includes("SELECT job_position_id FROM applications"))
      return { rows: [{ job_position_id: 3 }] };
    if (text.includes("FROM applications a")) return { rows: [candidate] };
    if (text.includes("FROM candidate_knowledge_files"))
      return { rows: [candidate.documents[0]] };
    if (text.includes("FROM recruiter_agent_threads t"))
      return { rows: options.messages ?? [] };
    return { rows: [] };
  });
  return { pool: { query } as never, calls, query };
}

function auditedBodies(calls: Array<{ sql: string; values: unknown[] }>) {
  return calls
    .filter(call => call.sql.includes("INSERT INTO recruiter_agent_messages"))
    .map(call => ({
      author: String(call.values[1]),
      keySource: call.values[4] === null ? null : String(call.values[4]),
      body: String(call.values[5]),
    }));
}

describe("catálogo de modelos del agente", () => {
  it("acota la elección: el catálogo manda y el institucional decide", () => {
    expect(isRecruiterAgentModel(RECRUITER_AGENT_MODELS[0])).toBe(true);
    expect(isRecruiterAgentModel("modelo-inventado")).toBe(false);
    expect(
      effectiveRecruiterModel({
        conversationModel: RECRUITER_AGENT_MODELS[1],
        institutionalModel: "gpt-5-mini",
      })
    ).toBe(RECRUITER_AGENT_MODELS[1]);
    // Un modelo no declarado no se usa: se cae al institucional.
    expect(
      effectiveRecruiterModel({
        conversationModel: "modelo-inventado",
        institutionalModel: "gpt-5-mini",
      })
    ).toBe("gpt-5-mini");
    expect(
      effectiveRecruiterModel({
        conversationModel: null,
        institutionalModel: "gpt-5-mini",
      })
    ).toBe("gpt-5-mini");
  });

  it("rechaza fijar un modelo fuera del catálogo", async () => {
    const { pool } = fakePool();
    const outcome = await setRecruiterThreadModel(pool, {
      applicationId: 5,
      model: "modelo-inventado",
      actorUserId: 1,
    });
    expect(outcome.ok).toBe(false);
  });
});

describe("instrucciones del agente", () => {
  const instructions = buildRecruiterInstructions({
    candidate,
    institutionalInstructions: "Metodología institucional de evaluación.",
    positionKnowledge: "Conocimiento de la plaza.",
  });

  it("conoce solo al candidato y declara su expediente", () => {
    expect(instructions).toContain("Byron Muñoz");
    expect(instructions).toContain("Ejecutivo de Negocios (Ventas)");
    expect(instructions).toContain("CV.pdf");
    expect(instructions).toContain("Quince años en ventas");
  });

  it("está bajo el régimen de gobernanza y no modifica nada", () => {
    expect(instructions).toContain("Metodología institucional de evaluación.");
    expect(instructions).toContain("no cambia estados");
    expect(instructions).toContain("no propone modificaciones a la interfaz");
    expect(instructions).toContain("Conocimiento de la plaza.");
  });

  it("prohíbe inventar y exige declarar el vacío", () => {
    expect(instructions).toContain("No se inventa experiencia");
    expect(instructions).toContain("el expediente no lo registra");
    // El método de puntuación no se revela.
    expect(instructions).toContain("Nunca se revela el método de puntuación");
  });

  it("declara la ausencia de documentos sin adornarla", () => {
    const withoutDocuments = buildRecruiterInstructions({
      candidate: { ...candidate, documents: [] },
      institutionalInstructions: "",
      positionKnowledge: "",
    });
    expect(withoutDocuments).toContain("Sin documentos analizados");
    expect(withoutDocuments).toContain("Sin instrucción institucional");
  });
});

describe("respuesta del agente con resiliencia DORA", () => {
  beforeEach(() => {
    vi.mocked(getAgentRuntimeSettings).mockResolvedValue({
      model: "gpt-5-mini",
      instructions: "Metodología institucional.",
      secrets: {
        openai_api_key: "clave-principal",
        openai_api_key_backup: "clave-respaldo",
      },
    } as never);
    vi.mocked(loadPositionKnowledgeContext).mockResolvedValue({
      rendered: "Conocimiento de la plaza.",
    } as never);
  });

  it("responde con la credencial principal y lo declara", async () => {
    const { pool, calls } = fakePool();
    const generator = vi.fn(async () => "El candidato declara quince años.");
    const outcome = await askRecruiterAgent(pool, {
      applicationId: 5,
      actorUserId: 1,
      question: "¿Tiene experiencia en ventas?",
      dependencies: { generator },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.answer.keySource).toBe("primary");
      expect(outcome.answer.model).toBe("gpt-5-mini");
    }
    const bodies = auditedBodies(calls);
    expect(bodies[0]).toMatchObject({
      author: "reclutador",
      body: "¿Tiene experiencia en ventas?",
    });
    expect(bodies[1]).toMatchObject({ author: "jarvi", keySource: "primary" });
  });

  it("si la principal falla responde con la de respaldo y lo dice", async () => {
    const { pool, calls } = fakePool();
    const generator = vi
      .fn()
      .mockRejectedValueOnce(new Error("proveedor principal no disponible"))
      .mockResolvedValueOnce("Respuesta con la credencial de respaldo.");
    const outcome = await askRecruiterAgent(pool, {
      applicationId: 5,
      actorUserId: 1,
      question: "¿Qué evidencia hay?",
      dependencies: { generator },
    });
    expect(generator).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.answer.keySource).toBe("backup");
    // El asiento declara la procedencia: responder y ocultarlo no es resiliencia.
    expect(auditedBodies(calls)[1]).toMatchObject({ keySource: "backup" });
  });

  it("con ambas credenciales caídas no inventa respuesta", async () => {
    const { pool } = fakePool();
    const generator = vi.fn(async () => {
      throw new Error("proveedor no disponible");
    });
    const outcome = await askRecruiterAgent(pool, {
      applicationId: 5,
      actorUserId: 1,
      question: "¿Qué evidencia hay?",
      dependencies: { generator },
    });
    expect(outcome.ok).toBe(false);
  });

  it("la pregunta se asienta aunque el proveedor falle", async () => {
    const { pool, calls } = fakePool();
    const generator = vi.fn(async () => {
      throw new Error("proveedor no disponible");
    });
    await askRecruiterAgent(pool, {
      applicationId: 5,
      actorUserId: 1,
      question: "¿Cuál es el riesgo?",
      dependencies: { generator },
    });
    expect(auditedBodies(calls)).toHaveLength(1);
    expect(auditedBodies(calls)[0]?.body).toBe("¿Cuál es el riesgo?");
  });

  it("rechaza una pregunta vacía sin llamar al proveedor", async () => {
    const { pool } = fakePool();
    const generator = vi.fn(async () => "no debería llamarse");
    const outcome = await askRecruiterAgent(pool, {
      applicationId: 5,
      actorUserId: 1,
      question: "   ",
      dependencies: { generator },
    });
    expect(outcome.ok).toBe(false);
    expect(generator).not.toHaveBeenCalled();
  });
});
