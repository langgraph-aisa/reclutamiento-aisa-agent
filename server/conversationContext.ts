import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  EVALUATION_BLOCKS,
  SALARY_GOVERNANCE_POLICY,
  type AgentPreferences,
} from "../shared/agentConfig";
import {
  CONVERSATION_MEMORY_TURNS,
  CONVERSATION_DIMENSIONS,
  type ConversationDimension,
} from "../shared/conversationPersona";
import {
  loadPositionKnowledgeContext,
  type PositionKnowledgeContext,
} from "./knowledgeContext";
import { loadAttachmentManifest } from "./attachmentPipeline";

/**
 * Contexto conversacional de cuatro capas.
 *
 * A. Marco epistemológico institucional (RAG de proyectos + SIERA/MST-EIR).
 * B. RAG personal del candidato (lo declarado en formularios, CV y mensajes).
 * C. Marco comparativo: perfil de la plaza frente al anuncio que se completó.
 * D. Memoria conversacional acumulada (resumen, ciclos y turnos recientes).
 *
 * La precedencia epistémica es explícita: un hecho declarado por la persona
 * prevalece sobre una expectativa del puesto, y ninguna capa puede convertirse
 * en hecho sin evidencia literal.
 */

export const CONVERSATION_METHODOLOGY_CHARACTERS = 24_000;
export const CONVERSATION_LAYER_CHARACTER_LIMIT = 60_000;
export const CONVERSATION_STALE_DAYS = 180;

export type ConversationAnswerInput = {
  answerKey: string;
  fieldKey: string;
  label: string;
  value: unknown;
  hardFail: boolean;
  evaluationCriteria?: string | null;
  deterministicResult?: string | null;
  formTitle?: string | null;
};

export type ConversationNoteInput = {
  dimension: ConversationDimension;
  topic: string;
  detail: string;
  evidenceExcerpt: string;
};

export type ConversationCycleInput = {
  id?: number;
  dimension: ConversationDimension;
  question: string;
  status: string;
  openedAt?: string | null;
  evidenceMessageId?: number | null;
};

export type ConversationTurnInput = {
  direction: "inbound" | "outbound";
  body: string;
  createdAt?: string | null;
};

export type ConversationAttachmentInput = {
  originalName: string;
  category: string;
  status: string;
  transcription?: string | null;
  errorCode?: string | null;
  truncated?: boolean;
};

export type ConversationContextSource = {
  applicationId: number;
  position: {
    id: number | null;
    title: string;
    locationLabel: string | null;
    description: string | null;
  };
  profile: Record<string, unknown> | null;
  answers: ConversationAnswerInput[];
  salary: { expectationGtq: number; source: string; declared: boolean };
  declaredLocation: {
    zone: string | null;
    municipality: string | null;
    department: string | null;
    country: string | null;
  };
  knowledge: PositionKnowledgeContext;
  methodologies: Array<{ display_name: string; content_markdown: string }>;
  notes: ConversationNoteInput[];
  cycles: ConversationCycleInput[];
  summary: string | null;
  turns: ConversationTurnInput[];
  attachments: ConversationAttachmentInput[];
  /**
   * Documentos del RAG personal del candidato con análisis de IA vigente. Son
   * la evidencia documental del expediente —currículum, títulos,
   * certificaciones— y complementan lo declarado en el formulario.
   */
  knowledgeDocuments?: Array<{
    id: number;
    originalName: string;
    source: string;
    analysis: string;
  }>;
  lastInboundAt?: string | null;
};

export type ConversationGapKind =
  | "unknown_required"
  | "contradiction"
  | "missing_location"
  | "salary_not_declared"
  | "cv_pending"
  | "no_declared_evidence"
  | "stale_conversation";

export type ConversationGap = {
  kind: ConversationGapKind;
  dimension: ConversationDimension;
  reason: string;
  /** Pregunta abierta sugerida; `null` cuando no debe preguntarse. */
  suggestion: string | null;
  askable: boolean;
  evidence: string | null;
};

export type BuiltConversationContext = {
  fingerprint: string;
  characters: number;
  layers: {
    marco: string;
    candidato: string;
    comparativo: string;
    memoria: string;
  };
  gaps: ConversationGap[];
  openQuestions: string[];
  rendered: string;
};

