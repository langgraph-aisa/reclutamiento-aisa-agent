import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getPool, getUserById, getUserByOpenId } from "./db";
import {
  clearLocalSession,
  createLoginCode,
  hashLoginCode,
  issueLocalSession,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  maskEmail,
  sendDeleteCode,
  sendLoginCode,
  setLocalSession,
  verifyLoginCode,
} from "./localAuth";
import { normalizePhone } from "./phone";
import { resolveApplicationLocation } from "./applicationLocation";
import { COOKIE_NAME } from "@shared/const";
import { APP_VERSION } from "@shared/release";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  recruiterProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  deliverCvRequestMessage,
  ensureCvRequestMessage,
  type CvRequestDelivery,
} from "./cvRequest";
import {
  AGENT_MODELS,
  LANGFUSE_CAPTURE_MODES,
  LANGFUSE_CLOUD_BASE_URLS,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
} from "../shared/agentConfig";
import {
  evaluateApplicationWithAgent,
  verifyLangfuseConnection,
  verifyOpenAIConnection,
} from "./agentEvaluator";
import {
  AGENT_SECRET_KEYS,
  getAgentConfiguration,
  saveAgentPreferences,
  saveAgentSecret,
} from "./agentSettings";
import { initializeLangfuseFromDatabase } from "./observability/langfuse";
import {
  APICHAT_SECRET_KEYS,
  getApiChatConfiguration,
  getApiChatEndpoints,
  getApiChatReceptionReadiness,
  saveApiChatEndpointStates,
  saveApiChatPreferences,
  saveApiChatSecret,
  verifyApiChatConnection,
} from "./apiChatSettings";
import { applicationStatuses } from "./policy";
import {
  APPLICATION_CONSENTS,
  APPLICATION_CONSENT_VERSION,
} from "../shared/applicationConsent";
import {
  normalizePublicCopy,
  PUBLIC_COPY_EDITORIAL_MODEL,
  PUBLIC_COPY_EDITORIAL_POLICY_VERSION,
  type EditorialFieldStyle,
  type PublicCopyEditorialInput,
  type PublicCopyEditorialResult,
} from "./profileEditorial";
import {
  assignJarviUser,
  getActivityOverview,
  getJarviAssignment,
  recordAdminActivity,
} from "./activityAudit";
import {
  deleteInboxMessage,
  inboxDetail,
  listInbox,
  sendInboxFile,
  sendInboxLink,
  sendInboxLocation,
  sendInboxPtt,
  sendInboxText,
  setInboxAutomation,
} from "./inbox";
import {
  ASSESSMENT_DELETE_CODE_MAX_ATTEMPTS,
  ASSESSMENT_DELETE_CODE_RESEND_SECONDS,
  ASSESSMENT_DELETE_CODE_TTL_MINUTES,
  ASSESSMENT_GOVERNANCE_RULES,
  ASSESSMENT_LEVELS,
  missingPsychometricEvidenceTerms,
} from "../shared/assessmentGovernance";

const statusValues = applicationStatuses;
const featuredPublicPositionTitle = "Ejecutivo de Negocios (Ventas)";
const methodologyDocumentKeys = ["siera", "mst_eir"] as const;
const agentModelValues = AGENT_MODELS.map(model => model.value) as [
  (typeof AGENT_MODELS)[number]["value"],
  ...(typeof AGENT_MODELS)[number]["value"][],
];
const transcriptionModelValues = OPENAI_TRANSCRIPTION_MODELS.map(
  model => model.value
) as [
  (typeof OPENAI_TRANSCRIPTION_MODELS)[number]["value"],
  ...(typeof OPENAI_TRANSCRIPTION_MODELS)[number]["value"][],
];
const ttsModelValues = OPENAI_TTS_MODELS.map(model => model.value) as [
  (typeof OPENAI_TTS_MODELS)[number]["value"],
  ...(typeof OPENAI_TTS_MODELS)[number]["value"][],
];
const assessmentLevelValues = ASSESSMENT_LEVELS.map(level => level.value) as [
  (typeof ASSESSMENT_LEVELS)[number]["value"],
  ...(typeof ASSESSMENT_LEVELS)[number]["value"][],
];
const roleProcedure = recruiterProcedure;
const requiredApplicationConfirmation = z.boolean().refine(Boolean, {
  message: "La confirmación es obligatoria.",
});

async function requirePool() {
  const pool = await getPool();
  if (!pool)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "PostgreSQL no está configurado todavía.",
    });
  return pool;
}

type DatabasePool = NonNullable<Awaited<ReturnType<typeof getPool>>>;

async function requireCompletePositionProfile(
  pool: DatabasePool,
  positionId: number
) {
  const profileReadiness = await pool.query(
    `SELECT profile.id AS profile_id,
            profile.name,
            profile.summary,
            profile.objective,
            profile.responsibilities,
            profile.required_requirements,
            profile.technical_skills,
            profile.soft_skills,
            profile.knowledge,
            profile.academic_level,
            profile.languages,
            profile.licenses,
            profile.availability,
            profile.location,
            profile.salary_range,
            profile.work_mode,
            profile.ai_criteria
       FROM job_positions position
       JOIN job_profiles profile ON profile.active = true
       LEFT JOIN job_profile_positions link
         ON link.profile_id = profile.id
        AND link.job_position_id = position.id
      WHERE position.id = $1
        AND (
          link.job_position_id IS NOT NULL
          OR LOWER(BTRIM(profile.name)) = LOWER(BTRIM(position.title))
        )
        AND NULLIF(BTRIM(COALESCE(profile.objective, '')), '') IS NOT NULL
        AND jsonb_array_length(COALESCE(profile.responsibilities, '[]'::jsonb)) > 0
        AND jsonb_array_length(COALESCE(profile.required_requirements, '[]'::jsonb)) > 0
      ORDER BY (link.job_position_id IS NOT NULL) DESC, profile.updated_at DESC, profile.id DESC
      LIMIT 1`,
    [positionId]
  );
  const profileId = profileReadiness.rows[0]?.profile_id as number | undefined;
  if (!profileId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La plaza requiere un perfil activo con objetivo, responsabilidades y requisitos obligatorios antes de publicarse.",
    });
  }
  await pool.query(
    `INSERT INTO job_profile_positions (profile_id,job_position_id)
     VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [profileId, positionId]
  );
  return profileReadiness.rows[0] as Record<string, any> & {
    profile_id: number;
  };
}

type ValidatedPublicCopy = {
  fields: Record<string, string>;
  lists: Record<string, string[]>;
  audit: null | {
    before: PublicCopyEditorialInput;
    after: PublicCopyEditorialInput;
    result: PublicCopyEditorialResult;
    contentHash: string;
    policyVersion: string | null;
  };
};

function editorialField(
  key: string,
  value: unknown,
  style: EditorialFieldStyle,
  maxLength?: number
): PublicCopyEditorialInput["fields"][number] | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? { key, text, style, maxLength } : null;
}

function editorialList(key: string, value: unknown) {
  const items = (Array.isArray(value) ? value : []).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
  return items.length ? { key, items } : null;
}

function publicCopyPolicyVersion(input: PublicCopyEditorialInput) {
  return input.lists.some(list =>
    ["responsibilities", "requiredRequirements"].includes(list.key)
  )
    ? PUBLIC_COPY_EDITORIAL_POLICY_VERSION
    : null;
}

function publicCopyHash(input: PublicCopyEditorialInput) {
  const policyVersion = publicCopyPolicyVersion(input);
  return createHash("sha256")
    .update(JSON.stringify(policyVersion ? { policyVersion, input } : input))
    .digest("hex");
}

function copyFromInput(input: PublicCopyEditorialInput) {
  return {
    fields: Object.fromEntries(
      input.fields.map(field => [field.key, field.text])
    ),
    lists: Object.fromEntries(input.lists.map(list => [list.key, list.items])),
  };
}

function copyFromResult(
  input: PublicCopyEditorialInput,
  result: PublicCopyEditorialResult
): PublicCopyEditorialInput {
  return {
    fields: input.fields.map(field => ({
      ...field,
      text: result.fields[field.key],
    })),
    lists: input.lists.map(list => ({
      key: list.key,
      items: result.lists[list.key],
    })),
  };
}

async function hasCurrentEditorialValidation(
  pool: Pick<DatabasePool, "query">,
  entityType: string,
  entityId: number,
  contentHash: string,
  policyVersion: string | null
) {
  const result = await pool.query<{ validated: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM audit_log
        WHERE entity_type=$1
          AND entity_id=$2
          AND action='public_copy_editorially_normalized'
          AND after_json->>'contentHash'=$3
          AND after_json->>'model'=$4
          AND ($5::text IS NULL OR after_json->>'policyVersion'=$5)
     ) AS validated`,
    [
      entityType,
      entityId,
      contentHash,
      PUBLIC_COPY_EDITORIAL_MODEL,
      policyVersion,
    ]
  );
  return result.rows[0]?.validated === true;
}

async function validateEntityPublicCopy(
  pool: DatabasePool,
  entityType: string,
  entityId: number | undefined,
  input: PublicCopyEditorialInput
): Promise<ValidatedPublicCopy> {
  const contentHash = publicCopyHash(input);
  const policyVersion = publicCopyPolicyVersion(input);
  if (
    entityId &&
    (await hasCurrentEditorialValidation(
      pool,
      entityType,
      entityId,
      contentHash,
      policyVersion
    ))
  ) {
    return { ...copyFromInput(input), audit: null };
  }
  const result = await normalizePublicCopy(pool, input);
  const after = copyFromResult(input, result);
  return {
    fields: result.fields,
    lists: result.lists,
    audit: {
      before: input,
      after,
      result,
      contentHash: publicCopyHash(after),
      policyVersion,
    },
  };
}

async function recordEditorialValidation(
  db: Pick<DatabasePool, "query">,
  entityType: string,
  entityId: number,
  actorUserId: number | null,
  validation: ValidatedPublicCopy
) {
  if (!validation.audit) return;
  await db.query(
    `INSERT INTO audit_log
       (actor_user_id,entity_type,entity_id,action,before_json,after_json,comment)
     VALUES ($1,$2,$3,'public_copy_editorially_normalized',$4::jsonb,$5::jsonb,$6)`,
    [
      actorUserId,
      entityType,
      entityId,
      asJson(validation.audit.before),
      asJson({
        ...validation.audit.after,
        contentHash: validation.audit.contentHash,
        model: validation.audit.result.model,
        keySlot: validation.audit.result.keySlot,
        policyVersion: validation.audit.policyVersion,
      }),
      `Revisión integral de texto público mediante OpenAI Responses API con ${validation.audit.result.model}.`,
    ]
  );
}

function profilePublicCopyInput(profile: Record<string, any>) {
  const fields = [
    editorialField("name", profile.name, "title", 180),
    editorialField("summary", profile.summary, "paragraph", 2_000),
    editorialField("objective", profile.objective, "paragraph", 5_000),
    editorialField("academicLevel", profile.academicLevel, "paragraph", 120),
    editorialField("availability", profile.availability, "paragraph", 1_000),
    editorialField("location", profile.location, "proper_noun", 1_000),
    editorialField("salaryRange", profile.salaryRange, "paragraph", 160),
    editorialField("workMode", profile.workMode, "paragraph", 80),
    editorialField(
      "aiCriteria",
      profile.aiCriteria,
      "internal_criterion",
      5_000
    ),
  ].filter(Boolean) as PublicCopyEditorialInput["fields"];
  const lists = [
    editorialList("responsibilities", profile.responsibilities),
    editorialList("requiredRequirements", profile.requiredRequirements),
    editorialList("technicalSkills", profile.technicalSkills),
    editorialList("softSkills", profile.softSkills),
    editorialList("knowledge", profile.knowledge),
    editorialList("languages", profile.languages),
    editorialList("licenses", profile.licenses),
  ].filter(Boolean) as PublicCopyEditorialInput["lists"];
  return { fields, lists };
}

function profileCopyFromRow(row: Record<string, any>) {
  return {
    name: row.name,
    summary: row.summary,
    objective: row.objective,
    responsibilities: row.responsibilities,
    requiredRequirements: row.required_requirements,
    technicalSkills: row.technical_skills,
    softSkills: row.soft_skills,
    knowledge: row.knowledge,
    academicLevel: row.academic_level,
    languages: row.languages,
    licenses: row.licenses,
    availability: row.availability,
    location: row.location,
    salaryRange: row.salary_range,
    workMode: row.work_mode,
    aiCriteria: row.ai_criteria,
  };
}

function applyProfileEditorialCopy(
  profile: Record<string, any>,
  validation: ValidatedPublicCopy
) {
  const field = (key: string, fallback: unknown) =>
    validation.fields[key] ?? fallback ?? null;
  const list = (key: string, fallback: unknown) =>
    validation.lists[key] ?? (Array.isArray(fallback) ? fallback : []);
  return {
    ...profile,
    name: field("name", profile.name),
    summary: field("summary", profile.summary),
    objective: field("objective", profile.objective),
    responsibilities: list("responsibilities", profile.responsibilities),
    requiredRequirements: list(
      "requiredRequirements",
      profile.requiredRequirements
    ),
    technicalSkills: list("technicalSkills", profile.technicalSkills),
    softSkills: list("softSkills", profile.softSkills),
    knowledge: list("knowledge", profile.knowledge),
    academicLevel: field("academicLevel", profile.academicLevel),
    languages: list("languages", profile.languages),
    licenses: list("licenses", profile.licenses),
    availability: field("availability", profile.availability),
    location: field("location", profile.location),
    salaryRange: field("salaryRange", profile.salaryRange),
    workMode: field("workMode", profile.workMode),
    aiCriteria: field("aiCriteria", profile.aiCriteria),
  };
}

async function normalizeStoredProfile(
  pool: DatabasePool,
  row: Record<string, any>,
  actorUserId: number | null
) {
  const profile = profileCopyFromRow(row);
  const validation = await validateEntityPublicCopy(
    pool,
    "job_profile",
    Number(row.profile_id ?? row.id),
    profilePublicCopyInput(profile)
  );
  if (!validation.audit) return row;
  const normalized = applyProfileEditorialCopy(profile, validation);
  await pool.query(
    `UPDATE job_profiles
        SET name=$1,summary=$2,objective=$3,responsibilities=$4::jsonb,
            required_requirements=$5::jsonb,technical_skills=$6::jsonb,
            soft_skills=$7::jsonb,knowledge=$8::jsonb,academic_level=$9,
            languages=$10::jsonb,licenses=$11::jsonb,availability=$12,
            location=$13,salary_range=$14,work_mode=$15,ai_criteria=$16,
            updated_at=now()
      WHERE id=$17`,
    [
      normalized.name,
      normalized.summary,
      normalized.objective,
      asJson(normalized.responsibilities),
      asJson(normalized.requiredRequirements),
      asJson(normalized.technicalSkills),
      asJson(normalized.softSkills),
      asJson(normalized.knowledge),
      normalized.academicLevel,
      asJson(normalized.languages),
      asJson(normalized.licenses),
      normalized.availability,
      normalized.location,
      normalized.salaryRange,
      normalized.workMode,
      normalized.aiCriteria,
      Number(row.profile_id ?? row.id),
    ]
  );
  await recordEditorialValidation(
    pool,
    "job_profile",
    Number(row.profile_id ?? row.id),
    actorUserId,
    validation
  );
  return { ...row, ...normalized };
}

