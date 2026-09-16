import type { Pool } from "pg";
import { isUndefinedTableError } from "./governanceObservability";
import { loadPositionKnowledgeContext } from "./knowledgeContext";

/**
 * Estado conversacional de una postulación para la ficha de Revisión Humana.
 *
 * Es una consulta de lectura: la conversación, los ciclos abiertos, las
 * aclaraciones confirmadas y el RAG vigente de la plaza, con la huella que usó
 * la última evaluación automática. Si la migración 0022 todavía no se aplicó,
 * devuelve `ready: false` sin romper la revisión humana.
 */

export type ConversationCycleView = {
  id: number;
  dimension: string;
  question: string;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  answerExcerpt: string | null;
};

export type ConversationTurnView = {
  id: number;
  model: string;
  contextFingerprint: string;
  validationStatus: string;
  validationReasons: string[];
  latencyMs: number;
  createdAt: string | null;
};

export type ConversationKnowledgeNoteView = {
  id: number;
  dimension: string;
  topic: string;
  detail: string;
  evidenceExcerpt: string;
  createdAt: string | null;
};

export async function conversationPanelState(
  pool: Pool,
  applicationId: number
) {
  const header = await pool.query(
    `SELECT conv.id AS conversation_id,conv.automation_state,conv.agent_enabled,
            conv.human_takeover,conv.conversation_stage,conv.agent_turn_count,
            conv.last_message_at,conv.last_inbound_at,conv.last_agent_turn_at,
            conv.last_agent_error,
            a.id AS application_id,p.id AS position_id,p.title AS position_title,
            gz.name AS location_zone,gm.name AS location_municipality,
            gd.name AS location_department,co.name AS location_country,
            a.salary_expectation_gtq,a.salary_expectation_source,
            a.salary_expectation_captured_at,
            latest.ai_payload->>'knowledgeFingerprint' AS knowledge_fingerprint,
            latest.ai_payload->>'knowledgeFileCount' AS knowledge_file_count,
            latest.ai_payload->>'knowledgeCharacters' AS knowledge_characters
       FROM applications a
       JOIN job_positions p ON p.id=a.job_position_id
       LEFT JOIN conversations conv ON conv.application_id=a.id
       LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
       LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
       LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
       LEFT JOIN countries co ON co.id=gd.country_id
       LEFT JOIN LATERAL (
         SELECT e.ai_payload FROM evaluations e
          WHERE e.application_id=a.id
          ORDER BY e.created_at DESC,e.id DESC LIMIT 1
       ) latest ON true
      WHERE a.id=$1`,
    [applicationId]
  );
  const row = header.rows[0];
  if (!row) throw new Error("La postulación no existe.");

  const base = {
    applicationId: Number(row.application_id),
    conversationId: row.conversation_id ? Number(row.conversation_id) : null,
    positionId: row.position_id ? Number(row.position_id) : null,
    positionTitle: String(row.position_title ?? "Plaza"),
    automationState: String(row.automation_state ?? "pendiente"),
    agentEnabled: Boolean(row.agent_enabled),
    humanTakeover: Boolean(row.human_takeover),
    stage: String(row.conversation_stage ?? "apertura"),
    agentTurnCount: Number(row.agent_turn_count ?? 0),
    lastMessageAt: row.last_message_at
      ? new Date(row.last_message_at).toISOString()
      : null,
    lastInboundAt: row.last_inbound_at
      ? new Date(row.last_inbound_at).toISOString()
      : null,
    lastAgentTurnAt: row.last_agent_turn_at
      ? new Date(row.last_agent_turn_at).toISOString()
      : null,
    lastAgentError: row.last_agent_error ?? null,
    location: {
      zone: row.location_zone ?? null,
      municipality: row.location_municipality ?? null,
      department: row.location_department ?? null,
      country: row.location_country ?? null,
    },
    salary: {
      expectationGtq: Number(row.salary_expectation_gtq ?? 0),
      source: String(row.salary_expectation_source ?? "no_declarada"),
      capturedAt: row.salary_expectation_captured_at
        ? new Date(row.salary_expectation_captured_at).toISOString()
        : null,
      declared:
        Number(row.salary_expectation_gtq ?? 0) > 0 &&
        String(row.salary_expectation_source ?? "no_declarada") !==
          "no_declarada",
    },
    evaluationKnowledgeFingerprint: row.knowledge_fingerprint ?? null,
    evaluationKnowledgeFileCount:
      row.knowledge_file_count == null
        ? null
        : Number(row.knowledge_file_count),
  };

  const knowledge = await loadPositionKnowledgeContext(
    pool,
    base.positionId
  );

  try {
    const [cycles, turns, notes] = await Promise.all([
      pool.query(
        `SELECT cc.id,cc.dimension,cc.question,cc.status,cc.opened_at,cc.closed_at,
                cc.answer_excerpt
           FROM conversation_cycles cc
           JOIN conversations conv ON conv.id=cc.conversation_id
          WHERE conv.application_id=$1
          ORDER BY cc.status,cc.opened_at DESC
          LIMIT 40`,
        [applicationId]
      ),
      pool.query(
        `SELECT t.id,t.model,t.context_fingerprint,t.validation_status,
                t.validation_reasons,t.latency_ms,t.created_at
           FROM conversation_turns t
           JOIN conversations conv ON conv.id=t.conversation_id
          WHERE conv.application_id=$1
          ORDER BY t.created_at DESC,t.id DESC
          LIMIT 12`,
        [applicationId]
      ),
      pool.query(
        `SELECT id,dimension,topic,detail,evidence_excerpt,created_at
           FROM candidate_knowledge_notes
          WHERE application_id=$1
          ORDER BY created_at DESC,id DESC
          LIMIT 40`,
        [applicationId]
      ),
    ]);
    return {
      ...base,
      ready: true,
      cycles: cycles.rows.map<ConversationCycleView>(item => ({
        id: Number(item.id),
        dimension: String(item.dimension),
        question: String(item.question),
        status: String(item.status),
        openedAt: item.opened_at
          ? new Date(item.opened_at).toISOString()
          : null,
        closedAt: item.closed_at
          ? new Date(item.closed_at).toISOString()
          : null,
        answerExcerpt: item.answer_excerpt ?? null,
      })),
      turns: turns.rows.map<ConversationTurnView>(item => ({
        id: Number(item.id),
        model: String(item.model),
        contextFingerprint: String(item.context_fingerprint),
        validationStatus: String(item.validation_status),
        validationReasons: Array.isArray(item.validation_reasons)
          ? (item.validation_reasons as string[])
          : [],
        latencyMs: Number(item.latency_ms ?? 0),
        createdAt: item.created_at
          ? new Date(item.created_at).toISOString()
          : null,
      })),
      notes: notes.rows.map<ConversationKnowledgeNoteView>(item => ({
        id: Number(item.id),
        dimension: String(item.dimension),
        topic: String(item.topic),
        detail: String(item.detail),
        evidenceExcerpt: String(item.evidence_excerpt),
        createdAt: item.created_at
          ? new Date(item.created_at).toISOString()
          : null,
      })),
      knowledge: {
        available: knowledge.available,
        degraded: knowledge.degraded,
        fingerprint: knowledge.fingerprint,
        fileCount: knowledge.fileCount,
        characters: knowledge.characters,
        projects: knowledge.projects.map(project => ({
          id: project.id,
          name: project.name,
          summary: project.summary,
          files: project.files.map(file => ({
            id: file.id,
            originalName: file.originalName,
            characters: file.analysisCharacters,
          })),
        })),
      },
    };
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return {
      ...base,
      ready: false,
      cycles: [] as ConversationCycleView[],
      turns: [] as ConversationTurnView[],
      notes: [] as ConversationKnowledgeNoteView[],
      knowledge: {
        available: knowledge.available,
        degraded: knowledge.degraded,
        fingerprint: knowledge.fingerprint,
        fileCount: knowledge.fileCount,
        characters: knowledge.characters,
        projects: knowledge.projects.map(project => ({
          id: project.id,
          name: project.name,
          summary: project.summary,
          files: project.files.map(file => ({
            id: file.id,
            originalName: file.originalName,
            characters: file.analysisCharacters,
          })),
        })),
      },
    };
  }
}