const DIMENSION_KEYWORDS: Array<{
  dimension: ConversationDimension;
  pattern: RegExp;
}> = [
  {
    dimension: "disponibilidad_logistica",
    pattern:
      /(ubicaci|zona|municipio|departamento|transporte|licencia|horario|disponibilidad|traslad|resid)/i,
  },
  {
    dimension: "competencias",
    pattern: /(competenc|herramienta|tecnolog|software|idioma|conocimiento)/i,
  },
  {
    dimension: "evidencia_experiencia",
    pattern: /(experiencia|año|puesto anterior|referencia|empresa)/i,
  },
  {
    dimension: "riesgos_brechas",
    pattern:
      /(brecha|riesgo|inconsistencia|requisito indispensable|descalific)/i,
  },
  {
    dimension: "remuneracion",
    pattern: /(salario|salarial|remuneraci|expectativa econ)/i,
  },
  {
    dimension: "identificacion_ajuste",
    pattern: /(nombre|correo|tel[eé]fono|identificaci|perfil|ajuste)/i,
  },
];

function dimensionForAnswer(label: string, fieldKey: string) {
  const haystack = `${label} ${fieldKey}`;
  return (
    DIMENSION_KEYWORDS.find(entry => entry.pattern.test(haystack))?.dimension ??
    "identificacion_ajuste"
  );
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value
      .map(item => stringifyValue(item))
      .filter(Boolean)
      .join(", ");
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function isValidEvidence(value: string) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return !["", "-", "—", "n/a", "na", "null", "undefined", "{}", "[]"].includes(
    normalized
  );
}

