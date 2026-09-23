import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMediaTestDatabase } from "./testSupport/mediaDatabase";
import {
  agentLogTrace,
  buildAgentStageVerdicts,
  loadAgentLogSignals,
  recordAgentLogVerdicts,
  type AgentLogVerdict,
} from "./agentActivityLog";
import {
  DEFAULT_AGENT_STAGE_ENABLED,
  DEFAULT_AGENT_STAGE_MESSAGES,
  DEFAULT_AGENT_STAGE_ORDER,
} from "./agentStages";

/**
 * Caja negra de la bitácora de la IA sobre PostgreSQL real.
 *
 * Se verifica el contrato observable en la ficha, no la forma del código:
 *
 * 1. **Deduplicación.** Registrar dos veces el mismo veredicto deja una sola
 *    línea; el tablero no repite turnos idénticos.
 * 2. **Tablero en orden administrado.** La lectura devuelve las ocho etapas en
 *    la secuencia configurada, con su asiento vigente o pendiente.
 * 3. **Señales de la base.** El estado del currículum y del banco de preguntas
 *    alimentan el veredicto sin inventar hechos.
 */

const enabled = Boolean(process.env.MEDIA_TEST_DATABASE_URL);

describe.runIf(enabled)(
  "PostgreSQL real: bitácora de la IA del agente",
  () => {
    let database: Awaited<ReturnType<typeof createMediaTestDatabase>>;
    let applicationId: number;
    let conversationId: number;

    beforeAll(async () => {
      database = await createMediaTestDatabase();
      const pool = database.pool;
      const position = Number(
        (
          await pool.query(
            `INSERT INTO job_positions(public_slug,code,title,agent_key)
             VALUES('agent-log-test','agent-log-test','Analista de datos','test')
             RETURNING id`
          )
        ).rows[0].id
      );
      const form = Number(
        (
          await pool.query(
            `INSERT INTO application_forms(job_position_id,title)
             VALUES($1,'Formulario sintético') RETURNING id`,
            [position]
          )
        ).rows[0].id
      );
      const candidate = Number(
        (
          await pool.query(
            `INSERT INTO candidates(phone_international,full_name)
             VALUES('+50255551099','Aspirante Sintético de Bitácora') RETURNING id`
          )
        ).rows[0].id
      );
      applicationId = Number(
        (
          await pool.query(
            `INSERT INTO applications(candidate_id,job_position_id,form_id,status,submitted_at)
             VALUES($1,$2,$3,'en_revision',now()) RETURNING id`,
            [candidate, position, form]
          )
        ).rows[0].id
      );
      conversationId = Number(
        (
          await pool.query(
            `INSERT INTO conversations(application_id,provider,status)
             VALUES($1,'apichat','pendiente') RETURNING id`,
            [applicationId]
          )
        ).rows[0].id
      );
    });

    afterAll(async () => {
      await database.close();
    });

    it("asienta y lee el tablero de las ocho etapas en el orden administrado", async () => {
      const pool = database.pool;
      const signals = await loadAgentLogSignals(pool, applicationId);
      const verdicts = buildAgentStageVerdicts({
        config: {
          enabled: { ...DEFAULT_AGENT_STAGE_ENABLED },
          order: [...DEFAULT_AGENT_STAGE_ORDER],
          messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
        },
        source: {
          applicationId,
          position: {
            id: null,
            title: "Analista de datos",
            locationLabel: null,
            description: null,
          },
          profile: null,
          answers: [],
          salary: { expectationGtq: 0, source: "no_declarada", declared: false },
          declaredLocation: {
            zone: null,
            municipality: null,
            department: null,
            country: null,
          },
          knowledge: { projects: [], frameworks: [], methodology: null },
          methodologies: [],
          notes: [],
          cycles: [],
          summary: null,
          turns: [],
          attachments: [],
        },
        decision: { kind: "free" },
        signals,
      });

      const inserted = await recordAgentLogVerdicts(pool, {
        applicationId,
        conversationId,
        verdicts,
      });
      expect(inserted).toBeGreaterThan(0);

      const trace = await agentLogTrace(pool, applicationId);
      expect(trace.map(stage => stage.key)).toEqual([
        ...DEFAULT_AGENT_STAGE_ORDER,
      ]);
      const recepcion = trace.find(stage => stage.key === "recepcion_formulario");
      expect(recepcion?.entry?.completed).toBe(true);
      const precalificacion = trace.find(
        stage => stage.key === "precalificacion"
      );
      // Sin preguntas activas, la etapa queda omitida con motivo y completada.
      expect(precalificacion?.entry?.completed).toBe(true);
      expect(precalificacion?.entry?.skipReason).toBeTruthy();
    });

    it("no repite la misma línea de una etapa en registros posteriores", async () => {
      const pool = database.pool;
      const verdict: AgentLogVerdict = {
        stageKey: "cierre",
        category: "reasoning",
        action: "Cierre del proceso",
        justification: "Se emitió el agradecimiento y el aviso de contacto.",
        completed: true,
        skipReason: null,
      };
      const first = await recordAgentLogVerdicts(pool, {
        applicationId,
        conversationId,
        verdicts: [verdict],
      });
      expect(first).toBe(1);
      const again = await recordAgentLogVerdicts(pool, {
        applicationId,
        conversationId,
        verdicts: [verdict],
      });
      expect(again).toBe(0);

      const result = await pool.query(
        `SELECT count(*)::int AS n FROM agent_ai_log
          WHERE application_id=$1 AND stage_key='cierre'`,
        [applicationId]
      );
      expect(Number(result.rows[0].n)).toBe(1);
    });
  }
);
