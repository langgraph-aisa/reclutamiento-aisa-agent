import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  callbackHandler,
  createLangfuseCallbackHandler,
  getAgentRuntimeSettings,
  graphConfigs,
  modelInvoke,
  observationOptions,
  verifyLangfuseConnectionFromDatabase,
  withLangfuseObservation,
} = vi.hoisted(() => {
  const observationOptions: Array<Record<string, unknown>> = [];
  return {
    callbackHandler: { name: "langfuse-test-callback" },
    createLangfuseCallbackHandler: vi.fn(),
    getAgentRuntimeSettings: vi.fn(),
    graphConfigs: [] as Array<Record<string, unknown>>,
    modelInvoke: vi.fn(),
    observationOptions,
    verifyLangfuseConnectionFromDatabase: vi.fn(),
    withLangfuseObservation: vi.fn(
      async <T>(
        options: Record<string, unknown>,
        callback: (observation: {
          id: string;
          traceId: string;
          update: (attributes: Record<string, unknown>) => void;
        }) => Promise<T>
      ) => {
        observationOptions.push(options);
        return callback({
          id: "observation-test",
          traceId: "trace-test",
          update: vi.fn(),
        });
      }
    ),
  };
});

vi.mock("@langchain/core/messages", () => ({
  HumanMessage: class HumanMessage {
    constructor(public content: string) {}
  },
  SystemMessage: class SystemMessage {
    constructor(public content: string) {}
  },
}));

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class ChatOpenAI {
    withStructuredOutput() {
      return { invoke: modelInvoke };
    }
  },
}));

vi.mock("@langchain/langgraph", () => {
  const Annotation = Object.assign(() => ({}), { Root: () => ({}) });
  return {
    Annotation,
    START: "start",
    END: "end",
    StateGraph: class StateGraph {
      private node: (() => Promise<unknown>) | null = null;

      addNode(_name: string, node: () => Promise<unknown>) {
        this.node = node;
        return this;
      }

      addEdge() {
        return this;
      }

      compile() {
        const node = this.node;
        return {
          invoke: async (
            _state: Record<string, unknown>,
            config: Record<string, unknown>
          ) => {
            graphConfigs.push(config);
            if (!node) throw new Error("Nodo de prueba no configurado.");
            return node();
          },
        };
      }
    },
  };
});

vi.mock("./agentSettings", () => ({ getAgentRuntimeSettings }));
vi.mock("./observability/langfuse", () => ({
  createLangfuseCallbackHandler,
  verifyLangfuseConnectionFromDatabase,
  withLangfuseObservation,
}));

import { EVALUATION_BLOCKS } from "../shared/agentConfig";
import {
  evaluateApplicationWithAgent,
  verifyLangfuseConnection,
} from "./agentEvaluator";

function modelOutput() {
  return {
    blocks: EVALUATION_BLOCKS.map(block => ({
      id: block.id,
      score: 80,
      rationale: "Evidencia suficiente.",
    })),
    summary: "Resumen profesional.",
    decisionReason: "Cumple los criterios configurados.",
    evidence: [],
    gaps: [],
    criticalDisqualification: false,
    criticalReason: null,
  };
}

function poolFixture(options?: { hardFail?: boolean }) {
  const lockQuery = vi.fn(async (sql: string) =>
    sql.includes("pg_try_advisory_lock")
      ? { rows: [{ acquired: true }] }
      : { rows: [] }
  );
  const transactionQuery = vi.fn(async () => ({ rows: [] }));
  const connect = vi
    .fn()
    .mockResolvedValueOnce({ query: lockQuery, release: vi.fn() })
    .mockResolvedValueOnce({ query: transactionQuery, release: vi.fn() });
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM applications a")) {
      return {
        rows: [
          {
            id: 41,
            form_id: 8,
            position_id: 5,
            title: "Plaza de prueba confidencial",
            department: "Área confidencial",
            location_label: "Ubicación confidencial",
            description: "Descripción confidencial",
            candidate_zone: "Zona confidencial",
            candidate_department: "Departamento confidencial",
            candidate_municipality: "Municipio confidencial",
            profile_name: null,
          },
        ],
      };
    }
    if (sql.includes("FROM application_answers aa")) {
      return {
        rows: [
          {
            question_id: 9,
            value_json: options?.hardFail
              ? "No confidencial"
              : "Sí confidencial",
            normalized_value: null,
            field_key: "availability",
            label: "Pregunta confidencial",
            hard_fail: Boolean(options?.hardFail),
            accepted_answers: options?.hardFail ? ["Sí confidencial"] : [],
            answer_config: {},
            evaluation_criteria: null,
            ai_prompt: null,
          },
        ],
      };
    }
    return { rows: [] };
  });
  return { connect, query };
}