function daysSince(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

export function computeConversationGaps(
  source: ConversationContextSource,
  now = new Date()
): ConversationGap[] {
  const gaps: ConversationGap[] = [];
  const answersWithEvidence = source.answers.filter(answer =>
    isValidEvidence(stringifyValue(answer.value))
  );

  if (!answersWithEvidence.length) {
    gaps.push({
      kind: "no_declared_evidence",
      dimension: "evidencia_experiencia",
      reason: "La postulación no registra respuestas con evidencia declarada.",
      suggestion:
        "¿Podría describir con detalle su experiencia más reciente relacionada con la plaza?",
      askable: true,
      evidence: null,
    });
  }

  for (const answer of source.answers) {
    const value = stringifyValue(answer.value);
    const dimension = dimensionForAnswer(answer.label, answer.fieldKey);
    if (answer.hardFail && !isValidEvidence(value)) {
      gaps.push({
        kind: "unknown_required",
        dimension,
        reason: `El requisito indispensable «${answer.label}» no tiene evidencia declarada.`,
        suggestion: `¿Podría ampliar la información sobre «${answer.label}» para completar el expediente?`,
        askable: true,
        evidence: null,
      });
      continue;
    }
    if (answer.deterministicResult === "failed") {
      gaps.push({
        kind: "contradiction",
        dimension,
        reason: `La respuesta «${answer.label}» no superó la verificación determinista.`,
        suggestion: `¿Podría aclarar el detalle de «${answer.label}» para confirmar la información registrada?`,
        askable: true,
        evidence: value || null,
      });
    }
  }

  const locationIncomplete =
    !source.declaredLocation.zone ||
    !source.declaredLocation.department ||
    !source.declaredLocation.country;
  if (locationIncomplete) {
    gaps.push({
      kind: "missing_location",
      dimension: "disponibilidad_logistica",
      reason: "La ubicación declarada está incompleta para la revisión humana.",
      suggestion: "¿En qué zona, municipio y departamento reside actualmente?",
      askable: true,
      evidence:
        [
          source.declaredLocation.zone,
          source.declaredLocation.municipality,
          source.declaredLocation.department,
          source.declaredLocation.country,
        ]
          .filter(Boolean)
          .join(", ") || null,
    });
  }

  if (!source.salary.declared) {
    gaps.push({
      kind: "salary_not_declared",
      dimension: "remuneracion",
      reason:
        "La expectativa de remuneración permanece en cero y marcada como no declarada.",
      suggestion: null,
      askable: false,
      evidence: null,
    });
  }

  const pendingCv = source.attachments.some(
    attachment =>
      /cv|curriculum/i.test(attachment.category) &&
      attachment.status !== "analizado"
  );
  if (pendingCv) {
    gaps.push({
      kind: "cv_pending",
      dimension: "identificacion_ajuste",
      reason: "El CV recibido todavía no está analizado en el RAG personal.",
      suggestion: null,
      askable: false,
      evidence: null,
    });
  }

  const idleDays = daysSince(source.lastInboundAt, now);
  if (idleDays !== null && idleDays >= CONVERSATION_STALE_DAYS) {
    gaps.push({
      kind: "stale_conversation",
      dimension: "identificacion_ajuste",
      reason: `La conversación permanece sin respuesta desde hace ${idleDays} días.`,
      suggestion:
        "¿Continúa interesado en la plaza y disponible para continuar con el proceso?",
      askable: true,
      evidence: null,
    });
  }

  return gaps;
}

function renderMarcoLayer(source: ConversationContextSource) {
  const methodologies = source.methodologies
    .map(
      document =>
        `### ${document.display_name}\n${document.content_markdown.slice(0, CONVERSATION_METHODOLOGY_CHARACTERS)}`
    )
    .join("\n\n");
  return [
    "=== A. MARCO EPISTEMOLÓGICO INSTITUCIONAL ===",
    `RAG de proyectos (huella ${source.knowledge.fingerprint.slice(0, 16)}):`,
    source.knowledge.rendered,
    "",
    "Documentos metodológicos:",
    methodologies ||
      "Referencias SIERA/MST-EIR deshabilitadas por administración.",
  ].join("\n");
}

function renderCandidatoLayer(source: ConversationContextSource) {
  const declared = source.answers
    .map(answer => {
      const value = stringifyValue(answer.value);
      return `- ${answer.label}${answer.formTitle ? ` (${answer.formTitle})` : ""}: ${
        isValidEvidence(value) ? value : "sin evidencia literal"
      }`;
    })
    .join("\n");
  const location = source.declaredLocation;
  const attachments = source.attachments
    .map(
      attachment =>
        `- ${attachment.originalName} · ${attachment.category} · ${attachment.status}${attachment.errorCode ? ` · procesamiento: ${attachment.errorCode}` : ""}${attachment.truncated ? " · extracción parcial: revisar original" : ""}${
          attachment.transcription?.trim()
            ? ` · transcripción: ${attachment.transcription.trim().slice(0, 400)}`
            : ""
        }`
    )
    .join("\n");
  const notes = source.notes
    .map(
      note =>
        `- [${note.dimension}] ${note.topic}: ${note.detail} (evidencia: ${note.evidenceExcerpt})`
    )
    .join("\n");
  const documents = (source.knowledgeDocuments ?? [])
    .map(
      document =>
        `- ${document.originalName} (${document.source}): ${document.analysis}`
    )
    .join("\n");
  return [
    "=== B. LO QUE LA PERSONA DECLARÓ (RAG PERSONAL) ===",
    `Puesto solicitado: ${source.position.title}`,
    `Ubicación declarada: ${
      [
        location.zone,
        location.municipality,
        location.department,
        location.country,
      ]
        .filter(Boolean)
        .join(", ") || "sin confirmar"
    }`,
    `Expectativa de remuneración: ${
      source.salary.declared
        ? `Q ${source.salary.expectationGtq} (fuente: ${source.salary.source})`
        : "no declarada; no existe evidencia literal"
    }`,
    "",
    "Respuestas registradas:",
    declared || "- Sin respuestas registradas.",
    "",
    "Aclaraciones confirmadas por la persona:",
    notes || "- Sin aclaraciones adicionales.",
    "",
    "Documentos recibidos:",
    attachments || "- No hay adjuntos registrados en el manifiesto disponible.",
    "Recibido no significa interpretado ni identificado como CV. Si un archivo está pendiente, falló o requiere OCR, comunique su estado sin negar su recepción ni pedir reenviarlo por un fallo interno.",
    "",
    "Expediente documental del candidato (análisis vigente):",
    documents || "- Sin documentos analizados en el expediente.",
    "",
    SALARY_GOVERNANCE_POLICY,
  ].join("\n");
}

function renderComparativoLayer(
  source: ConversationContextSource,
  gaps: ConversationGap[]
) {
  const profile = source.profile ?? {};
  const expected = [
    ["Perfil laboral", profile.name],
    ["Experiencia mínima", profile.experienceYearsMin],
    ["Nivel académico", profile.academicLevel],
    ["Habilidades técnicas", profile.technicalSkills],
    ["Conocimientos", profile.knowledge],
    ["Disponibilidad", profile.availability],
    ["Ubicación del puesto", profile.location],
    ["Modalidad de trabajo", profile.workMode],
  ]
    .filter(([, value]) => {
      const rendered = stringifyValue(value);
      return isValidEvidence(rendered);
    })
    .map(([label, value]) => `- ${label}: ${stringifyValue(value)}`)
    .join("\n");
  const gapLines = gaps
    .map(
      gap =>
        `- ${gap.kind} · ${gap.dimension} · ${gap.reason}${
          gap.suggestion ? ` · sugerencia: ${gap.suggestion}` : ""
        }`
    )
    .join("\n");
  return [
    "=== C. MARCO COMPARATIVO: PLAZA VERSUS DECLARACIÓN ===",
    `Plaza: ${source.position.title}${
      source.position.locationLabel ? ` · ${source.position.locationLabel}` : ""
    }`,
    expected || "- Sin perfil laboral vinculado a la plaza.",
    "",
    "Diferencias detectadas de forma determinista:",
    gapLines || "- Sin diferencias detectadas.",
  ].join("\n");
}

function renderMemoriaLayer(source: ConversationContextSource) {
  const cycles = source.cycles
    .map(
      cycle =>
        `- ${cycle.status === "abierto" ? "ABIERTO" : "cerrado"} [${cycle.dimension}] ${cycle.question}`
    )
    .join("\n");
  const turns = source.turns
    .map(
      turn =>
        `${turn.direction === "inbound" ? "Persona" : "Agente"}: ${turn.body.slice(0, 600)}`
    )
    .join("\n");
  return [
    "=== D. MEMORIA CONVERSACIONAL ===",
    `Resumen acumulado: ${source.summary?.trim() || "sin resumen previo"}`,
    "",
    "Ciclos de información:",
    cycles || "- Sin ciclos registrados.",
    "",
    "Turnos recientes:",
    turns || "- Sin turnos registrados.",
  ].join("\n");
}

export function buildConversationContext(
  source: ConversationContextSource,
  now = new Date()
): BuiltConversationContext {
  const gaps = computeConversationGaps(source, now);
  const layers = {
    marco: renderMarcoLayer(source),
    candidato: renderCandidatoLayer(source),
    comparativo: renderComparativoLayer(source, gaps),
    memoria: renderMemoriaLayer(source),
  };
  const rendered = [
    layers.candidato,
    layers.memoria,
    layers.comparativo,
    layers.marco,
  ]
    .join("\n\n")
    .slice(0, CONVERSATION_LAYER_CHARACTER_LIMIT);
  const openQuestions = source.cycles
    .filter(cycle => cycle.status === "abierto")
    .map(cycle => cycle.question);
  const canonical = JSON.stringify({
    rendered,
    attachments: source.attachments,
    documents: source.knowledgeDocuments ?? [],
    knowledge: source.knowledge.fingerprint,
    gaps,
  });
  return {
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
    characters: rendered.length,
    layers,
    gaps,
    openQuestions,
    rendered,
  };
}

export function effectiveConversationGaps(gaps: ConversationGap[]) {
  return gaps.filter(gap => gap.askable && gap.suggestion);
}

type ApplicationContextRow = {
  application_id: number;
  position_id: number | null;
  position_title: string;
  location_label: string | null;
  position_description: string | null;
  salary_expectation_gtq: string | number | null;
  salary_expectation_source: string | null;
  location_zone: string | null;
  location_municipality: string | null;
  location_department: string | null;
  location_country: string | null;
  last_inbound_at: string | Date | null;
  profile_name: string | null;
  profile_payload: Record<string, unknown> | null;
};

/**
 * Carga el expediente completo que alimenta el razonamiento conversacional.
 * Todas las consultas son de lectura y se ejecutan en paralelo.
 */
export async function loadConversationContextSource(
  pool: Pool,
  applicationId: number,
  options: { methodologies: boolean; preferences?: AgentPreferences } = {
    methodologies: false,
  }
): Promise<{
  source: ConversationContextSource;
  knowledge: PositionKnowledgeContext;
  cycles: ConversationCycleInput[];
}> {
  const header = await pool.query<ApplicationContextRow>(
    `SELECT a.id AS application_id,p.id AS position_id,p.title AS position_title,
            p.location_label,p.description AS position_description,
            a.salary_expectation_gtq,a.salary_expectation_source,
            gz.name AS location_zone,gm.name AS location_municipality,
            gd.name AS location_department,co.name AS location_country,
            conv.last_inbound_at,
            jp.name AS profile_name,
            CASE WHEN jp.id IS NULL THEN NULL ELSE jsonb_build_object(
              'name',jp.name,'summary',jp.summary,'objective',jp.objective,
              'responsibilities',jp.responsibilities,
              'requiredRequirements',jp.required_requirements,
              'technicalSkills',jp.technical_skills,'softSkills',jp.soft_skills,
              'knowledge',jp.knowledge,'academicLevel',jp.academic_level,
              'experienceYearsMin',jp.experience_years_min,
              'experienceYearsMax',jp.experience_years_max,
              'languages',jp.languages,'licenses',jp.licenses,
              'availability',jp.availability,'location',jp.location,
              'workMode',jp.work_mode,'aiCriteria',jp.ai_criteria
            ) END AS profile_payload
       FROM applications a
       JOIN job_positions p ON p.id=a.job_position_id
       LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
       LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
       LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
       LEFT JOIN countries co ON co.id=gd.country_id
       LEFT JOIN LATERAL (
         SELECT conv.last_inbound_at FROM conversations conv
          WHERE conv.application_id=a.id
          ORDER BY conv.id DESC LIMIT 1
       ) conv ON true
       LEFT JOIN LATERAL (
         SELECT jp.* FROM job_profile_positions link
           JOIN job_profiles jp ON jp.id=link.profile_id AND jp.active=true
          WHERE link.job_position_id=p.id
          ORDER BY jp.updated_at DESC NULLS LAST LIMIT 1
       ) jp ON true
      WHERE a.id=$1`,
    [applicationId]
  );
  const row = header.rows[0];
  if (!row) throw new Error("Postulación no encontrada.");

  const [
    answers,
    memory,
    notes,
    attachments,
    methodologies,
    knowledgeDocuments,
  ] = await Promise.all([
    pool.query(
      `SELECT aa.value_json,aa.normalized_value,aa.deterministic_result,
              q.field_key,q.label,q.hard_fail,q.evaluation_criteria,
              f.title AS form_title
         FROM application_answers aa
         JOIN form_questions q ON q.id=aa.question_id
         JOIN application_forms f ON f.id=q.form_id
        WHERE aa.application_id=$1 AND q.active=true
        ORDER BY f.version,q.order_index,aa.question_id`,
      [applicationId]
    ),
    pool.query(
      `SELECT 'summary' AS kind,NULL::int AS id,NULL::varchar AS dimension,
              cs.summary AS body,NULL::varchar AS status,cs.created_at
         FROM conversation_summaries cs
         JOIN conversations conv ON conv.id=cs.conversation_id
        WHERE conv.application_id=$1
        ORDER BY cs.version DESC LIMIT 1`,
      [applicationId]
    ),
    pool.query(
      `SELECT cc.id,cc.dimension,cc.question,cc.status,cc.opened_at,cc.answer_excerpt,
              cc.evidence_message_id,
              ck.topic,ck.detail,ck.evidence_excerpt
         FROM conversations conv
         LEFT JOIN conversation_cycles cc ON cc.conversation_id=conv.id
         LEFT JOIN candidate_knowledge_notes ck ON ck.conversation_id=conv.id
        WHERE conv.application_id=$1
        ORDER BY cc.opened_at DESC NULLS LAST,ck.created_at DESC NULLS LAST
        LIMIT 120`,
      [applicationId]
    ),
    // Manifiesto único: la bandeja y este motor leen el mismo hecho.
    loadAttachmentManifest(pool, applicationId),
    options.methodologies
      ? pool.query<{ display_name: string; content_markdown: string }>(
          `SELECT display_name,content_markdown FROM methodology_documents
            WHERE document_key IN ('siera','mst_eir') ORDER BY document_key`
        )
      : Promise.resolve({
          rows: [] as Array<{ display_name: string; content_markdown: string }>,
        }),
    pool.query(
      `SELECT id,original_name,source,deep_analysis
           FROM candidate_knowledge_files
          WHERE application_id=$1
            AND analysis_status='analizado'
            AND COALESCE(deep_analysis,'')<>''
          ORDER BY uploaded_at DESC,id DESC
          LIMIT 12`,
      [applicationId]
    ),
  ]);

  const turns = await pool.query(
    `SELECT m.direction,m.body,m.created_at
       FROM conversation_messages m
       JOIN conversations conv ON conv.id=m.conversation_id
      WHERE conv.application_id=$1
      ORDER BY m.created_at DESC,m.id DESC
      LIMIT ${CONVERSATION_MEMORY_TURNS}`,
    [applicationId]
  );

  const knowledge = await loadPositionKnowledgeContext(
    pool,
    row.position_id ? Number(row.position_id) : null
  );

  const cycles: ConversationCycleInput[] = [];
  const noteInputs: ConversationNoteInput[] = [];
  for (const item of notes.rows) {
    if (item.question && item.status) {
      cycles.push({
        id: Number(item.id),
        dimension: String(item.dimension) as ConversationDimension,
        question: String(item.question),
        status: String(item.status),
        openedAt: item.opened_at
          ? new Date(item.opened_at).toISOString()
          : null,
        evidenceMessageId:
          item.evidence_message_id != null
            ? Number(item.evidence_message_id)
            : null,
      });
    }
    if (item.topic && item.detail && item.evidence_excerpt) {
      noteInputs.push({
        dimension: String(item.dimension) as ConversationDimension,
        topic: String(item.topic),
        detail: String(item.detail),
        evidenceExcerpt: String(item.evidence_excerpt),
      });
    }
  }

  const source: ConversationContextSource = {
    applicationId,
    position: {
      id: row.position_id ? Number(row.position_id) : null,
      title: String(row.position_title ?? "Plaza"),
      locationLabel: row.location_label ?? null,
      description: row.position_description ?? null,
    },
    profile: row.profile_payload ?? null,
    answers: answers.rows.map(item => ({
      answerKey: String(item.field_key),
      fieldKey: String(item.field_key),
      label: String(item.label),
      value: item.value_json,
      hardFail: Boolean(item.hard_fail),
      evaluationCriteria: item.evaluation_criteria ?? null,
      deterministicResult: item.deterministic_result ?? null,
      formTitle: item.form_title ?? null,
    })),
    salary: {
      expectationGtq: Number(row.salary_expectation_gtq ?? 0),
      source: String(row.salary_expectation_source ?? "no_declarada"),
      declared:
        Number(row.salary_expectation_gtq ?? 0) > 0 &&
        String(row.salary_expectation_source ?? "no_declarada") !==
          "no_declarada",
    },
    declaredLocation: {
      zone: row.location_zone ?? null,
      municipality: row.location_municipality ?? null,
      department: row.location_department ?? null,
      country: row.location_country ?? null,
    },
    knowledge,
    methodologies: methodologies.rows.map(item => ({
      display_name: String(item.display_name),
      content_markdown: String(item.content_markdown),
    })),
    notes: noteInputs,
    cycles,
    summary: memory.rows[0]?.body ? String(memory.rows[0].body) : null,
    turns: turns.rows
      .slice()
      .reverse()
      .map(item => ({
        direction: item.direction === "inbound" ? "inbound" : "outbound",
        body: String(item.body ?? ""),
        createdAt: item.created_at
          ? new Date(item.created_at).toISOString()
          : null,
      })),
    attachments,
    knowledgeDocuments: (
      knowledgeDocuments.rows as Array<Record<string, unknown>>
    ).map(item => ({
      id: Number(item.id),
      originalName: String(item.original_name),
      source: String(item.source ?? "manual"),
      analysis: String(item.deep_analysis ?? "").slice(0, 2_000),
    })),
    lastInboundAt: row.last_inbound_at
      ? new Date(row.last_inbound_at).toISOString()
      : null,
  };

  return { source, knowledge, cycles };
}

export const CONVERSATION_DIMENSION_ORDER = CONVERSATION_DIMENSIONS;
export const CONVERSATION_EVALUATION_BLOCK_IDS = EVALUATION_BLOCKS.map(
  block => block.id
);