async function preparePositionProfileForPublication(
  pool: DatabasePool,
  positionId: number,
  actorUserId: number | null
) {
  const profile = await requireCompletePositionProfile(pool, positionId);
  return normalizeStoredProfile(pool, profile, actorUserId);
}

function positionPublicCopyInput(position: Record<string, any>) {
  const fields = [
    editorialField("title", position.title, "title", 180),
    editorialField("department", position.department, "proper_noun", 160),
    editorialField("locationLabel", position.locationLabel, "proper_noun", 240),
    editorialField("description", position.description, "paragraph", 5_000),
    editorialField(
      "whatsappMessage",
      position.whatsappMessage,
      "message",
      1_000
    ),
  ].filter(Boolean) as PublicCopyEditorialInput["fields"];
  return { fields, lists: [] };
}

function positionCopyFromRow(row: Record<string, any>) {
  return {
    title: row.title,
    department: row.department,
    locationLabel: row.location_label,
    description: row.description,
    whatsappMessage: row.whatsapp_message,
  };
}

function applyPositionEditorialCopy(
  position: Record<string, any>,
  validation: ValidatedPublicCopy
) {
  const field = (key: string, fallback: unknown) =>
    validation.fields[key] ?? fallback ?? null;
  return {
    ...position,
    title: field("title", position.title),
    department: field("department", position.department),
    locationLabel: field("locationLabel", position.locationLabel),
    description: field("description", position.description),
    whatsappMessage: field("whatsappMessage", position.whatsappMessage),
  };
}

async function normalizeStoredPosition(
  pool: DatabasePool,
  positionId: number,
  actorUserId: number | null
) {
  const current = await pool.query(
    `SELECT id,title,department,location_label,description,whatsapp_message
       FROM job_positions
      WHERE id=$1`,
    [positionId]
  );
  if (!current.rows[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plaza no encontrada." });
  }
  const position = positionCopyFromRow(current.rows[0]);
  const validation = await validateEntityPublicCopy(
    pool,
    "job_position",
    positionId,
    positionPublicCopyInput(position)
  );
  if (!validation.audit) return current.rows[0];
  const normalized = applyPositionEditorialCopy(position, validation);
  await pool.query(
    `UPDATE job_positions
        SET title=$1,department=$2,location_label=$3,description=$4,
            whatsapp_message=$5,updated_at=now()
      WHERE id=$6`,
    [
      normalized.title,
      normalized.department,
      normalized.locationLabel,
      normalized.description,
      normalized.whatsappMessage,
      positionId,
    ]
  );
  await recordEditorialValidation(
    pool,
    "job_position",
    positionId,
    actorUserId,
    validation
  );
  return { ...current.rows[0], ...normalized };
}

function formPublicCopyInput(form: Record<string, any>) {
  const fields = [
    editorialField("title", form.title, "title", 240),
    editorialField("intro", form.intro, "paragraph", 3_000),
  ].filter(Boolean) as PublicCopyEditorialInput["fields"];
  return { fields, lists: [] };
}

function applyFormEditorialCopy(
  form: Record<string, any>,
  validation: ValidatedPublicCopy
) {
  return {
    ...form,
    title: validation.fields.title ?? form.title,
    intro: validation.fields.intro ?? form.intro ?? null,
  };
}

function questionPublicCopyInput(question: Record<string, any>) {
  const answerConfig = question.answerConfig ?? question.answer_config ?? {};
  const options: string[] = Array.isArray(answerConfig.options)
    ? answerConfig.options.map(String)
    : [];
  const fields = [
    editorialField("label", question.label, "question", 5_000),
    editorialField(
      "helpText",
      question.helpText ?? question.help_text,
      "paragraph",
      600
    ),
    editorialField(
      "evaluationCriteria",
      question.evaluationCriteria ?? question.evaluation_criteria,
      "internal_criterion",
      2_000
    ),
    editorialField(
      "aiPrompt",
      question.aiPrompt ?? question.ai_prompt,
      "internal_criterion",
      2_000
    ),
    ...options.map((option, index) =>
      editorialField(`option.${index}`, option, "option", 500)
    ),
  ].filter(Boolean) as PublicCopyEditorialInput["fields"];
  return { fields, lists: [] };
}

function applyQuestionEditorialCopy(
  question: Record<string, any>,
  validation: ValidatedPublicCopy,
  keyPrefix = ""
) {
  const answerConfig = {
    ...(question.answerConfig ?? question.answer_config ?? {}),
  };
  const originalOptions: string[] = Array.isArray(answerConfig.options)
    ? answerConfig.options.map(String)
    : [];
  const optionKey = (index: number) => `${keyPrefix}option.${index}`;
  const normalizedOptions = originalOptions.map(
    (option, index) => validation.fields[optionKey(index)] ?? option
  );
  if (originalOptions.length) answerConfig.options = normalizedOptions;
  const originalAccepted =
    question.acceptedAnswers ?? question.accepted_answers ?? [];
  const acceptedAnswers = (
    Array.isArray(originalAccepted) ? originalAccepted : []
  ).map(answer => {
    if (typeof answer !== "string") return answer;
    const optionIndex = originalOptions.indexOf(answer);
    return optionIndex >= 0 ? normalizedOptions[optionIndex] : answer;
  });
  const field = (key: string, fallback: unknown) =>
    validation.fields[`${keyPrefix}${key}`] ?? fallback ?? null;
  return {
    ...question,
    label: field("label", question.label),
    helpText: field("helpText", question.helpText ?? question.help_text),
    evaluationCriteria: field(
      "evaluationCriteria",
      question.evaluationCriteria ?? question.evaluation_criteria
    ),
    aiPrompt: field("aiPrompt", question.aiPrompt ?? question.ai_prompt),
    answerConfig,
    acceptedAnswers,
  };
}

function formBundlePublicCopyInput(
  form: Record<string, any>,
  questions: Record<string, any>[]
) {
  const fields = [
    editorialField("form.title", form.title, "title"),
    editorialField("form.intro", form.intro, "paragraph"),
  ];
  for (const question of questions) {
    const prefix = `question.${question.id}.`;
    for (const field of questionPublicCopyInput(question).fields) {
      fields.push({ ...field, key: `${prefix}${field.key}` });
    }
  }
  return {
    fields: fields.filter(Boolean) as PublicCopyEditorialInput["fields"],
    lists: [],
  };
}

async function normalizeStoredFormBundle(
  pool: DatabasePool,
  formId: number,
  actorUserId: number | null
) {
  const formResult = await pool.query(
    `SELECT id,title,intro FROM application_forms WHERE id=$1`,
    [formId]
  );
  if (!formResult.rows[0]) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Formulario no encontrado.",
    });
  }
  const questionsResult = await pool.query(
    `SELECT id,label,help_text,evaluation_criteria,ai_prompt,
            answer_config,accepted_answers
       FROM form_questions
      WHERE form_id=$1
      ORDER BY order_index,id`,
    [formId]
  );
  const form = formResult.rows[0];
  const questions = questionsResult.rows;
  const validation = await validateEntityPublicCopy(
    pool,
    "application_form_bundle",
    formId,
    formBundlePublicCopyInput(form, questions)
  );
  if (!validation.audit) return;
  const normalizedForm = {
    title: validation.fields["form.title"] ?? form.title,
    intro: validation.fields["form.intro"] ?? form.intro,
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE application_forms SET title=$1,intro=$2,updated_at=now() WHERE id=$3`,
      [normalizedForm.title, normalizedForm.intro, formId]
    );
    for (const question of questions) {
      const normalized = applyQuestionEditorialCopy(
        question,
        validation,
        `question.${question.id}.`
      );
      await client.query(
        `UPDATE form_questions
            SET label=$1,help_text=$2,evaluation_criteria=$3,ai_prompt=$4,
                answer_config=$5::jsonb,accepted_answers=$6::jsonb
          WHERE id=$7`,
        [
          normalized.label,
          normalized.helpText,
          normalized.evaluationCriteria,
          normalized.aiPrompt,
          asJson(normalized.answerConfig),
          asJson(normalized.acceptedAnswers),
          question.id,
        ]
      );
    }
    await recordEditorialValidation(
      client,
      "application_form_bundle",
      formId,
      actorUserId,
      validation
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function normalizeStoredQuestion(
  pool: DatabasePool,
  row: Record<string, any>,
  actorUserId: number | null
) {
  const questionId = Number(row.id);
  const validation = await validateEntityPublicCopy(
    pool,
    "form_question",
    questionId,
    questionPublicCopyInput(row)
  );
  if (!validation.audit) return row;
  const normalized = applyQuestionEditorialCopy(row, validation);
  await pool.query(
    `UPDATE form_questions
        SET label=$1,help_text=$2,evaluation_criteria=$3,ai_prompt=$4,
            answer_config=$5::jsonb,accepted_answers=$6::jsonb
      WHERE id=$7`,
    [
      normalized.label,
      normalized.helpText,
      normalized.evaluationCriteria,
      normalized.aiPrompt,
      asJson(normalized.answerConfig),
      asJson(normalized.acceptedAnswers),
      questionId,
    ]
  );
  await recordEditorialValidation(
    pool,
    "form_question",
    questionId,
    actorUserId,
    validation
  );
  return { ...row, ...normalized };
}

async function normalizeLatestPositionForm(
  pool: DatabasePool,
  positionId: number,
  actorUserId: number | null
) {
  const form = await pool.query<{ id: number }>(
    `SELECT id FROM application_forms
      WHERE job_position_id=$1
      ORDER BY version DESC,id DESC
      LIMIT 1`,
    [positionId]
  );
  if (form.rows[0]) {
    await normalizeStoredFormBundle(pool, form.rows[0].id, actorUserId);
  }
}

function asJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function safeIntegrationMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes('relation "agent_user_assignments" does not exist')
  ) {
    return "La tabla de asignación responsable no existe. Aplique la migración 0014_cognitive_governance.sql en la base de datos.";
  }
  const allowedMessages = [
    "No existe una fuente estable para cifrar credenciales",
    "No existe una clave dedicada para cifrar credenciales",
    "AGENT_SETTINGS_ENCRYPTION_KEY debe contener al menos",
    "La API Key",
    "La OpenAI Responses API",
    "No hay una API key",
    "Configure las claves pública",
    "Configure y guarde las claves pública",
    "Configure una clave estable de seudonimización",
    "Active el envío de trazas Langfuse",
    "La región de Langfuse",
    "El ambiente de Langfuse",
    "El porcentaje de muestreo de Langfuse",
    "Langfuse rechazó",
    "No fue posible establecer conexión con la región de Langfuse",
    "No fue posible iniciar el procesador de trazas de Langfuse",
    "El procesador de Langfuse",
    "ApiChat no está configurado",
    "ApiChat rechazó la verificación",
    "La verificación integrada de ApiChat",
    "No fue posible establecer conexión con ApiChat",
    "Postulación no encontrada",
    "Esta postulación ya está siendo evaluada",
  ];
  if (allowedMessages.some(prefix => message.startsWith(prefix))) {
    return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[credencial protegida]");
  }
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: unknown }).status)
      : Number.NaN;
  return Number.isFinite(status) ? `${fallback} (HTTP ${status}).` : fallback;
}

export async function auditPublishedPublicCopy(pool: DatabasePool) {
  const lockClient = await pool.connect();
  let acquired = false;
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1,$2) AS acquired`,
      [1095320385, 20260910]
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return { audited: 0, failed: 0, skipped: true };

    const positions = await pool.query<{ id: number }>(
      `SELECT DISTINCT position.id
         FROM job_positions position
         JOIN application_forms form ON form.job_position_id=position.id
        WHERE position.published=true AND form.published=true
        ORDER BY position.id`
    );
    let audited = 0;
    let failed = 0;
    for (const position of positions.rows) {
      try {
        await normalizeStoredPosition(pool, position.id, null);
        await preparePositionProfileForPublication(pool, position.id, null);
        const forms = await pool.query<{ id: number }>(
          `SELECT id FROM application_forms
            WHERE job_position_id=$1 AND published=true
            ORDER BY version,id`,
          [position.id]
        );
        for (const form of forms.rows) {
          await normalizeStoredFormBundle(pool, form.id, null);
        }
        audited += 1;
      } catch (error) {
        failed += 1;
        console.warn(
          `[PublicCopyAudit] Position ${position.id} failed (${error instanceof Error ? error.name : "unknown"}).`
        );
      }
    }
    return { audited, failed, skipped: false };
  } finally {
    if (acquired) {
      await lockClient.query(
        `SELECT pg_advisory_unlock($1,$2)`,
        [1095320385, 20260910]
      );
    }
    lockClient.release();
  }
}