beforeEach(() => {
  vi.clearAllMocks();
  observationOptions.length = 0;
  graphConfigs.length = 0;
  createLangfuseCallbackHandler.mockReturnValue(callbackHandler);
  getAgentRuntimeSettings.mockResolvedValue({
    useResponsesApi: true,
    useMethodologies: false,
    instructions: "Instrucciones institucionales.",
    methodologyInterpretation: "Interpretación institucional.",
    summaryWordLimit: 180,
    model: "gpt-4.1-mini",
    secrets: {
      openai_api_key: "primary-secret",
      openai_api_key_backup: "backup-secret",
    },
  });
});

describe("agent evaluator Langfuse observability", () => {
  it("traces the real LangGraph execution once without sensitive metadata", async () => {
    modelInvoke.mockResolvedValue(modelOutput());

    await expect(
      evaluateApplicationWithAgent(poolFixture() as never, 41)
    ).resolves.toMatchObject({
      deterministic: false,
      keySlot: "primary",
    });

    expect(createLangfuseCallbackHandler).toHaveBeenCalledOnce();
    expect(graphConfigs).toHaveLength(1);
    expect(graphConfigs[0]).toMatchObject({
      callbacks: [callbackHandler],
      runName: "candidate-evaluation-graph",
    });
    expect(observationOptions.map(option => option.name)).toEqual([
      "candidate-evaluation",
      "load-evaluation-context",
      "deterministic-eligibility-gate",
      "openai-evaluation-attempt-primary",
      "salary-offer-policy",
      "persist-candidate-evaluation",
    ]);
    expect(
      observationOptions.filter(option => option.asType === "generation")
    ).toHaveLength(0);
    const serializedOptions = JSON.stringify(observationOptions);
    expect(serializedOptions).not.toMatch(
      /confidencial|primary-secret|backup-secret/
    );
  });

  it("makes primary and backup attempts independently visible", async () => {
    modelInvoke
      .mockRejectedValueOnce(new Error("Primary unavailable"))
      .mockResolvedValueOnce(modelOutput());
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      evaluateApplicationWithAgent(poolFixture() as never, 41)
    ).resolves.toMatchObject({ keySlot: "backup" });

    expect(
      observationOptions
        .map(option => option.name)
        .filter(name => String(name).startsWith("openai-evaluation-attempt-"))
    ).toEqual([
      "openai-evaluation-attempt-primary",
      "openai-evaluation-attempt-backup",
    ]);
    expect(createLangfuseCallbackHandler).toHaveBeenCalledTimes(2);
    expect(warning.mock.calls.flat().join(" ")).not.toMatch(
      /primary-secret|backup-secret/
    );
    warning.mockRestore();
  });

  it("records deterministic hard-fails without invoking OpenAI", async () => {
    await expect(
      evaluateApplicationWithAgent(poolFixture({ hardFail: true }) as never, 41)
    ).resolves.toMatchObject({
      deterministic: true,
      status: "no_calificado",
      score: 0,
    });

    expect(modelInvoke).not.toHaveBeenCalled();
    expect(getAgentRuntimeSettings).not.toHaveBeenCalled();
    expect(createLangfuseCallbackHandler).not.toHaveBeenCalled();
    expect(observationOptions.map(option => option.name)).toEqual([
      "candidate-evaluation",
      "load-evaluation-context",
      "deterministic-eligibility-gate",
      "persist-deterministic-hard-fail",
    ]);
  });

  it("accepts verification only after authentication and diagnostic export", async () => {
    verifyLangfuseConnectionFromDatabase.mockResolvedValue({
      ok: true,
      projects: 1,
      traceId: "trace-diagnostic",
      baseUrl: "https://us.cloud.langfuse.com",
      environment: "default",
    });

    await expect(verifyLangfuseConnection({} as never)).resolves.toEqual({
      success: true,
      projects: 1,
      traceId: "trace-diagnostic",
      baseUrl: "https://us.cloud.langfuse.com",
      environment: "default",
    });

    verifyLangfuseConnectionFromDatabase.mockResolvedValue({
      ok: false,
      projects: 0,
      traceId: null,
      reasonCode: "AUTHENTICATION_FAILED",
    });
    await expect(verifyLangfuseConnection({} as never)).rejects.toThrow(
      "Langfuse rechazó las credenciales para la región seleccionada."
    );
  });
});