function requestIp(req: { ip?: string; headers: Record<string, unknown> }) {
  const forwarded = req.headers["x-forwarded-for"];
  return (
    String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || "")
      .split(",")[0]
      ?.trim()
      .slice(0, 80) || null
  );
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => {
      const user = opts.ctx.user;
      if (!user) return null;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        passwordChangeRequired: false,
      };
    }),
    requestLoginCode: publicProcedure
      .input(z.object({ email: z.string().email().max(320) }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const email = input.email.trim().toLowerCase();
        const result = await pool.query(
          `SELECT id,email FROM users WHERE lower(email)=lower($1) AND active=true LIMIT 1`,
          [email]
        );
        const user = result.rows[0];
        if (!user)
          return {
            success: true,
            email: maskEmail(email),
            expiresInMinutes: LOGIN_CODE_TTL_MINUTES,
            retryAfterSeconds: LOGIN_CODE_RESEND_SECONDS,
          };
        const recent = await pool.query(
          `SELECT created_at FROM login_code_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [user.id]
        );
        if (
          recent.rows[0] &&
          Date.now() - new Date(recent.rows[0].created_at).getTime() <
            LOGIN_CODE_RESEND_SECONDS * 1000
        ) {
          return {
            success: true,
            email: maskEmail(user.email),
            expiresInMinutes: LOGIN_CODE_TTL_MINUTES,
            retryAfterSeconds: LOGIN_CODE_RESEND_SECONDS,
          };
        }
        const code = createLoginCode();
        const codeHash = await hashLoginCode(code);
        await pool.query(
          `UPDATE login_code_challenges SET used_at=COALESCE(used_at,now()) WHERE user_id=$1 AND used_at IS NULL`,
          [user.id]
        );
        const challenge = await pool.query(
          `INSERT INTO login_code_challenges (user_id,code_hash,max_attempts,expires_at,requested_ip) VALUES ($1,$2,$3,now()+($4 * interval '1 minute'),$5) RETURNING id`,
          [
            user.id,
            codeHash,
            LOGIN_CODE_MAX_ATTEMPTS,
            LOGIN_CODE_TTL_MINUTES,
            requestIp(ctx.req),
          ]
        );
        try {
          await sendLoginCode({
            email: user.email,
            code,
            expiresInMinutes: LOGIN_CODE_TTL_MINUTES,
          });
        } catch (error) {
          await pool.query(
            `UPDATE login_code_challenges SET used_at=now() WHERE id=$1`,
            [challenge.rows[0].id]
          );
          console.error(
            "[Auth] SMTP login code delivery failed",
            error instanceof Error ? error.message : "unknown error"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "No fue posible enviar el código de acceso. Revise la configuración SMTP en EasyPanel.",
          });
        }
        return {
          success: true,
          email: maskEmail(user.email),
          expiresInMinutes: LOGIN_CODE_TTL_MINUTES,
          retryAfterSeconds: LOGIN_CODE_RESEND_SECONDS,
        };
      }),
    verifyLoginCode: publicProcedure
      .input(
        z.object({
          email: z.string().email().max(320),
          code: z.string().regex(/^\d{6}$/),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        let user: Record<string, any> | undefined;
        try {
          await client.query("BEGIN");
          const result = await client.query(
            `SELECT c.id,c.code_hash,c.attempts,c.max_attempts,c.expires_at,u.id AS user_id,u.name,u.email,u.role FROM login_code_challenges c JOIN users u ON u.id=c.user_id WHERE lower(u.email)=lower($1) AND u.active=true AND c.used_at IS NULL ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c`,
            [input.email.trim()]
          );
          const challenge = result.rows[0];
          const valid =
            challenge &&
            challenge.attempts < challenge.max_attempts &&
            new Date(challenge.expires_at).getTime() > Date.now() &&
            (await verifyLoginCode(input.code, challenge.code_hash));
          if (!valid) {
            if (challenge)
              await client.query(
                `UPDATE login_code_challenges SET attempts=attempts+1,used_at=CASE WHEN attempts+1>=max_attempts OR expires_at<=now() THEN now() ELSE used_at END WHERE id=$1`,
                [challenge.id]
              );
            await client.query("COMMIT");
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message:
                "El código es inválido, expiró o superó el máximo de intentos.",
            });
          }
          await client.query(
            `UPDATE login_code_challenges SET used_at=now() WHERE id=$1`,
            [challenge.id]
          );
          await client.query(
            `UPDATE users SET login_method='email_code',last_signed_in=now(),updated_at=now() WHERE id=$1`,
            [challenge.user_id]
          );
          await client.query("COMMIT");
          user = challenge;
        } catch (error) {
          if (!(error instanceof TRPCError)) await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        const token = await issueLocalSession(user!.user_id);
        setLocalSession(ctx.res, ctx.req, token);
        return {
          id: user!.user_id,
          name: user!.name,
          email: user!.email,
          role: user!.role,
          passwordChangeRequired: false,
        };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      if ((ctx.req.headers.cookie ?? "").includes("talento-claro-session="))
        clearLocalSession(ctx.res, ctx.req);
      return { success: true } as const;
    }),
  }),

  users: router({
    list: adminProcedure.query(async () => {
      const pool = await requirePool();
      const result = await pool.query(
        `SELECT id,name,email,role,active,created_at,updated_at,last_signed_in,password_change_required FROM users ORDER BY created_at DESC`
      );
      return result.rows;
    }),
    upsert: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          name: z.string().min(2).max(200),
          email: z.string().email(),
          role: z.enum(["admin", "reclutador"]),
          active: z.boolean().default(true),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const duplicate = await pool.query(
          `SELECT id FROM users WHERE lower(email)=lower($1) AND ($2::integer IS NULL OR id<>$2) LIMIT 1`,
          [input.email.trim(), input.id ?? null]
        );
        if (duplicate.rows[0])
          throw new TRPCError({
            code: "CONFLICT",
            message: "Ya existe un usuario con ese correo.",
          });
        if (input.id) {
          const result = await pool.query(
            `UPDATE users SET name=$1,email=$2,role=$3,active=$4,login_method='email_code',password_hash=NULL,password_change_required=false,updated_at=now() WHERE id=$5 RETURNING id,name,email,role,active`,
            [
              input.name,
              input.email.trim().toLowerCase(),
              input.role,
              input.active,
              input.id,
            ]
          );
          return result.rows[0];
        }
        const result = await pool.query(
          `INSERT INTO users (open_id,name,email,login_method,role,password_hash,password_change_required,active) VALUES ($1,$2,$3,'email_code',$4,NULL,false,$5) RETURNING id,name,email,role,active`,
          [
            `email:${input.email.toLowerCase()}`,
            input.name,
            input.email.trim().toLowerCase(),
            input.role,
            input.active,
          ]
        );
        return result.rows[0];
      }),
    setActive: adminProcedure
      .input(z.object({ id: z.number(), active: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        if (input.id === ctx.user.id)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No puede desactivar su propia cuenta.",
          });
        const pool = await requirePool();
        await pool.query(
          `UPDATE users SET active=$1,updated_at=now() WHERE id=$2`,
          [input.active, input.id]
        );
        return { success: true };
      }),
  }),

  profiles: router({
    list: adminProcedure
      .input(
        z
          .object({
            search: z.string().max(120).optional(),
            active: z.boolean().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const pool = await requirePool();
        const values: unknown[] = [];
        const clauses: string[] = [];
        if (input?.search) {
          values.push(`%${input.search}%`);
          clauses.push(
            `(p.name ILIKE $${values.length} OR p.summary ILIKE $${values.length} OR p.academic_level ILIKE $${values.length})`
          );
        }
        if (input?.active !== undefined) {
          values.push(input.active);
          clauses.push(`p.active=$${values.length}`);
        }
        const result = await pool.query(
          `SELECT p.*,
                  COALESCE(
                    array_agg(link.job_position_id ORDER BY link.job_position_id)
                      FILTER (WHERE link.job_position_id IS NOT NULL),
                    ARRAY[]::integer[]
                  ) AS position_ids
             FROM job_profiles p
             LEFT JOIN job_profile_positions link ON link.profile_id = p.id
             ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
            GROUP BY p.id
            ORDER BY p.updated_at DESC`,
          values
        );
        return result.rows;
      }),
    forPosition: adminProcedure
      .input(z.object({ positionId: z.number().int() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT p.* FROM job_profiles p JOIN job_profile_positions link ON link.profile_id=p.id WHERE link.job_position_id=$1 AND p.active=true ORDER BY p.updated_at DESC LIMIT 1`,
          [input.positionId]
        );
        return result.rows[0] ?? null;
      }),
    get: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT * FROM job_profiles WHERE id=$1`,
          [input.id]
        );
        if (!result.rows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Perfil laboral no encontrado.",
          });
        const positions = await pool.query(
          `SELECT job_position_id FROM job_profile_positions WHERE profile_id=$1`,
          [input.id]
        );
        return {
          ...result.rows[0],
          position_ids: positions.rows.map(row => row.job_position_id),
        };
      }),
    upsert: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          name: z.string().min(2).max(180),
          summary: z.string().max(2000).optional(),
          objective: z.string().max(5000).optional(),
          responsibilities: z.array(z.string().max(500)).default([]),
          requiredRequirements: z
            .array(z.string().max(500))
            .max(50)
            .default([]),
          technicalSkills: z.array(z.string().max(200)).default([]),
          softSkills: z.array(z.string().max(200)).default([]),
          knowledge: z.array(z.string().max(200)).default([]),
          academicLevel: z.string().max(120).optional(),
          experienceYearsMin: z.number().int().min(0).max(60).optional(),
          experienceYearsMax: z.number().int().min(0).max(60).optional(),
          languages: z.array(z.string().max(120)).default([]),
          licenses: z.array(z.string().max(200)).default([]),
          availability: z.string().max(1000).optional(),
          location: z.string().max(1000).optional(),
          salaryRange: z.string().max(160).optional(),
          workMode: z.string().max(80).optional(),
          aiCriteria: z.string().max(5000).optional(),
          active: z.boolean().default(true),
          positionIds: z.array(z.number().int()).default([]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const profileValidation = await validateEntityPublicCopy(
          pool,
          "job_profile",
          input.id,
          profilePublicCopyInput(input)
        );
        const normalizedInput = applyProfileEditorialCopy(
          input,
          profileValidation
        );
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const values = [
            normalizedInput.name,
            normalizedInput.summary ?? null,
            normalizedInput.objective ?? null,
            asJson(normalizedInput.responsibilities),
            asJson(normalizedInput.requiredRequirements),
            asJson(normalizedInput.technicalSkills),
            asJson(normalizedInput.softSkills),
            asJson(normalizedInput.knowledge),
            normalizedInput.academicLevel ?? null,
            input.experienceYearsMin ?? null,
            input.experienceYearsMax ?? null,
            asJson(normalizedInput.languages),
            asJson(normalizedInput.licenses),
            normalizedInput.availability ?? null,
            normalizedInput.location ?? null,
            normalizedInput.salaryRange ?? null,
            normalizedInput.workMode ?? null,
            normalizedInput.aiCriteria ?? null,
            input.active,
          ];
          let result;
          if (input.id)
            result = await client.query(
              `UPDATE job_profiles SET name=$1,summary=$2,objective=$3,responsibilities=$4::jsonb,required_requirements=$5::jsonb,technical_skills=$6::jsonb,soft_skills=$7::jsonb,knowledge=$8::jsonb,academic_level=$9,experience_years_min=$10,experience_years_max=$11,languages=$12::jsonb,licenses=$13::jsonb,availability=$14,location=$15,salary_range=$16,work_mode=$17,ai_criteria=$18,active=$19,updated_at=now() WHERE id=$20 RETURNING *`,
              [...values, input.id]
            );
          else
            result = await client.query(
              `INSERT INTO job_profiles (name,summary,objective,responsibilities,required_requirements,technical_skills,soft_skills,knowledge,academic_level,experience_years_min,experience_years_max,languages,licenses,availability,location,salary_range,work_mode,ai_criteria,active,created_by_user_id) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
              [...values, ctx.user.id]
            );
          const profileId = result.rows[0].id;
          await recordEditorialValidation(
            client,
            "job_profile",
            profileId,
            ctx.user.id,
            profileValidation
          );
          await client.query(
            `DELETE FROM job_profile_positions WHERE profile_id=$1`,
            [profileId]
          );
          for (const positionId of input.positionIds)
            await client.query(
              `INSERT INTO job_profile_positions (profile_id,job_position_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
              [profileId, positionId]
            );
          await client.query("COMMIT");
          return result.rows[0];
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    setActive: adminProcedure
      .input(z.object({ id: z.number(), active: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        if (input.active) {
          const current = await pool.query(
            `SELECT * FROM job_profiles WHERE id=$1`,
            [input.id]
          );
          if (!current.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Perfil laboral no encontrado.",
            });
          }
          await normalizeStoredProfile(pool, current.rows[0], ctx.user.id);
        }
        await pool.query(
          `UPDATE job_profiles SET active=$1,updated_at=now() WHERE id=$2`,
          [input.active, input.id]
        );
        return { success: true };
      }),
    remove: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        await pool.query(
          `UPDATE job_profiles SET active=false,updated_at=now() WHERE id=$1`,
          [input.id]
        );
        return { success: true };
      }),
  }),

  publicJobs: router({
    listPublished: publicProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return [];

      const result = await pool.query(
        `SELECT p.id,
                p.public_slug,
                p.title,
                p.department,
                p.location_label,
                p.description,
                p.created_at,
                profile.name AS profile_name,
                profile.objective AS profile_objective,
                profile.required_requirements,
                profile.academic_level,
                COALESCE(NULLIF(profile.location, ''), NULLIF(p.location_label, ''), NULLIF(p.department, ''), 'Guatemala') AS display_location
           FROM job_positions p
           JOIN LATERAL (
             SELECT f.id
               FROM application_forms f
              WHERE f.job_position_id = p.id
                AND f.published = true
              ORDER BY f.version DESC, f.id DESC
              LIMIT 1
           ) published_form ON true
           JOIN LATERAL (
             SELECT jp.name, jp.objective, jp.required_requirements, jp.academic_level, jp.location
               FROM job_profile_positions link
               JOIN job_profiles jp ON jp.id = link.profile_id
              WHERE link.job_position_id = p.id
                AND jp.active = true
                AND NULLIF(BTRIM(COALESCE(jp.objective, '')), '') IS NOT NULL
                AND jsonb_array_length(COALESCE(jp.responsibilities, '[]'::jsonb)) > 0
                AND jsonb_array_length(COALESCE(jp.required_requirements, '[]'::jsonb)) > 0
              ORDER BY jp.updated_at DESC, jp.id DESC
              LIMIT 1
           ) profile ON true
          WHERE p.published = true
          ORDER BY
            CASE WHEN LOWER(BTRIM(p.title)) = LOWER($1) THEN 0 ELSE 1 END,
            p.created_at DESC,
            p.id DESC
          LIMIT 100`,
        [featuredPublicPositionTitle]
      );

      return result.rows.map(row => ({
        id: row.id as number,
        token: row.public_slug as string,
        title: row.title as string,
        department: row.department as string | null,
        locationLabel: row.location_label as string | null,
        description: row.description as string | null,
        profileName: row.profile_name as string | null,
        profileObjective: row.profile_objective as string,
        requiredRequirements: (Array.isArray(row.required_requirements)
          ? (row.required_requirements as unknown[])
          : []
        ).filter(
          (requirement: unknown): requirement is string =>
            typeof requirement === "string" && requirement.trim().length > 0
        ),
        academicLevel: row.academic_level as string | null,
        displayLocation: row.display_location as string,
      }));
    }),
    getByToken: publicProcedure
      .input(z.object({ token: z.string().min(8).max(120) }))
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return null;
        const result = await pool.query(
          `SELECT p.id, p.public_slug, p.title, p.department, p.location_label, p.description, p.agent_key,
                f.id AS form_id, f.title AS form_title, f.intro AS form_intro,
                profile.responsibilities,
                q.id AS question_id, q.field_key, q.label, q.help_text, q.type, q.required,
                q.order_index, q.answer_config, q.accepted_answers, q.hard_fail, q.evaluation_criteria
           FROM job_positions p
           JOIN LATERAL (
             SELECT published.id, published.title, published.intro
               FROM application_forms published
              WHERE published.job_position_id = p.id
                AND published.published = true
              ORDER BY published.version DESC, published.id DESC
              LIMIT 1
           ) f ON true
           JOIN LATERAL (
             SELECT jp.responsibilities
               FROM job_profile_positions link
               JOIN job_profiles jp ON jp.id = link.profile_id
              WHERE link.job_position_id = p.id
                AND jp.active = true
                AND NULLIF(BTRIM(COALESCE(jp.objective, '')), '') IS NOT NULL
                AND jsonb_array_length(COALESCE(jp.responsibilities, '[]'::jsonb)) > 0
                AND jsonb_array_length(COALESCE(jp.required_requirements, '[]'::jsonb)) > 0
              ORDER BY jp.updated_at DESC, jp.id DESC
              LIMIT 1
           ) profile ON true
           JOIN form_questions q ON q.form_id = f.id AND q.active = true
          WHERE p.public_slug = $1 AND p.published = true
          ORDER BY q.order_index ASC`,
          [input.token]
        );
        if (!result.rows.length) return null;
        const first = result.rows[0];
        return {
          id: first.id,
          token: first.public_slug,
          title: first.title,
          department: first.department,
          locationLabel: first.location_label,
          description: first.description,
          agentKey: first.agent_key,
          responsibilities: (Array.isArray(first.responsibilities)
            ? (first.responsibilities as unknown[])
            : []
          ).filter(
            (responsibility: unknown): responsibility is string =>
              typeof responsibility === "string" &&
              responsibility.trim().length > 0
          ),
          form: {
            id: first.form_id,
            title: first.form_title,
            intro: first.form_intro,
          },
          questions: result.rows.map(row => ({
            id: row.question_id,
            fieldKey: row.field_key,
            label: row.label,
            helpText: row.help_text,
            type: row.type,
            required: row.required,
            orderIndex: row.order_index,
            answerConfig: row.answer_config ?? {},
            acceptedAnswers: row.accepted_answers ?? [],
            hardFail: row.hard_fail,
          })),
        };
      }),
    submit: publicProcedure
      .input(
        z.object({
          token: z.string().min(8).max(120),
          fullName: z.string().trim().min(2).max(240),
          email: z.string().email().max(320).optional().or(z.literal("")),
          phone: z.string().min(7).max(40),
          location: z.object({
            zoneId: z.number().int().positive(),
            departmentId: z.number().int().positive(),
            municipalityId: z.number().int().positive(),
          }),
          consents: z
            .object({
              adultConfirmed: requiredApplicationConfirmation,
              informationTruthful: requiredApplicationConfirmation,
              privacyAccepted: requiredApplicationConfirmation,
            })
            .strict(),
          answers: z.record(z.string(), z.unknown()),
        })
      )
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const phone = normalizePhone(input.phone, "GT");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const location = await resolveApplicationLocation(
            client,
            input.location
          );
          const positionResult = await client.query(
            `SELECT p.id, f.id AS form_id FROM job_positions p
             JOIN application_forms f ON f.job_position_id = p.id AND f.published = true
            WHERE p.public_slug = $1 AND p.published = true LIMIT 1`,
            [input.token]
          );
          if (!positionResult.rows[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "La plaza no está publicada o ya no está disponible.",
            });
          const position = positionResult.rows[0];
          const duplicate = await client.query(
            `SELECT a.id FROM applications a JOIN candidates c ON c.id = a.candidate_id
            WHERE c.phone_international = $1 AND a.job_position_id = $2 LIMIT 1`,
            [phone.e164, position.id]
          );
          if (duplicate.rows[0]) {
            await client.query("ROLLBACK");
            return {
              alreadyApplied: true as const,
              message:
                "Esta solicitud ya fue enviada previamente para esta plaza.",
            };
          }
          const candidate = await client.query(
            `INSERT INTO candidates (phone_international, phone_country, full_name, email)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (phone_international) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, updated_at = now()
           RETURNING id`,
            [phone.e164, phone.country, input.fullName, input.email || null]
          );
          const application = await client.query(
            `INSERT INTO applications (
               candidate_id,job_position_id,form_id,
               location_zone_id,location_department_id,location_municipality_id,status
             ) VALUES ($1,$2,$3,$4,$5,$6,'en_revision') RETURNING id`,
            [
              candidate.rows[0].id,
              position.id,
              position.form_id,
              location.zoneId,
              location.departmentId,
              location.municipalityId,
            ]
          );
          const questions = await client.query(
            `SELECT id,field_key,required,type,answer_config FROM form_questions WHERE form_id = $1 AND active = true`,
            [position.form_id]
          );
          for (const question of questions.rows) {
            const value = input.answers[question.field_key];
            if (
              question.required &&
              (value === undefined ||
                value === null ||
                String(value).trim() === "")
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `La respuesta ${question.field_key} es obligatoria.`,
              });
            if (value === undefined) continue;
            const options = Array.isArray(question.answer_config?.options)
              ? question.answer_config.options.map(String)
              : [];
            if (
              question.type === "select" &&
              options.length &&
              !options.includes(String(value))
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `La respuesta seleccionada para ${question.field_key} no es válida.`,
              });
            await client.query(
              `INSERT INTO application_answers (application_id, question_id, value_json, normalized_value)
             VALUES ($1, $2, $3::jsonb, $4)`,
              [
                application.rows[0].id,
                question.id,
                asJson(input.answers[question.field_key]),
                String(input.answers[question.field_key] ?? ""),
              ]
            );
          }
          await client.query(
            `INSERT INTO audit_log
               (actor_user_id,entity_type,entity_id,action,before_json,after_json,comment)
             VALUES (NULL,'application',$1,'application_consents_confirmed',NULL,$2::jsonb,$3)`,
            [
              application.rows[0].id,
              asJson({
                version: APPLICATION_CONSENT_VERSION,
                confirmations: APPLICATION_CONSENTS.map(consent => ({
                  id: consent.id,
                  text: consent.text,
                  accepted: input.consents[consent.id],
                })),
              }),
              "Confirmaciones obligatorias aceptadas durante la postulación pública.",
            ]
          );
          await client.query("COMMIT");
          const applicationId = application.rows[0].id as number;
          setImmediate(() => {
            void evaluateApplicationWithAgent(pool, applicationId).catch(
              error => {
                const message = safeIntegrationMessage(
                  error,
                  "No fue posible ejecutar la evaluación automática."
                );
                if (
                  !message.includes("no está habilitada") &&
                  !message.includes("No hay una API key")
                ) {
                  console.warn(
                    `[Agent] Application ${applicationId}: ${message}`
                  );
                }
              }
            );
          });
          return {
            alreadyApplied: false as const,
            applicationId,
            phone: phone.e164,
          };
        } catch (error) {
          await client.query("ROLLBACK");
          if (error instanceof TRPCError) throw error;
          if ((error as { code?: string }).code === "23505")
            return {
              alreadyApplied: true as const,
              message:
                "Esta solicitud ya fue enviada previamente para esta plaza.",
            };
          throw error;
        } finally {
          client.release();
        }
      }),
  }),

  dashboard: router({
    summary: roleProcedure.query(async () => {
      const pool = await getPool();
      if (!pool)
        return {
          total: 0,
          enRevision: 0,
          calificados: 0,
          calificadosAisa: 0,
          entrevistas: 0,
          positions: 0,
        };
      const result = await pool.query(`SELECT
        (SELECT count(*)::int FROM applications) AS total,
        (SELECT count(*)::int FROM applications WHERE status = 'en_revision') AS en_revision,
        (SELECT count(*)::int FROM applications WHERE status = 'calificado') AS calificados,
        (SELECT count(*)::int FROM applications WHERE status = 'calificado_aisa') AS calificados_aisa,
        (SELECT count(*)::int FROM applications WHERE status IN ('entrevista_iniciada','entrevista_en_curso','entrevista_finalizada')) AS entrevistas,
        (SELECT count(*)::int FROM job_positions) AS positions`);
      const row = result.rows[0];
      return {
        total: row.total ?? 0,
        enRevision: row.en_revision ?? 0,
        calificados: row.calificados ?? 0,
        calificadosAisa: row.calificados_aisa ?? 0,
        entrevistas: row.entrevistas ?? 0,
        positions: row.positions ?? 0,
      };
    }),
  }),

  activity: router({
    overview: roleProcedure
      .input(
        z
          .object({
            pagePath: z.string().trim().max(240).optional(),
            limit: z.number().int().min(1).max(200).optional(),
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          })
          .optional()
      )
      .query(async ({ input }) =>
        getActivityOverview(await requirePool(), input ?? {})
      ),
    record: roleProcedure
      .input(
        z.object({
          pagePath: z
            .string()
            .trim()
            .min(6)
            .max(240)
            .regex(/^\/admin(?:\/|$)/),
          eventType: z.enum(["page_opened", "work_started"]),
          correlationId: z
            .string()
            .trim()
            .min(16)
            .max(80)
            .regex(/^[a-zA-Z0-9:_-]+$/),
        })
      )
      .mutation(async ({ input, ctx }) =>
        recordAdminActivity(await requirePool(), {
          ...input,
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email ?? null,
        })
      ),
    assignment: adminProcedure.query(async () =>
      getJarviAssignment(await requirePool())
    ),
    assignJarvi: adminProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await assignJarviUser(
            await requirePool(),
            input.userId,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible asignar el responsable de JARVI HR."
            ),
          });
        }
      }),
  }),

  positions: router({
    list: roleProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return [];
      const result =
        await pool.query(`SELECT p.*, f.id AS form_id, f.title AS form_title, f.published AS form_published,
        (SELECT count(*)::int FROM applications a WHERE a.job_position_id = p.id) AS applications_count
        FROM job_positions p LEFT JOIN application_forms f ON f.job_position_id = p.id ORDER BY p.created_at DESC`);
      return result.rows;
    }),
    upsert: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          code: z.string().min(2).max(80),
          title: z.string().min(2).max(180),
          department: z.string().max(160).optional(),
          locationLabel: z.string().max(240).optional(),
          description: z.string().max(5000).optional(),
          agentKey: z.string().min(2).max(120),
          whatsappMessage: z.string().max(1000).optional(),
          defaultCountry: z.string().length(2).default("GT"),
          published: z.boolean().default(false),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const positionValidation = await validateEntityPublicCopy(
          pool,
          "job_position",
          input.id,
          positionPublicCopyInput(input)
        );
        const normalizedInput = applyPositionEditorialCopy(
          input,
          positionValidation
        );
        if (input.published) {
          if (!input.id) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "La plaza requiere un perfil activo con objetivo, responsabilidades y requisitos obligatorios antes de publicarse.",
            });
          }
          await preparePositionProfileForPublication(
            pool,
            input.id,
            ctx.user.id
          );
          await normalizeLatestPositionForm(pool, input.id, ctx.user.id);
        }
        const publicSlug = input.id
          ? undefined
          : `${input.code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
        if (input.id) {
          const result = await pool.query(
            `UPDATE job_positions SET code=$1,title=$2,department=$3,location_label=$4,description=$5,agent_key=$6,whatsapp_message=$7,default_country=$8,published=$9,updated_at=now() WHERE id=$10 RETURNING *`,
            [
              input.code,
              normalizedInput.title,
              normalizedInput.department ?? null,
              normalizedInput.locationLabel ?? null,
              normalizedInput.description ?? null,
              input.agentKey,
              normalizedInput.whatsappMessage ?? null,
              input.defaultCountry,
              input.published,
              input.id,
            ]
          );
          await recordEditorialValidation(
            pool,
            "job_position",
            input.id,
            ctx.user.id,
            positionValidation
          );
          return result.rows[0];
        }
        const result = await pool.query(
          `INSERT INTO job_positions (public_slug,code,title,department,location_label,description,agent_key,whatsapp_message,default_country,published,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            publicSlug,
            input.code,
            normalizedInput.title,
            normalizedInput.department ?? null,
            normalizedInput.locationLabel ?? null,
            normalizedInput.description ?? null,
            input.agentKey,
            normalizedInput.whatsappMessage ?? null,
            input.defaultCountry,
            input.published,
            ctx.user.id,
          ]
        );
        await pool.query(
          `INSERT INTO application_forms (job_position_id,version,title,intro,published,created_by_user_id) VALUES ($1,1,$2,$3,false,$4)`,
          [
            result.rows[0].id,
            `Formulario · ${normalizedInput.title}`,
            "Complete sus datos para postularse a esta plaza.",
            ctx.user.id,
          ]
        );
        await recordEditorialValidation(
          pool,
          "job_position",
          result.rows[0].id,
          ctx.user.id,
          positionValidation
        );
        return result.rows[0];
      }),
    setPublished: adminProcedure
      .input(z.object({ id: z.number(), published: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        if (input.published) {
          await preparePositionProfileForPublication(
            pool,
            input.id,
            ctx.user.id
          );
          await normalizeStoredPosition(pool, input.id, ctx.user.id);
          await normalizeLatestPositionForm(pool, input.id, ctx.user.id);
        }
        const result = await pool.query(
          `UPDATE job_positions SET published=$1,updated_at=now() WHERE id=$2 RETURNING *`,
          [input.published, input.id]
        );
        return result.rows[0];
      }),
    remove: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        await pool.query(`DELETE FROM job_positions WHERE id=$1`, [input.id]);
        return { success: true };
      }),
  }),

  inbox: router({
    list: roleProcedure
      .input(
        z
          .object({
            search: z.string().trim().max(120).optional(),
            applicationId: z.number().int().positive().optional(),
            positionId: z.number().int().positive().optional(),
            automationState: z
              .enum(["agent", "handoff_pending", "human", "completed", "error"])
              .optional(),
            timeRange: z.enum(["hour", "all"]).optional(),
            limit: z.number().int().min(1).max(30).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => listInbox(await requirePool(), input ?? {})),
    detail: roleProcedure
      .input(z.object({ conversationId: z.number().int().positive() }))
      .query(async ({ input }) =>
        inboxDetail(await requirePool(), input.conversationId)
      ),
    setAutomation: roleProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          nextState: z.enum(["agent", "human"]),
          override: z.boolean().default(false),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await setInboxAutomation(await requirePool(), {
            ...input,
            actorUserId: ctx.user.id,
            actorRole: ctx.user.role,
          });
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible cambiar el control de la conversación."
            ),
          });
        }
      }),
    sendText: roleProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          text: z.string().trim().min(1).max(3_000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await sendInboxText(await requirePool(), {
            ...input,
            actorUserId: ctx.user.id,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible enviar el mensaje."
            ),
          });
        }
      }),
    sendLink: roleProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          link: z.string().url().max(2_000),
          caption: z.string().trim().max(1_000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await sendInboxLink(await requirePool(), {
            ...input,
            actorUserId: ctx.user.id,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible enviar el enlace."
            ),
          });
        }
      }),
    sendLocation: roleProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          address: z.string().trim().max(300).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await sendInboxLocation(await requirePool(), {
            ...input,
            actorUserId: ctx.user.id,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible enviar la ubicación."
            ),
          });
        }
      }),
    sendFile: roleProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          fileUrl: z.string().url().max(2_000),
          fileName: z.string().trim().max(260).optional(),
          caption: z.string().trim().max(1_000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await sendInboxFile(await requirePool(), {
            ...input,
            actorUserId: ctx.user.id,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible enviar el archivo."
            ),
          });
        }
      }),
    sendPtt: roleProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          audioUrl: z.string().url().max(2_000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await sendInboxPtt(await requirePool(), {
            ...input,
            actorUserId: ctx.user.id,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible enviar la nota de voz."
            ),
          });
        }
      }),
    deleteMessage: roleProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          messageId: z.number().int().positive(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await deleteInboxMessage(await requirePool(), {
            ...input,
            actorUserId: ctx.user.id,
            actorRole: ctx.user.role,
          });
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible eliminar el mensaje."
            ),
          });
        }
      }),
  }),

  assessments: router({
    governance: roleProcedure.query(() => ({
      rules: ASSESSMENT_GOVERNANCE_RULES,
      total: ASSESSMENT_GOVERNANCE_RULES.length,
    })),
    list: roleProcedure
      .input(
        z
          .object({
            positionId: z.number().int().positive().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT protocol.*,position.title AS position_title,
                  count(item.id)::int AS item_count,
                  count(item.id) FILTER (WHERE item.active)::int AS active_item_count
             FROM assessment_protocols protocol
             JOIN job_positions position ON position.id=protocol.job_position_id
             LEFT JOIN assessment_items item ON item.protocol_id=protocol.id
            WHERE ($1::integer IS NULL OR protocol.job_position_id=$1)
            GROUP BY protocol.id,position.title
            ORDER BY position.title,protocol.name,protocol.version DESC`,
          [input?.positionId ?? null]
        );
        return result.rows;
      }),
    detail: roleProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const protocol = await pool.query(
          `SELECT protocol.*,position.title AS position_title
             FROM assessment_protocols protocol
             JOIN job_positions position ON position.id=protocol.job_position_id
            WHERE protocol.id=$1 LIMIT 1`,
          [input.id]
        );
        if (!protocol.rows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El protocolo de prueba no existe.",
          });
        const items = await pool.query(
          `SELECT * FROM assessment_items WHERE protocol_id=$1
            ORDER BY order_index,id`,
          [input.id]
        );
        return { protocol: protocol.rows[0], items: items.rows };
      }),
    upsertProtocol: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          jobPositionId: z.number().int().positive(),
          name: z.string().trim().min(3).max(180),
          level: z.enum(assessmentLevelValues),
          assessmentType: z.enum([
            "competencias",
            "conocimiento",
            "psicometrica_validada",
          ]),
          executionMode: z.enum(["esperar_respuesta", "evaluacion_inmediata"]),
          greeting: z.string().trim().max(2_000).optional(),
          farewell: z.string().trim().max(2_000).optional(),
          methodology: z.string().trim().max(12_000).optional(),
          validationEvidence: z.string().trim().max(12_000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SELECT pg_advisory_xact_lock(131,$1)`, [
            input.jobPositionId,
          ]);
          let result;
          if (input.id) {
            const current = await client.query(
              `SELECT * FROM assessment_protocols WHERE id=$1 FOR UPDATE`,
              [input.id]
            );
            if (!current.rows[0])
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "El protocolo de prueba no existe.",
              });
            if (current.rows[0].status === "activo") {
              const version = await client.query(
                `SELECT COALESCE(max(version),0)::int+1 AS next_version
                   FROM assessment_protocols
                  WHERE job_position_id=$1 AND lower(name)=lower($2)`,
                [input.jobPositionId, input.name]
              );
              result = await client.query(
                `INSERT INTO assessment_protocols
                   (job_position_id,name,level,assessment_type,version,status,
                    execution_mode,greeting,farewell,methodology,validation_evidence,
                    created_by_user_id,updated_by_user_id)
                 VALUES ($1,$2,$3,$4,$5,'borrador',$6,$7,$8,$9,$10,$11,$11)
                 RETURNING *`,
                [
                  input.jobPositionId,
                  input.name,
                  input.level,
                  input.assessmentType,
                  version.rows[0].next_version,
                  input.executionMode,
                  input.greeting ?? null,
                  input.farewell ?? null,
                  input.methodology ?? null,
                  input.validationEvidence ?? null,
                  ctx.user.id,
                ]
              );
              await client.query(
                `INSERT INTO assessment_items
                   (protocol_id,order_index,prompt,agent_instruction,evaluation_criterion,active)
                 SELECT $1,order_index,prompt,agent_instruction,evaluation_criterion,active
                   FROM assessment_items WHERE protocol_id=$2`,
                [result.rows[0].id, input.id]
              );
            } else {
              result = await client.query(
                `UPDATE assessment_protocols
                    SET job_position_id=$1,name=$2,level=$3,assessment_type=$4,
                        execution_mode=$5,greeting=$6,farewell=$7,methodology=$8,
                        validation_evidence=$9,updated_by_user_id=$10,updated_at=now()
                  WHERE id=$11 RETURNING *`,
                [
                  input.jobPositionId,
                  input.name,
                  input.level,
                  input.assessmentType,
                  input.executionMode,
                  input.greeting ?? null,
                  input.farewell ?? null,
                  input.methodology ?? null,
                  input.validationEvidence ?? null,
                  ctx.user.id,
                  input.id,
                ]
              );
            }
          } else {
            const version = await client.query(
              `SELECT COALESCE(max(version),0)::int+1 AS next_version
                 FROM assessment_protocols
                WHERE job_position_id=$1 AND lower(name)=lower($2)`,
              [input.jobPositionId, input.name]
            );
            result = await client.query(
              `INSERT INTO assessment_protocols
                 (job_position_id,name,level,assessment_type,version,status,
                  execution_mode,greeting,farewell,methodology,validation_evidence,
                  created_by_user_id,updated_by_user_id)
               VALUES ($1,$2,$3,$4,$5,'borrador',$6,$7,$8,$9,$10,$11,$11)
               RETURNING *`,
              [
                input.jobPositionId,
                input.name,
                input.level,
                input.assessmentType,
                version.rows[0].next_version,
                input.executionMode,
                input.greeting ?? null,
                input.farewell ?? null,
                input.methodology ?? null,
                input.validationEvidence ?? null,
                ctx.user.id,
              ]
            );
          }
          await client.query(
            `INSERT INTO audit_log
               (actor_user_id,entity_type,entity_id,action,after_json)
             VALUES ($1,'assessment_protocol',$2,'protocol_saved',$3::jsonb)`,
            [
              ctx.user.id,
              result.rows[0].id,
              asJson({
                version: result.rows[0].version,
                status: result.rows[0].status,
                level: result.rows[0].level,
              }),
            ]
          );
          await client.query("COMMIT");
          return result.rows[0];
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    upsertItem: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          protocolId: z.number().int().positive(),
          prompt: z.string().trim().min(8).max(2_000),
          agentInstruction: z.string().trim().min(8).max(4_000),
          evaluationCriterion: z.string().trim().min(8).max(4_000),
          active: z.boolean().default(true),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const protocol = await pool.query(
          `SELECT status FROM assessment_protocols WHERE id=$1`,
          [input.protocolId]
        );
        if (!protocol.rows[0])
          throw new TRPCError({ code: "NOT_FOUND", message: "El protocolo no existe." });
        if (protocol.rows[0].status === "activo")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Una versión activa es inmutable; guarde primero una versión nueva.",
          });
        const result = input.id
          ? await pool.query(
              `UPDATE assessment_items
                  SET prompt=$1,agent_instruction=$2,evaluation_criterion=$3,
                      active=$4,updated_at=now()
                WHERE id=$5 AND protocol_id=$6 RETURNING *`,
              [
                input.prompt,
                input.agentInstruction,
                input.evaluationCriterion,
                input.active,
                input.id,
                input.protocolId,
              ]
            )
          : await pool.query(
              `INSERT INTO assessment_items
                 (protocol_id,order_index,prompt,agent_instruction,evaluation_criterion,active)
               SELECT $1,COALESCE(max(order_index),-1)+1,$2,$3,$4,$5
                 FROM assessment_items WHERE protocol_id=$1 RETURNING *`,
              [
                input.protocolId,
                input.prompt,
                input.agentInstruction,
                input.evaluationCriterion,
                input.active,
              ]
            );
        if (!result.rows[0])
          throw new TRPCError({ code: "NOT_FOUND", message: "La pregunta no existe." });
        await pool.query(
          `INSERT INTO audit_log
             (actor_user_id,entity_type,entity_id,action,after_json)
           VALUES ($1,'assessment_protocol',$2,'assessment_item_saved',$3::jsonb)`,
          [
            ctx.user.id,
            input.protocolId,
            asJson({ itemId: result.rows[0].id, active: result.rows[0].active }),
          ]
        );
        return result.rows[0];
      }),
    reorderItems: adminProcedure
      .input(
        z.object({
          protocolId: z.number().int().positive(),
          orderedIds: z.array(z.number().int().positive()).min(1).max(200),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (new Set(input.orderedIds).size !== input.orderedIds.length)
          throw new TRPCError({ code: "BAD_REQUEST", message: "El orden contiene identificadores duplicados." });
        const pool = await requirePool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const protocol = await client.query(
            `SELECT status FROM assessment_protocols WHERE id=$1 FOR UPDATE`,
            [input.protocolId]
          );
          if (protocol.rows[0]?.status === "activo")
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Una versión activa es inmutable." });
          const current = await client.query(
            `SELECT id FROM assessment_items WHERE protocol_id=$1 ORDER BY order_index,id`,
            [input.protocolId]
          );
          const currentIds = current.rows.map(row => row.id).sort((a, b) => a - b);
          const requestedIds = [...input.orderedIds].sort((a, b) => a - b);
          if (JSON.stringify(currentIds) !== JSON.stringify(requestedIds))
            throw new TRPCError({ code: "BAD_REQUEST", message: "El orden debe incluir todas las preguntas una sola vez." });
          await client.query(
            `UPDATE assessment_items
                SET order_index=order_index+1000000,updated_at=now()
              WHERE protocol_id=$1`,
            [input.protocolId]
          );
          for (let orderIndex = 0; orderIndex < input.orderedIds.length; orderIndex += 1) {
            const id = input.orderedIds[orderIndex];
            await client.query(
              `UPDATE assessment_items SET order_index=$1,updated_at=now()
                WHERE id=$2 AND protocol_id=$3`,
              [orderIndex, id, input.protocolId]
            );
          }
          await client.query(
            `INSERT INTO audit_log
               (actor_user_id,entity_type,entity_id,action,after_json)
             VALUES ($1,'assessment_protocol',$2,'assessment_items_reordered',$3::jsonb)`,
            [ctx.user.id, input.protocolId, asJson({ itemCount: input.orderedIds.length })]
          );
          await client.query("COMMIT");
          return { success: true as const };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    activate: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const readiness = await pool.query(
          `SELECT protocol.*,
                  count(item.id) FILTER (WHERE item.active)::int AS active_items
             FROM assessment_protocols protocol
             LEFT JOIN assessment_items item ON item.protocol_id=protocol.id
            WHERE protocol.id=$1 GROUP BY protocol.id`,
          [input.id]
        );
        const protocol = readiness.rows[0];
        if (!protocol)
          throw new TRPCError({ code: "NOT_FOUND", message: "El protocolo no existe." });
        if (
          Number(protocol.active_items) < 1 ||
          String(protocol.methodology ?? "").trim().length < 100 ||
          String(protocol.validation_evidence ?? "").trim().length < 100
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "La activación exige preguntas habilitadas y evidencia metodológica y de validación de al menos 100 caracteres cada una.",
          });
        }
        if (protocol.assessment_type === "psicometrica_validada") {
          const missingTerms = missingPsychometricEvidenceTerms(
            String(protocol.validation_evidence ?? "")
          );
          if (
            String(protocol.validation_evidence ?? "").trim().length < 500 ||
            missingTerms.length
          ) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `La denominación psicométrica exige evidencia de al menos 500 caracteres que documente: ${missingTerms.length ? missingTerms.join(", ") : "constructo, validez, confiabilidad, población, equidad, estandarización y aprobación"}.`,
            });
          }
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SELECT pg_advisory_xact_lock(132,$1)`, [
            protocol.job_position_id,
          ]);
          const locked = await client.query(
            `SELECT id,job_position_id,name,version,status
               FROM assessment_protocols WHERE id=$1 FOR UPDATE`,
            [input.id]
          );
          if (!locked.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "El protocolo no existe.",
            });
          }
          await client.query(
            `UPDATE assessment_protocols
                SET status='retirado',updated_by_user_id=$1,updated_at=now()
              WHERE job_position_id=$2 AND lower(name)=lower($3)
                AND status='activo' AND id<>$4`,
            [
              ctx.user.id,
              locked.rows[0].job_position_id,
              locked.rows[0].name,
              input.id,
            ]
          );
          const result = await client.query(
            `UPDATE assessment_protocols
                SET status='activo',updated_by_user_id=$1,updated_at=now()
              WHERE id=$2 RETURNING *`,
            [ctx.user.id, input.id]
          );
          await client.query(
            `INSERT INTO audit_log
               (actor_user_id,entity_type,entity_id,action,after_json)
             VALUES ($1,'assessment_protocol',$2,'protocol_activated',$3::jsonb)`,
            [
              ctx.user.id,
              input.id,
              asJson({
                version: protocol.version,
                activeItems: protocol.active_items,
                previousActiveRetired: true,
              }),
            ]
          );
          await client.query("COMMIT");
          return result.rows[0];
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    requestDeleteCode: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const target = await pool.query(
          `SELECT id,name,version,status FROM assessment_protocols WHERE id=$1 LIMIT 1`,
          [input.id]
        );
        const protocol = target.rows[0];
        if (!protocol)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El protocolo de prueba no existe.",
          });
        if (protocol.status === "activo")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Una versión activa no puede eliminarse; retire primero su activación.",
          });
        const sessions = await pool.query(
          `SELECT 1 FROM assessment_sessions WHERE protocol_id=$1 LIMIT 1`,
          [input.id]
        );
        if (sessions.rows[0])
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "La versión tiene sesiones de evaluación vinculadas y no puede eliminarse.",
          });
        const account = await pool.query(
          `SELECT email FROM users WHERE id=$1 LIMIT 1`,
          [ctx.user.id]
        );
        const email = account.rows[0]?.email;
        if (!email)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "La cuenta no tiene un correo registrado para recibir el código de borrado.",
          });
        const recent = await pool.query(
          `SELECT created_at FROM protocol_delete_challenges
             WHERE protocol_id=$1 AND user_id=$2
             ORDER BY created_at DESC LIMIT 1`,
          [input.id, ctx.user.id]
        );
        if (
          recent.rows[0] &&
          Date.now() - new Date(recent.rows[0].created_at).getTime() <
            ASSESSMENT_DELETE_CODE_RESEND_SECONDS * 1000
        ) {
          return {
            success: true,
            emailMask: maskEmail(email),
            expiresInMinutes: ASSESSMENT_DELETE_CODE_TTL_MINUTES,
            retryAfterSeconds: ASSESSMENT_DELETE_CODE_RESEND_SECONDS,
          };
        }
        const code = createLoginCode();
        const codeHash = await hashLoginCode(code);
        await pool.query(
          `UPDATE protocol_delete_challenges
              SET used_at=COALESCE(used_at,now())
            WHERE protocol_id=$1 AND user_id=$2 AND used_at IS NULL`,
          [input.id, ctx.user.id]
        );
        const challenge = await pool.query(
          `INSERT INTO protocol_delete_challenges
             (protocol_id,user_id,code_hash,max_attempts,expires_at,requested_ip)
           VALUES ($1,$2,$3,$4,now()+($5 * interval '1 minute'),$6)
           RETURNING id`,
          [
            input.id,
            ctx.user.id,
            codeHash,
            ASSESSMENT_DELETE_CODE_MAX_ATTEMPTS,
            ASSESSMENT_DELETE_CODE_TTL_MINUTES,
            requestIp(ctx.req),
          ]
        );
        try {
          await sendDeleteCode({
            email,
            code,
            expiresInMinutes: ASSESSMENT_DELETE_CODE_TTL_MINUTES,
            protocolName: protocol.name,
            version: protocol.version,
            status: protocol.status,
          });
        } catch (error) {
          await pool.query(
            `UPDATE protocol_delete_challenges SET used_at=now() WHERE id=$1`,
            [challenge.rows[0].id]
          );
          console.error(
            "[Assessments] SMTP delete code delivery failed",
            error instanceof Error ? error.message : "unknown error"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "No fue posible enviar el código de borrado. Revise la configuración SMTP en EasyPanel.",
          });
        }
        await pool.query(
          `INSERT INTO audit_log
             (actor_user_id,entity_type,entity_id,action,after_json)
           VALUES ($1,'assessment_protocol',$2,'protocol_delete_code_sent',$3::jsonb)`,
          [
            ctx.user.id,
            input.id,
            asJson({ version: protocol.version, status: protocol.status }),
          ]
        );
        return {
          success: true,
          emailMask: maskEmail(email),
          expiresInMinutes: ASSESSMENT_DELETE_CODE_TTL_MINUTES,
          retryAfterSeconds: ASSESSMENT_DELETE_CODE_RESEND_SECONDS,
        };
      }),
    deleteProtocol: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          code: z.string().regex(/^\d{6}$/),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        let committed = false;
        try {
          await client.query("BEGIN");
          const locked = await client.query(
            `SELECT id,name,version,status,job_position_id
               FROM assessment_protocols WHERE id=$1 FOR UPDATE`,
            [input.id]
          );
          const protocol = locked.rows[0];
          if (!protocol)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "El protocolo de prueba no existe.",
            });
          if (protocol.status === "activo")
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Una versión activa no puede eliminarse; retire primero su activación.",
            });
          const sessions = await client.query(
            `SELECT 1 FROM assessment_sessions WHERE protocol_id=$1 LIMIT 1`,
            [input.id]
          );
          if (sessions.rows[0])
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "La versión tiene sesiones de evaluación vinculadas y no puede eliminarse.",
            });
          const challenge = await client.query(
            `SELECT id,code_hash,attempts,max_attempts,expires_at
               FROM protocol_delete_challenges
              WHERE protocol_id=$1 AND user_id=$2 AND used_at IS NULL
              ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
            [input.id, ctx.user.id]
          );
          const row = challenge.rows[0];
          const valid =
            row &&
            row.attempts < row.max_attempts &&
            new Date(row.expires_at).getTime() > Date.now() &&
            (await verifyLoginCode(input.code, row.code_hash));
          if (!valid) {
            if (row)
              await client.query(
                `UPDATE protocol_delete_challenges
                    SET attempts=attempts+1,
                        used_at=CASE
                          WHEN attempts+1>=max_attempts OR expires_at<=now()
                          THEN now() ELSE used_at
                        END
                  WHERE id=$1`,
                [row.id]
              );
            await client.query("COMMIT");
            committed = true;
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message:
                "El código de borrado es inválido, expiró o superó el máximo de intentos.",
            });
          }
          await client.query(
            `UPDATE protocol_delete_challenges SET used_at=now() WHERE id=$1`,
            [row.id]
          );
          const items = await client.query(
            `SELECT count(*)::int AS item_count
               FROM assessment_items WHERE protocol_id=$1`,
            [input.id]
          );
          await client.query(
            `DELETE FROM assessment_protocols WHERE id=$1`,
            [input.id]
          );
          await client.query(
            `INSERT INTO audit_log
               (actor_user_id,entity_type,entity_id,action,before_json)
             VALUES ($1,'assessment_protocol',$2,'protocol_deleted',$3::jsonb)`,
            [
              ctx.user.id,
              input.id,
              asJson({
                name: protocol.name,
                version: protocol.version,
                status: protocol.status,
                itemCount: items.rows[0]?.item_count ?? 0,
              }),
            ]
          );
          await client.query("COMMIT");
          committed = true;
          return { success: true as const };
        } catch (error) {
          if (!committed) await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
  }),

  candidates: router({
    list: roleProcedure
      .input(
        z
          .object({
            status: z.enum(statusValues).optional(),
            search: z.string().max(120).optional(),
            positionId: z.number().optional(),
            from: z.string().optional(),
            to: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return [];
        const values: unknown[] = [];
        const clauses: string[] = [];
        if (input?.status) {
          values.push(input.status);
          clauses.push(`a.status = $${values.length}`);
        }
        if (input?.search) {
          values.push(`%${input.search}%`);
          clauses.push(
            `(c.full_name ILIKE $${values.length} OR c.phone_international ILIKE $${values.length} OR p.title ILIKE $${values.length})`
          );
        }
        if (input?.positionId) {
          values.push(input.positionId);
          clauses.push(`p.id = $${values.length}`);
        }
        if (input?.from) {
          values.push(input.from);
          clauses.push(`a.submitted_at >= $${values.length}`);
        }
        if (input?.to) {
          values.push(input.to);
          clauses.push(
            `a.submitted_at < ($${values.length}::date + interval '1 day')`
          );
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const result = await pool.query(
          `SELECT a.id,a.status,a.submitted_at,a.evaluation_at,a.evaluation_reason,
                  a.profile_summary,a.whatsapp_status,c.full_name,c.phone_international,c.email,
                  p.title AS position_title,p.public_slug,gz.name AS location_zone,
                  gd.name AS location_department,gm.name AS location_municipality
             FROM applications a
             JOIN candidates c ON c.id=a.candidate_id
             JOIN job_positions p ON p.id=a.job_position_id
             LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
             LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
             LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
             ${where} ORDER BY a.submitted_at DESC LIMIT 200`,
          values
        );
        return result.rows;
      }),
    reviewWorkspace: roleProcedure
      .input(
        z
          .object({
            status: z.enum(statusValues).optional(),
            search: z.string().trim().max(120).optional(),
            positionId: z.number().int().positive().optional(),
            from: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            to: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            minimumScore: z.number().int().min(0).max(100).optional(),
            evaluatedOnly: z.boolean().optional(),
            sortBy: z
              .enum(["submitted_at", "name", "score", "status", "position"])
              .default("submitted_at"),
            sortDirection: z.enum(["asc", "desc"]).default("desc"),
          })
          .optional()
      )
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return [];
        const values: unknown[] = [];
        const clauses: string[] = [];
        const scoreExpression = `(CASE
          WHEN e.ai_payload->>'score' ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (e.ai_payload->>'score')::numeric
          WHEN e.ai_payload->>'criticalDisqualification' = 'true' THEN 0
          ELSE NULL
        END)`;
        if (input?.status) {
          values.push(input.status);
          clauses.push(`a.status = $${values.length}`);
        }
        if (input?.search) {
          values.push(`%${input.search}%`);
          clauses.push(
            `(c.full_name ILIKE $${values.length} OR c.phone_international ILIKE $${values.length} OR c.email ILIKE $${values.length} OR p.title ILIKE $${values.length})`
          );
        }
        if (input?.positionId) {
          values.push(input.positionId);
          clauses.push(`p.id = $${values.length}`);
        }
        if (input?.from) {
          values.push(input.from);
          clauses.push(`a.submitted_at >= $${values.length}::date`);
        }
        if (input?.to) {
          values.push(input.to);
          clauses.push(
            `a.submitted_at < ($${values.length}::date + interval '1 day')`
          );
        }
        if (input?.minimumScore !== undefined) {
          values.push(input.minimumScore);
          clauses.push(`${scoreExpression} >= $${values.length}`);
        }
        if (input?.evaluatedOnly) clauses.push(`e.evaluation_id IS NOT NULL`);
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const sortColumns = {
          submitted_at: "a.submitted_at",
          name: "LOWER(COALESCE(c.full_name,''))",
          score: `COALESCE(${scoreExpression},-1)`,
          status: "a.status::text",
          position: "LOWER(p.title)",
        } as const;
        const sortBy = input?.sortBy ?? "submitted_at";
        const sortDirection = input?.sortDirection === "asc" ? "ASC" : "DESC";
        const result = await pool.query(
          `SELECT
             a.id,a.status,a.submitted_at,a.evaluation_at,a.evaluation_reason,
             a.profile_summary,a.whatsapp_status,c.full_name,c.phone_international,
             c.email,p.id AS position_id,p.title AS position_title,p.public_slug,
             gz.name AS location_zone,gd.name AS location_department,
             gm.name AS location_municipality,
             e.evaluation_id,e.evaluation_status,e.latest_reason,e.latest_profile_summary,
             e.ai_payload,e.ai_model,e.evaluation_created_at,
             ${scoreExpression} AS evaluation_score,
             COALESCE(answer_set.answers,'[]'::jsonb) AS answers
           FROM applications a
           JOIN candidates c ON c.id=a.candidate_id
           JOIN job_positions p ON p.id=a.job_position_id
           LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
           LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
           LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
           LEFT JOIN LATERAL (
             SELECT ev.id AS evaluation_id,ev.status AS evaluation_status,
                    ev.reason AS latest_reason,ev.profile_summary AS latest_profile_summary,
                    ev.ai_payload,ev.ai_model,ev.created_at AS evaluation_created_at
               FROM evaluations ev
              WHERE ev.application_id=a.id
              ORDER BY ev.created_at DESC,ev.id DESC
              LIMIT 1
           ) e ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
                      jsonb_build_object(
                        'fieldKey',q.field_key,
                        'label',q.label,
                        'value',aa.value_json,
                        'normalizedValue',aa.normalized_value,
                        'deterministicResult',aa.deterministic_result
                      ) ORDER BY q.order_index,q.id
                    ) AS answers
               FROM application_answers aa
               JOIN form_questions q ON q.id=aa.question_id
              WHERE aa.application_id=a.id
           ) answer_set ON true
           ${where}
           ORDER BY ${sortColumns[sortBy]} ${sortDirection},a.id DESC
           LIMIT 200`,
          values
        );
        return result.rows;
      }),
    detail: roleProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const application = await pool.query(
          `SELECT a.*,c.full_name,c.phone_international,c.email,
                  p.title AS position_title,p.public_slug,
                  gz.name AS location_zone,gd.name AS location_department,
                  gm.name AS location_municipality
             FROM applications a
             JOIN candidates c ON c.id=a.candidate_id
             JOIN job_positions p ON p.id=a.job_position_id
             LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
             LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
             LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
            WHERE a.id=$1`,
          [input.id]
        );
        if (!application.rows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Candidato no encontrado.",
          });
        const answers = await pool.query(
          `SELECT q.label, q.field_key, aa.value_json, aa.normalized_value, aa.deterministic_result FROM application_answers aa JOIN form_questions q ON q.id=aa.question_id WHERE aa.application_id=$1 ORDER BY q.order_index`,
          [input.id]
        );
        const evaluations = await pool.query(
          `SELECT * FROM evaluations WHERE application_id=$1 ORDER BY created_at DESC`,
          [input.id]
        );
        const audit = await pool.query(
          `SELECT al.*, u.name AS actor_name FROM audit_log al LEFT JOIN users u ON u.id=al.actor_user_id WHERE al.entity_type='application' AND al.entity_id=$1 ORDER BY al.created_at DESC, al.id DESC`,
          [input.id]
        );
        const conversation = await pool.query(
          `SELECT * FROM conversations WHERE application_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [input.id]
        );
        const messages = conversation.rows[0]
          ? await pool.query(
              `SELECT * FROM conversation_messages WHERE conversation_id=$1 ORDER BY created_at ASC`,
              [conversation.rows[0].id]
            )
          : { rows: [] };
        return {
          application: application.rows[0],
          answers: answers.rows,
          evaluations: evaluations.rows,
          audit: audit.rows,
          conversation: conversation.rows[0] ?? null,
          messages: messages.rows,
        };
      }),
    setStatus: roleProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(statusValues),
          comment: z.string().max(1000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        let application: Record<string, any>;
        let audit: Record<string, any>;
        let messageId: number | null = null;
        try {
          await client.query("BEGIN");
          const beforeResult = await client.query(
            `SELECT a.*,c.full_name,c.phone_international,p.title AS position_title,p.whatsapp_message,
                  (SELECT setting_value FROM integration_settings WHERE provider='recruitment' AND setting_key='whatsapp_message' LIMIT 1) AS global_whatsapp_message
             FROM applications a
             JOIN candidates c ON c.id=a.candidate_id
             JOIN job_positions p ON p.id=a.job_position_id
            WHERE a.id=$1 FOR UPDATE OF a`,
            [input.id]
          );
          const before = beforeResult.rows[0];
          if (!before)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Candidato no encontrado.",
            });
          const afterResult = await client.query(
            `UPDATE applications SET status=$1::application_status,review_hold_until=NULL,updated_at=now() WHERE id=$2 RETURNING *`,
            [input.status, input.id]
          );
          application = afterResult.rows[0];
          if (before.status !== "calificado" && input.status === "calificado") {
            const message = await ensureCvRequestMessage(client, before);
            if (message?.created) {
              messageId = message.id;
              const pending = await client.query(
                `UPDATE applications SET whatsapp_status='pendiente',last_whatsapp_error=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
                [input.id]
              );
              application = pending.rows[0];
            }
          }
          const beforeApplication = { ...before };
          delete beforeApplication.full_name;
          delete beforeApplication.phone_international;
          delete beforeApplication.position_title;
          delete beforeApplication.whatsapp_message;
          delete beforeApplication.global_whatsapp_message;
          const action =
            before.status === input.status ? "comment_added" : "status_changed";
          const auditResult = await client.query(
            `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,before_json,after_json,comment) VALUES ($1,'application',$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING *`,
            [
              ctx.user.id,
              input.id,
              action,
              asJson(beforeApplication),
              asJson(application),
              input.comment ?? null,
            ]
          );
          audit = auditResult.rows[0];
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        const whatsapp: CvRequestDelivery | null = messageId
          ? await deliverCvRequestMessage(pool, messageId)
          : null;
        if (whatsapp) {
          const current = await pool.query(
            `SELECT * FROM applications WHERE id=$1`,
            [input.id]
          );
          application = current.rows[0] ?? application;
        }
        return { success: true as const, application, audit, whatsapp };
      }),
    retryCvRequest: roleProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        let messageId: number;
        try {
          await client.query("BEGIN");
          const applicationResult = await client.query(
            `SELECT a.*,c.full_name,c.phone_international,p.title AS position_title,p.whatsapp_message,
                  (SELECT setting_value FROM integration_settings WHERE provider='recruitment' AND setting_key='whatsapp_message' LIMIT 1) AS global_whatsapp_message
             FROM applications a
             JOIN candidates c ON c.id=a.candidate_id
             JOIN job_positions p ON p.id=a.job_position_id
            WHERE a.id=$1 FOR UPDATE OF a`,
            [input.id]
          );
          const application = applicationResult.rows[0];
          if (!application)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Candidato no encontrado.",
            });
          if (application.status !== "calificado") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "La solicitud de CV solo puede enviarse a postulaciones calificadas.",
            });
          }
          const message = await ensureCvRequestMessage(client, application);
          if (!message)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "No fue posible preparar la solicitud de CV.",
            });
          messageId = message.id;
          if (message.delivery_status === "sent") {
            await client.query(
              `UPDATE applications SET whatsapp_status='enviado',last_whatsapp_error=NULL,updated_at=now() WHERE id=$1`,
              [input.id]
            );
          } else if (message.delivery_status === "unknown") {
            await client.query(
              `UPDATE applications SET whatsapp_status='desconocido',updated_at=now() WHERE id=$1`,
              [input.id]
            );
          } else if (message.delivery_status !== "sending") {
            await client.query(
              `UPDATE applications SET whatsapp_status='pendiente',last_whatsapp_error=NULL,updated_at=now() WHERE id=$1`,
              [input.id]
            );
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        const whatsapp = await deliverCvRequestMessage(pool, messageId!);
        const current = await pool.query(
          `SELECT * FROM applications WHERE id=$1`,
          [input.id]
        );
        return {
          success: true as const,
          application: current.rows[0],
          whatsapp,
        };
      }),
  }),

  reports: router({
    overview: roleProcedure
      .input(
        z
          .object({ from: z.string().optional(), to: z.string().optional() })
          .optional()
      )
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return { byStatus: [], byPosition: [], reasons: [] };
        const values: unknown[] = [];
        const clauses: string[] = [];
        if (input?.from) {
          values.push(input.from);
          clauses.push(`a.submitted_at >= $${values.length}`);
        }
        if (input?.to) {
          values.push(input.to);
          clauses.push(
            `a.submitted_at < ($${values.length}::date + interval '1 day')`
          );
        }
        // CORRECCIÓN: Se agrega "WHERE 1=1" cuando no hay filtros para evitar error de sintaxis SQL
        const where = clauses.length
          ? `WHERE ${clauses.join(" AND ")}`
          : "WHERE 1=1";
        const [byStatus, byPosition, reasons, responseTime] = await Promise.all(
          [
            pool.query(
              `SELECT status, count(*)::int AS count FROM applications a ${where} GROUP BY status ORDER BY count DESC`,
              values
            ),
            pool.query(
              `SELECT p.title, count(*)::int AS count FROM applications a JOIN job_positions p ON p.id=a.job_position_id ${where} GROUP BY p.title ORDER BY count DESC`,
              values
            ),
            pool.query(
              `SELECT COALESCE(NULLIF(evaluation_reason,''),'Sin motivo') AS reason, count(*)::int AS count FROM applications a ${where} GROUP BY reason ORDER BY count DESC LIMIT 8`,
              values
            ),
            pool.query(
              `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (evaluation_at - submitted_at)) / 3600.0)::numeric, 1) AS average_hours FROM applications a ${where} AND evaluation_at IS NOT NULL`,
              values
            ),
          ]
        );
        return {
          byStatus: byStatus.rows,
          byPosition: byPosition.rows,
          reasons: reasons.rows,
          responseTime: responseTime.rows[0] ?? { average_hours: null },
        };
      }),
  }),

  mstEir: router({
    documents: adminProcedure.query(async () => {
      const pool = await requirePool();
      const result = await pool.query(
        `SELECT d.id,d.document_key,d.display_name,d.content_markdown,d.version,d.created_at,d.updated_at,
                u.name AS updated_by_name,u.email AS updated_by_email,
                (SELECT count(*)::int FROM methodology_document_revisions r WHERE r.document_id=d.id) AS revision_count
           FROM methodology_documents d
           LEFT JOIN users u ON u.id=d.updated_by_user_id
          WHERE d.document_key = ANY($1::varchar[])
          ORDER BY CASE d.document_key WHEN 'siera' THEN 1 WHEN 'mst_eir' THEN 2 ELSE 3 END`,
        [methodologyDocumentKeys]
      );
      return result.rows;
    }),
    saveDocument: adminProcedure
      .input(
        z.object({
          documentKey: z.enum(methodologyDocumentKeys),
          contentMarkdown: z
            .string()
            .min(1, "El documento no puede quedar vacío.")
            .max(
              100_000,
              "El documento supera el máximo de 100,000 caracteres."
            ),
          expectedVersion: z.number().int().positive(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const currentResult = await client.query(
            `SELECT * FROM methodology_documents WHERE document_key=$1 FOR UPDATE`,
            [input.documentKey]
          );
          const current = currentResult.rows[0];
          if (!current) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message:
                "El documento no está inicializado. Ejecute primero el query MST-EIR en PostgreSQL.",
            });
          }
          if (Number(current.version) !== input.expectedVersion) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Otra persona actualizó este documento. Recargue la página antes de guardar.",
            });
          }
          if (current.content_markdown === input.contentMarkdown) {
            await client.query("COMMIT");
            return { ...current, unchanged: true as const };
          }
          const updatedResult = await client.query(
            `UPDATE methodology_documents
              SET content_markdown=$1,version=version+1,updated_by_user_id=$2,updated_at=now()
            WHERE id=$3
            RETURNING *`,
            [input.contentMarkdown, ctx.user.id, current.id]
          );
          const updated = updatedResult.rows[0];
          await client.query(
            `INSERT INTO methodology_document_revisions
             (document_id,version,display_name,content_markdown,changed_by_user_id)
           VALUES ($1,$2,$3,$4,$5)`,
            [
              updated.id,
              updated.version,
              updated.display_name,
              updated.content_markdown,
              ctx.user.id,
            ]
          );
          await client.query(
            `INSERT INTO audit_log
             (actor_user_id,entity_type,entity_id,action,before_json,after_json)
           VALUES ($1,'methodology_document',$2,'document_updated',$3::jsonb,$4::jsonb)`,
            [
              ctx.user.id,
              current.id,
              asJson({
                documentKey: current.document_key,
                version: current.version,
                characters: current.content_markdown.length,
              }),
              asJson({
                documentKey: updated.document_key,
                version: updated.version,
                characters: updated.content_markdown.length,
              }),
            ]
          );
          await client.query("COMMIT");
          return { ...updated, unchanged: false as const };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
  }),

  geo: router({
    departments: publicProcedure
      .input(
        z.object({ countryIso: z.string().length(2).default("GT") }).optional()
      )
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return [];
        const result = await pool.query(
          `SELECT d.* FROM geo_departments d JOIN countries c ON c.id=d.country_id WHERE c.iso2=$1 AND d.active=true ORDER BY d.code`,
          [input?.countryIso ?? "GT"]
        );
        return result.rows;
      }),
    municipalities: publicProcedure
      .input(z.object({ departmentId: z.number() }))
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return [];
        const result = await pool.query(
          `SELECT * FROM geo_municipalities WHERE department_id=$1 AND active=true ORDER BY code`,
          [input.departmentId]
        );
        return result.rows;
      }),
    zones: publicProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return [];
      const result = await pool.query(
        `SELECT z.id,z.code,z.name,
                d.id AS "departmentId",d.name AS "departmentName"
           FROM geo_zones z
           JOIN geo_municipalities m ON m.id=z.municipality_id AND m.active=true
           JOIN geo_departments d ON d.id=m.department_id AND d.active=true
           JOIN countries c ON c.id=d.country_id AND c.iso2='GT' AND c.active=true
          WHERE z.active=true
            AND z.code ~ '^(?:[1-9]|1[0-9]|2[0-5])$'
          ORDER BY z.code::integer`
      );
      return result.rows;
    }),
    adminCatalog: adminProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return { departments: [], municipalities: [], zones: [] };
      const [departments, municipalities, zones] = await Promise.all([
        pool.query(
          `SELECT d.id,d.code,d.name,d.active FROM geo_departments d ORDER BY d.code`
        ),
        pool.query(
          `SELECT m.id,m.code,m.name,m.active,d.code AS department_code,d.name AS department_name FROM geo_municipalities m JOIN geo_departments d ON d.id=m.department_id ORDER BY m.code`
        ),
        pool.query(
          `SELECT z.id,z.code,z.name,z.active,m.code AS municipality_code,m.name AS municipality_name,d.code AS department_code,d.name AS department_name FROM geo_zones z JOIN geo_municipalities m ON m.id=z.municipality_id JOIN geo_departments d ON d.id=m.department_id ORDER BY CASE WHEN z.code ~ '^[0-9]+$' THEN z.code::integer END,z.code`
        ),
      ]);
      return {
        departments: departments.rows,
        municipalities: municipalities.rows,
        zones: zones.rows,
      };
    }),
    updateItem: adminProcedure
      .input(
        z.object({
          entity: z.enum(["department", "municipality", "zone"]),
          id: z.number(),
          name: z.string().min(1).max(160),
          active: z.boolean(),
        })
      )
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const table =
          input.entity === "department"
            ? "geo_departments"
            : input.entity === "municipality"
              ? "geo_municipalities"
              : "geo_zones";
        const result = await pool.query(
          `UPDATE ${table} SET name=$1,active=$2 WHERE id=$3 RETURNING *`,
          [input.name, input.active, input.id]
        );
        return result.rows[0];
      }),
    importCatalog: adminProcedure
      .input(
        z.object({
          departments: z.array(
            z.object({ code: z.string(), name: z.string() })
          ),
          municipalities: z.array(
            z.object({
              departmentCode: z.string(),
              code: z.string(),
              name: z.string(),
            })
          ),
          zones: z
            .array(
              z.object({
                municipalityCode: z.string(),
                code: z.string(),
                name: z.string(),
              })
            )
            .default([]),
        })
      )
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `INSERT INTO countries (iso2,name,dialing_code,active) VALUES ('GT','Guatemala','+502',true) ON CONFLICT (iso2) DO UPDATE SET active=true`
          );
          for (const department of input.departments)
            await client.query(
              `INSERT INTO geo_departments (country_id,code,name,active) SELECT id,$1,$2,true FROM countries WHERE iso2='GT' ON CONFLICT (country_id,code) DO UPDATE SET name=EXCLUDED.name,active=true`,
              [department.code, department.name]
            );
          for (const municipality of input.municipalities)
            await client.query(
              `INSERT INTO geo_municipalities (department_id,code,name,active) SELECT d.id,$1,$2,true FROM geo_departments d WHERE d.code=$3 AND d.country_id=(SELECT id FROM countries WHERE iso2='GT') ON CONFLICT (department_id,code) DO UPDATE SET name=EXCLUDED.name,active=true`,
              [
                municipality.code,
                municipality.name,
                municipality.departmentCode,
              ]
            );
          for (const zone of input.zones)
            await client.query(
              `INSERT INTO geo_zones (municipality_id,code,name,active) SELECT m.id,$1,$2,true FROM geo_municipalities m WHERE m.code=$3 ON CONFLICT (municipality_id,code) DO UPDATE SET name=EXCLUDED.name,active=true`,
              [zone.code, zone.name, zone.municipalityCode]
            );
          await client.query("COMMIT");
          return {
            departments: input.departments.length,
            municipalities: input.municipalities.length,
            zones: input.zones.length,
          };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
  }),

  forms: router({
    getByPosition: adminProcedure
      .input(z.object({ positionId: z.number() }))
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return null;
        const form = await pool.query(
          `SELECT * FROM application_forms WHERE job_position_id=$1 ORDER BY version DESC LIMIT 1`,
          [input.positionId]
        );
        if (!form.rows[0]) return null;
        const questions = await pool.query(
          `SELECT * FROM form_questions WHERE form_id=$1 ORDER BY order_index`,
          [form.rows[0].id]
        );
        return { ...form.rows[0], questions: questions.rows };
      }),
    upsert: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          positionId: z.number(),
          title: z.string().min(2).max(240),
          intro: z.string().max(3000).optional(),
          published: z.boolean().default(false),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        if (input.published) {
          await preparePositionProfileForPublication(
            pool,
            input.positionId,
            ctx.user.id
          );
          await normalizeStoredPosition(pool, input.positionId, ctx.user.id);
        }
        const formValidation = await validateEntityPublicCopy(
          pool,
          "application_form",
          input.id,
          formPublicCopyInput(input)
        );
        const normalizedInput = applyFormEditorialCopy(input, formValidation);
        if (input.id) {
          const result = await pool.query(
            `UPDATE application_forms SET title=$1,intro=$2,published=$3,updated_at=now() WHERE id=$4 RETURNING *`,
            [
              normalizedInput.title,
              normalizedInput.intro ?? null,
              false,
              input.id,
            ]
          );
          await recordEditorialValidation(
            pool,
            "application_form",
            input.id,
            ctx.user.id,
            formValidation
          );
          if (input.published) {
            await normalizeStoredFormBundle(pool, input.id, ctx.user.id);
            const published = await pool.query(
              `UPDATE application_forms SET published=true,updated_at=now() WHERE id=$1 RETURNING *`,
              [input.id]
            );
            return published.rows[0];
          }
          return result.rows[0];
        }
        const version = await pool.query(
          `SELECT COALESCE(MAX(version),0)+1 AS version FROM application_forms WHERE job_position_id=$1`,
          [input.positionId]
        );
        const result = await pool.query(
          `INSERT INTO application_forms (job_position_id,version,title,intro,published,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            input.positionId,
            version.rows[0].version,
            normalizedInput.title,
            normalizedInput.intro ?? null,
            false,
            ctx.user.id,
          ]
        );
        await recordEditorialValidation(
          pool,
          "application_form",
          result.rows[0].id,
          ctx.user.id,
          formValidation
        );
        if (input.published) {
          await normalizeStoredFormBundle(pool, result.rows[0].id, ctx.user.id);
          const published = await pool.query(
            `UPDATE application_forms SET published=true,updated_at=now() WHERE id=$1 RETURNING *`,
            [result.rows[0].id]
          );
          return published.rows[0];
        }
        return result.rows[0];
      }),
    saveQuestion: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          formId: z.number(),
          fieldKey: z.string().min(2).max(100),
          label: z.string().min(2),
          helpText: z.string().max(600).optional(),
          type: z.string().min(2).max(40),
          required: z.boolean().default(false),
          orderIndex: z.number().int().default(0),
          answerConfig: z.record(z.string(), z.unknown()).default({}),
          acceptedAnswers: z.array(z.unknown()).default([]),
          hardFail: z.boolean().default(false),
          evaluationCriteria: z.string().max(2000).optional(),
          aiPrompt: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const options = Array.isArray(input.answerConfig.options)
          ? input.answerConfig.options.map(String).filter(Boolean)
          : [];
        if (input.type === "select" && options.length === 0)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Una pregunta de selección debe incluir al menos una opción.",
          });
        const hasRange = [
          input.answerConfig.min,
          input.answerConfig.max,
          input.answerConfig.minMonths,
          input.answerConfig.maxMonths,
        ].some(value => value !== undefined && value !== null && value !== "");
        if (input.hardFail && input.acceptedAnswers.length === 0 && !hasRange)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Una pregunta de descarte debe definir respuestas aprobadas o un rango permitido.",
          });
        const pool = await requirePool();
        const questionValidation = await validateEntityPublicCopy(
          pool,
          "form_question",
          input.id,
          questionPublicCopyInput(input)
        );
        const normalizedInput = applyQuestionEditorialCopy(
          input,
          questionValidation
        );
        if (input.id) {
          const result = await pool.query(
            `UPDATE form_questions SET field_key=$1,label=$2,help_text=$3,type=$4,required=$5,order_index=$6,answer_config=$7::jsonb,accepted_answers=$8::jsonb,hard_fail=$9,evaluation_criteria=$10,ai_prompt=$11 WHERE id=$12 RETURNING *`,
            [
              input.fieldKey,
              normalizedInput.label,
              normalizedInput.helpText ?? null,
              input.type,
              input.required,
              input.orderIndex,
              asJson(normalizedInput.answerConfig),
              asJson(normalizedInput.acceptedAnswers),
              input.hardFail,
              normalizedInput.evaluationCriteria ?? null,
              normalizedInput.aiPrompt ?? null,
              input.id,
            ]
          );
          await recordEditorialValidation(
            pool,
            "form_question",
            input.id,
            ctx.user.id,
            questionValidation
          );
          return result.rows[0];
        }
        const result = await pool.query(
          `INSERT INTO form_questions (form_id,field_key,label,help_text,type,required,order_index,answer_config,accepted_answers,hard_fail,evaluation_criteria,ai_prompt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12) RETURNING *`,
          [
            input.formId,
            input.fieldKey,
            normalizedInput.label,
            normalizedInput.helpText ?? null,
            input.type,
            input.required,
            input.orderIndex,
            asJson(normalizedInput.answerConfig),
            asJson(normalizedInput.acceptedAnswers),
            input.hardFail,
            normalizedInput.evaluationCriteria ?? null,
            normalizedInput.aiPrompt ?? null,
          ]
        );
        await recordEditorialValidation(
          pool,
          "form_question",
          result.rows[0].id,
          ctx.user.id,
          questionValidation
        );
        return result.rows[0];
      }),
    deleteQuestion: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const current = await client.query(
            `SELECT form_id FROM form_questions WHERE id=$1 FOR UPDATE`,
            [input.id]
          );
          if (!current.rows[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Pregunta no encontrada.",
            });
          await client.query(`DELETE FROM form_questions WHERE id=$1`, [
            input.id,
          ]);
          await client.query(
            `WITH ordered AS (SELECT id, row_number() OVER (ORDER BY order_index,id)-1 AS new_order FROM form_questions WHERE form_id=$1) UPDATE form_questions q SET order_index=ordered.new_order FROM ordered WHERE q.id=ordered.id`,
            [current.rows[0].form_id]
          );
          await client.query("COMMIT");
          return { success: true };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    setPublished: adminProcedure
      .input(z.object({ id: z.number(), published: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        if (input.published) {
          const form = await pool.query<{ job_position_id: number }>(
            `SELECT job_position_id FROM application_forms WHERE id=$1`,
            [input.id]
          );
          if (!form.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Formulario no encontrado.",
            });
          }
          const positionId = form.rows[0].job_position_id;
          await preparePositionProfileForPublication(
            pool,
            positionId,
            ctx.user.id
          );
          await normalizeStoredPosition(pool, positionId, ctx.user.id);
          await normalizeStoredFormBundle(pool, input.id, ctx.user.id);
        }
        const result = await pool.query(
          `UPDATE application_forms SET published=$1,updated_at=now() WHERE id=$2 RETURNING *`,
          [input.published, input.id]
        );
        return result.rows[0];
      }),
    remove: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        await pool.query(`DELETE FROM application_forms WHERE id=$1`, [
          input.id,
        ]);
        return { success: true };
      }),
    setQuestionActive: adminProcedure
      .input(z.object({ id: z.number(), active: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        if (input.active) {
          const current = await pool.query(
            `SELECT id,label,help_text,evaluation_criteria,ai_prompt,
                    answer_config,accepted_answers
               FROM form_questions
              WHERE id=$1`,
            [input.id]
          );
          if (!current.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Pregunta no encontrada.",
            });
          }
          await normalizeStoredQuestion(pool, current.rows[0], ctx.user.id);
        }
        const result = await pool.query(
          `UPDATE form_questions SET active=$1 WHERE id=$2 RETURNING *`,
          [input.active, input.id]
        );
        return result.rows[0];
      }),
    moveQuestion: adminProcedure
      .input(z.object({ id: z.number(), direction: z.enum(["up", "down"]) }))
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const current = await client.query(
            `SELECT id,form_id,order_index FROM form_questions WHERE id=$1 FOR UPDATE`,
            [input.id]
          );
          if (!current.rows[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Pregunta no encontrada.",
            });
          const delta = input.direction === "up" ? -1 : 1;
          const target = await client.query(
            `SELECT id,order_index FROM form_questions WHERE form_id=$1 AND order_index=$2 ORDER BY id LIMIT 1 FOR UPDATE`,
            [current.rows[0].form_id, current.rows[0].order_index + delta]
          );
          if (target.rows[0]) {
            await client.query(
              `UPDATE form_questions SET order_index=$1 WHERE id=$2`,
              [current.rows[0].order_index, target.rows[0].id]
            );
            await client.query(
              `UPDATE form_questions SET order_index=$1 WHERE id=$2`,
              [target.rows[0].order_index, current.rows[0].id]
            );
          }
          const result = await client.query(
            `SELECT * FROM form_questions WHERE id=$1`,
            [input.id]
          );
          await client.query("COMMIT");
          return result.rows[0];
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
  }),

  agent: router({
    configuration: adminProcedure.query(async () => {
      return getAgentConfiguration(await getPool());
    }),
    savePreferences: adminProcedure
      .input(
        z.object({
          model: z.enum(agentModelValues),
          psychometricModel: z.enum(agentModelValues),
          activitySummaryModel: z.enum(agentModelValues),
          transcriptionModel: z.enum(transcriptionModelValues),
          ttsModel: z.enum(ttsModelValues),
          ttsVoice: z.enum(OPENAI_TTS_VOICES),
          audioMaxMb: z.number().int().min(1).max(25),
          documentMaxMb: z.number().int().min(1).max(25),
          instructions: z.string().trim().min(100).max(20_000),
          summaryWordLimit: z.number().int().min(50).max(1_000),
          useMethodologies: z.boolean(),
          useResponsesApi: z.boolean(),
          methodologyInterpretation: z.string().trim().min(100).max(12_000),
          langfuseEnabled: z.boolean(),
          langfuseBaseUrl: z.enum(LANGFUSE_CLOUD_BASE_URLS),
          langfuseEnvironment: z
            .string()
            .trim()
            .min(2)
            .max(80)
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
              message:
                "El environment de Langfuse solo admite letras, números, punto, guion y guion bajo.",
            }),
          langfuseCaptureMode: z.enum(LANGFUSE_CAPTURE_MODES),
          langfuseSampleRate: z.number().min(0.01).max(1),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const configuration = await saveAgentPreferences(
          pool,
          input,
          ctx.user.id
        );
        await initializeLangfuseFromDatabase(pool, { release: APP_VERSION });
        return configuration;
      }),
    saveSecret: adminProcedure
      .input(
        z.object({
          key: z.enum(AGENT_SECRET_KEYS),
          value: z.string().trim().min(8).max(500).nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        if (
          input.value &&
          input.key.startsWith("openai_") &&
          !input.value.startsWith("sk-")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La API key de OpenAI debe comenzar con sk-.",
          });
        }
        if (
          input.value &&
          input.key === "langfuse_public_key" &&
          !input.value.startsWith("pk-lf-")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La clave pública de Langfuse debe comenzar con pk-lf-.",
          });
        }
        if (
          input.value &&
          input.key === "langfuse_secret_key" &&
          !input.value.startsWith("sk-lf-")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La clave secreta de Langfuse debe comenzar con sk-lf-.",
          });
        }
        try {
          const state = await saveAgentSecret(
            pool,
            input.key,
            input.value,
            ctx.user.id
          );
          if (input.key.startsWith("langfuse_")) {
            await initializeLangfuseFromDatabase(pool, {
              release: APP_VERSION,
            });
          }
          return state;
        } catch (error) {
          console.error(
            "[AgentSecret] No fue posible guardar la credencial:",
            error instanceof Error
              ? error.message.replace(
                  /sk-[A-Za-z0-9_-]{8,}/g,
                  "[credencial protegida]"
                )
              : String(error)
          );
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar la credencial."
            ),
          });
        }
      }),
    verifyOpenAI: adminProcedure
      .input(z.object({ slot: z.enum(["primary", "backup"]) }))
      .mutation(async ({ input }) => {
        try {
          return await verifyOpenAIConnection(await requirePool(), input.slot);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible verificar la conexión con OpenAI."
            ),
          });
        }
      }),
    verifyLangfuse: adminProcedure.mutation(async () => {
      try {
        return await verifyLangfuseConnection(await requirePool());
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: safeIntegrationMessage(
            error,
            "No fue posible verificar la conexión con Langfuse."
          ),
        });
      }
    }),
    evaluateApplication: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          return await evaluateApplicationWithAgent(
            await requirePool(),
            input.applicationId
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible evaluar la postulación."
            ),
          });
        }
      }),
  }),

  config: router({
    settings: adminProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return [];
      const result = await pool.query(
        `SELECT provider,setting_key,
                CASE WHEN is_secret THEN NULL ELSE setting_value END AS setting_value,
                is_secret,(is_secret AND COALESCE(setting_value,'')<>'') AS configured
           FROM integration_settings
          WHERE provider='recruitment'
          ORDER BY provider,setting_key`
      );
      return result.rows;
    }),
    saveSetting: adminProcedure
      .input(
        z.object({
          provider: z.literal("recruitment"),
          settingKey: z.string().min(2).max(120),
          settingValue: z.string().max(3000),
          isSecret: z.literal(false).default(false),
        })
      )
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (provider,setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,is_secret=EXCLUDED.is_secret,updated_at=now() RETURNING provider,setting_key,CASE WHEN is_secret THEN NULL ELSE setting_value END AS setting_value,is_secret`,
          [input.provider, input.settingKey, input.settingValue, false]
        );
        return result.rows[0];
      }),
    apiChatConfiguration: adminProcedure.query(async () => {
      return getApiChatConfiguration(await getPool());
    }),
    apiChatReception: adminProcedure.query(async () => {
      return getApiChatReceptionReadiness(await getPool());
    }),
    apiChatEndpoints: adminProcedure.query(async () => {
      return getApiChatEndpoints(await getPool());
    }),
    saveApiChatEndpoints: adminProcedure
      .input(
        z.object({
          endpoints: z
            .array(
              z.object({
                path: z.string().trim().min(1).max(120),
                enabled: z.boolean(),
              })
            )
            .min(1)
            .max(20),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveApiChatEndpointStates(
            await requirePool(),
            input.endpoints,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar el estado de los endpoints."
            ),
          });
        }
      }),
    saveApiChatPreferences: adminProcedure
      .input(
        z.object({
          mode: z.enum(["native", "legacy"]),
          endpoint: z.url().max(500),
          connectTo: z.string().trim().max(160),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveApiChatPreferences(
            await requirePool(),
            input,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar la configuración de ApiChat."
            ),
          });
        }
      }),
    saveApiChatSecret: adminProcedure
      .input(
        z.object({
          key: z.enum(APICHAT_SECRET_KEYS),
          value: z.string().trim().min(3).max(1_000).nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveApiChatSecret(
            await requirePool(),
            input.key,
            input.value,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar la credencial de ApiChat."
            ),
          });
        }
      }),
    verifyApiChat: adminProcedure.mutation(async () => {
      try {
        return await verifyApiChatConnection(await requirePool());
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: safeIntegrationMessage(
            error,
            "No fue posible verificar la conexión con ApiChat."
          ),
        });
      }
    }),
    recipients: adminProcedure.query(async () => {
      const pool = await getPool();
      if (!pool) return [];
      const result = await pool.query(
        `SELECT * FROM internal_alert_recipients ORDER BY label`
      );
      return result.rows;
    }),
    saveRecipient: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          label: z.string().min(2).max(120),
          phone: z.string().min(7).max(40),
          active: z.boolean().default(true),
        })
      )
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const phone = normalizePhone(input.phone, "GT");
        if (input.id) {
          const result = await pool.query(
            `UPDATE internal_alert_recipients SET label=$1,phone_international=$2,active=$3 WHERE id=$4 RETURNING *`,
            [input.label, phone.e164, input.active, input.id]
          );
          return result.rows[0];
        }
        const result = await pool.query(
          `INSERT INTO internal_alert_recipients (label,phone_international,active) VALUES ($1,$2,$3) RETURNING *`,
          [input.label, phone.e164, input.active]
        );
        return result.rows[0];
      }),
  }),
});

export type AppRouter = typeof appRouter;
