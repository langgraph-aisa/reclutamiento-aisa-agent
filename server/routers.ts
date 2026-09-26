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
  sendSecurityCode,
  setLocalSession,
  verifyLoginCode,
} from "./localAuth";
import { normalizePhone } from "./phone";
import { importSpreadsheetForm } from "./importForms";
import { createFormPublicToken } from "./formTokens";
import {
  isUndefinedTableError,
  listGovernanceCoverage,
  registerGovernanceVerification,
} from "./governanceObservability";
import { resolveApplicationLocation } from "./applicationLocation";
import { COOKIE_NAME } from "@shared/const";
import { APP_VERSION } from "@shared/release";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  projectAdminProcedure,
  recruiterProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  dispatchWelcomeMessage,
  requestCvForApplication,
} from "./cvRequest";
import {
  AGENT_MODELS,
  AI_PROVIDERS,
  DEEPSEEK_MODELS,
  LANGFUSE_CAPTURE_MODES,
  LANGFUSE_CLOUD_BASE_URLS,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
} from "../shared/agentConfig";
import {
  evaluateApplicationWithAgent,
  verifyLangfuseConnection,
  verifyProviderConnection,
  withBlockLabels,
} from "./agentEvaluator";
import {
  analyzeCandidateCvEssence,
  cvAwaitingState,
} from "./cvAnalysis";
import { loadCvAnalysisConfiguration } from "./cvAnalysis";
import {
  AGENT_STAGE_INSTRUCTION_KEYS,
  AGENT_STAGE_KEYS,
  buildAgentStagesView,
  loadAgentStageConfiguration,
  loadAutomaticEvaluationCvMessage,
  saveAgentStageConfiguration,
  saveAutomaticEvaluationCvMessage,
} from "./agentStages";
import { agentLogTrace } from "./agentActivityLog";
import {
  completeAssessmentCycle,
  getAssessmentAutomation,
  saveAssessmentAutomation,
  scheduleAssessmentCycle,
} from "./assessmentAutomation";
import {
  confirmEvaluationAutomation,
  evaluationAutomationCounters,
  getEvaluationAutomation,
  requestEvaluationAutomationCode,
} from "./automaticEvaluation";
import { codecRegistry, saveCodecSettings } from "./codecRegistry";
import { apiChatChannelReport } from "./apiChatAudit";
import { recoverApiChatAttachments } from "./apiChatRecovery";
import {
  readApiChatAccountNotification,
  setApiChatAttachmentNotification,
  verifyApiChatAccount,
} from "./apiChatAccount";
import { attachmentPipelineReport } from "./attachmentPipeline";
import {
  RECRUITER_AGENT_MAX_QUESTION_CHARS,
  RECRUITER_AGENT_MODELS,
  askRecruiterAgent,
  effectiveRecruiterModel,
  loadRecruiterHistory,
  recruiterThreadFor,
  setRecruiterThreadModel,
} from "./recruiterAgent";
import {
  PERMISSION_ACTIONS,
  PERMISSION_LABELS,
  SECURITY_RESOURCES,
  loadUserPermissions,
  permissionDecision,
  permissionMapKey,
  recentUserActions,
  requestSecurityChallenge,
  saveUserPermissions,
  securityModules,
  verifySecurityChallenge,
} from "./securityRoles";
import {
  AGENT_SECRET_KEYS,
  getAgentConfiguration,
  getAgentRuntimeSettings,
  saveAgentPreferences,
  saveAgentSecret,
} from "./agentSettings";
import { initializeLangfuseFromDatabase } from "./observability/langfuse";
import {
  DROPBOX_OAUTH_KEYS,
  dropboxOAuthDiagnostics,
  getDropboxConnection,
  getDropboxOAuthConfiguration,
  saveDropboxOAuthSecret,
  unlinkDropboxConnection,
} from "./dropboxConnection";
import {
  assignProjectDropboxConnection,
  migrateProjectStorage,
  listProjectDropboxTree,
  listApplicationDropboxTree,
  projectIdForApplication,
  projectStorageProfile,
  setProjectStorageMode,
} from "./dropboxProject";
import {
  APICHAT_PER_USER_SECRET_KEYS,
  APICHAT_SECRET_KEYS,
  getApiChatConfiguration,
  getApiChatEndpoints,
  getApiChatReceptionReadiness,
  getApiChatUserConfiguration,
  saveApiChatEndpointStates,
  saveApiChatPreferences,
  saveApiChatPublicBaseUrl,
  saveApiChatSecret,
  saveApiChatUserSecret,
  resolveApiChatPublicBaseUrl,
  verifyApiChatConnection,
  verifyApiChatReception,
} from "./apiChatSettings";
import {
  analyzeKnowledgeDocument,
  buildStorageKey,
  countWords,
  extractKnowledgeText,
  getKnowledgeSettings,
  KNOWLEDGE_ANALYSIS_WORD_LIMIT,
  KNOWLEDGE_SUMMARY_WORD_LIMIT,
  knowledgeFileKind,
  knowledgeStorageHealth,
  limitWords,
  removeKnowledgeFile,
  saveKnowledgeSettings,
  writeKnowledgeFile,
} from "./knowledge";
import {
  decodeTransport,
  extensionOfTransportName,
  reconstructTransportFileName,
} from "./base64Transport";
import { createViewerToken } from "./viewerAccess";
import {
  analyzeCandidateDocument,
  candidateKnowledgeHealth,
  candidateKnowledgeTree,
  deleteCandidateDocument,
  deleteCandidateFolder,
  moveCandidateDocument,
  saveCandidateAnalysis,
  saveCandidateDocument,
  saveCandidateFolder,
} from "./candidateKnowledge";
import {
  autoRecoverAnnounced,
  dispatchExpedienteAppreciation,
  listConservedAttachments,
  listUnresolvedAttachments,
  recoverAnnouncedAttachment,
  recoverConservedAttachments,
} from "./candidateConservedRecovery";
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
  resolvePublicBaseUrl,
  sendInboxFile,
  sendInboxLink,
  sendInboxLocation,
  sendInboxPtt,
  sendInboxText,
  setInboxAutomation,
} from "./inbox";
import { manualInboxSync } from "./inboxSync";
import { markInboxRead } from "./inbox";
import {
  EXPEDIENTE_SIGNAL_COLUMNS,
  EXPEDIENTE_SIGNAL_JOINS,
} from "./expedienteSignal";
import { conversationPanelState } from "./conversationPanel";
import { runConversationTurn } from "./conversationEngine";
import { dispatchQueuedReplies } from "./conversationOutbox";
import {
  conversationActivationAdvisories,
  DEFAULT_CONVERSATION_ACTIVATION,
  getConversationActivation,
  saveConversationActivation,
} from "./conversationActivation";
import {
  ASSESSMENT_DELETE_CODE_MAX_ATTEMPTS,
  ASSESSMENT_DELETE_CODE_RESEND_SECONDS,
  ASSESSMENT_DELETE_CODE_TTL_MINUTES,
  ASSESSMENT_GOVERNANCE_DOMAINS,
  ASSESSMENT_GOVERNANCE_RULES,
  ASSESSMENT_LEVELS,
  GOVERNANCE_MONITORING_NOTICE,
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
const deepseekModelValues = DEEPSEEK_MODELS.map(model => model.value) as [
  (typeof DEEPSEEK_MODELS)[number]["value"],
  ...(typeof DEEPSEEK_MODELS)[number]["value"][],
];
const providerValues = AI_PROVIDERS as unknown as [
  (typeof AI_PROVIDERS)[number],
  ...(typeof AI_PROVIDERS)[number][],
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

type PublicFormPayloadRow = {
  id: number;
  public_slug: string;
  title: string;
  department: string | null;
  location_label: string | null;
  description: string | null;
  agent_key?: string | null;
  responsibilities: unknown;
  form_id: number;
  form_title: string;
  form_intro: string | null;
  form_version: number | null;
  form_token: string;
  question_id: number | null;
  field_key: string | null;
  label: string | null;
  help_text: string | null;
  type: string | null;
  required: boolean | null;
  order_index: number | null;
  answer_config: unknown;
};

/**
 * Higiene de propiedad intelectual: el navegador recibe únicamente lo necesario
 * para representar la pregunta. Las respuestas aceptadas, la marca de requisito
 * indispensable, los criterios de evaluación y las instrucciones del agente
 * permanecen en el servidor, de modo que la metodología de selección no pueda
 * reconstruirse desde el bundle público.
 */
function publicAnswerConfig(value: unknown) {
  const config = (value ?? {}) as Record<string, unknown>;
  const sanitized: { options?: string[]; min?: number; max?: number } = {};
  if (Array.isArray(config.options))
    sanitized.options = config.options.map(option => String(option));
  if (typeof config.min === "number") sanitized.min = config.min;
  if (typeof config.max === "number") sanitized.max = config.max;
  return sanitized;
}

/**
 * Ontología del formulario público: el enlace identifica un formulario concreto
 * —no la plaza completa—, de modo que una misma plaza puede ofrecer variantes A,
 * B, C o D con enlaces, interruptores y trazabilidad independientes.
 *
 * Epistemología: el candidato se reconoce por su número de WhatsApp normalizado
 * y la respuesta conserva siempre el formulario de origen; ninguna variante
 * reescribe ni duplica la evidencia registrada por otra.
 */
function publicFormPayload(rows: PublicFormPayloadRow[]) {
  if (!rows.length) return null;
  const first = rows[0];
  const responsibilities = (
    Array.isArray(first.responsibilities) ? (first.responsibilities as unknown[]) : []
  ).filter(
    (responsibility: unknown): responsibility is string =>
      typeof responsibility === "string" && responsibility.trim().length > 0
  );
  return {
    id: first.id,
    token: first.public_slug,
    title: first.title,
    department: first.department,
    locationLabel: first.location_label,
    description: first.description,
    agentKey: first.agent_key ?? null,
    responsibilities,
    form: {
      id: first.form_id,
      token: first.form_token,
      version: first.form_version,
      title: first.form_title,
      intro: first.form_intro,
    },
    questions: rows
      .filter(row => row.question_id !== null)
      .map(row => ({
        id: row.question_id,
        fieldKey: row.field_key,
        label: row.label,
        helpText: row.help_text,
        type: row.type,
        required: row.required,
        orderIndex: row.order_index,
        answerConfig: publicAnswerConfig(row.answer_config),
      })),
  };
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
  if (
    message.includes('relation "governance_rule_verifications" does not exist')
  ) {
    return "El registro de verificaciones de gobierno no existe. Aplique la migración 0020_governance_rule_verifications.sql en la base de datos.";
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
    "ApiChat rechazó la consulta de historial",
    "ApiChat rechazó la consulta de la cuenta",
    "ApiChat aceptó la actualización pero",
    "La configuración de la cuenta exige el modo de API nativa",
    "No fue posible consultar la configuración de la cuenta",
    "La verificación integrada de ApiChat",
    "La verificación de recepción exige el modo de API nativa",
    "El endpoint /messagesHistory está desactivado",
    "No fue posible consultar el historial de ApiChat",
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
          role: z.enum(["admin", "reclutador", "project_admin"]),
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
        // Enlace de plaza: resuelve la variante publicada de mayor versión.
        const result = await pool.query(
          `SELECT p.id, p.public_slug, p.title, p.department, p.location_label, p.description, p.agent_key,
                f.id AS form_id, f.title AS form_title, f.intro AS form_intro,
                f.version AS form_version, f.public_token AS form_token,
                profile.responsibilities,
                q.id AS question_id, q.field_key, q.label, q.help_text, q.type, q.required,
                q.order_index, q.answer_config
           FROM job_positions p
           JOIN LATERAL (
             SELECT published.id, published.title, published.intro,
                    published.version, published.public_token
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
        return publicFormPayload(result.rows as PublicFormPayloadRow[]);
      }),
    getFormByToken: publicProcedure
      .input(z.object({ token: z.string().min(16).max(64) }))
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return null;
        // Enlace propio del formulario: exige el interruptor del formulario y la
        // plaza publicada, de modo que apagar una variante invalida su enlace.
        const result = await pool.query(
          `SELECT p.id, p.public_slug, p.title, p.department, p.location_label, p.description, p.agent_key,
                f.id AS form_id, f.title AS form_title, f.intro AS form_intro,
                f.version AS form_version, f.public_token AS form_token,
                profile.responsibilities,
                q.id AS question_id, q.field_key, q.label, q.help_text, q.type, q.required,
                q.order_index, q.answer_config
           FROM application_forms f
           JOIN job_positions p ON p.id = f.job_position_id
           LEFT JOIN LATERAL (
             SELECT jp.responsibilities
               FROM job_profile_positions link
               JOIN job_profiles jp ON jp.id = link.profile_id
              WHERE link.job_position_id = p.id
                AND jp.active = true
              ORDER BY jp.updated_at DESC, jp.id DESC
              LIMIT 1
           ) profile ON true
           LEFT JOIN form_questions q ON q.form_id = f.id AND q.active = true
          WHERE f.public_token = $1
            AND f.published = true
            AND p.published = true
          ORDER BY q.order_index ASC`,
          [input.token]
        );
        return publicFormPayload(result.rows as PublicFormPayloadRow[]);
      }),
    submit: publicProcedure
      .input(
        z
          .object({
            token: z.string().min(8).max(120).optional(),
            formToken: z.string().min(16).max(64).optional(),
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
          .refine(value => Boolean(value.token || value.formToken), {
            message:
              "Se requiere el enlace de la plaza o el enlace del formulario.",
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
          // El enlace identifica la plaza (variante publicada más reciente) o un
          // formulario concreto. La identidad del candidato es siempre el
          // WhatsApp normalizado y la postulación es única por plaza: completar
          // otra variante agrega una participación, nunca un candidato nuevo.
          let scope: { positionId: number; formId: number };
          if (input.formToken) {
            const formResult = await client.query(
              `SELECT p.id AS position_id, f.id AS form_id
                 FROM application_forms f
                 JOIN job_positions p ON p.id = f.job_position_id
                WHERE f.public_token = $1
                  AND f.published = true
                  AND p.published = true
                LIMIT 1`,
              [input.formToken]
            );
            if (!formResult.rows[0])
              throw new TRPCError({
                code: "NOT_FOUND",
                message:
                  "Este formulario no está disponible: su enlace fue apagado o la plaza fue retirada.",
              });
            scope = {
              positionId: Number(formResult.rows[0].position_id),
              formId: Number(formResult.rows[0].form_id),
            };
          } else {
            const positionResult = await client.query(
              `SELECT p.id, f.id AS form_id FROM job_positions p
             JOIN application_forms f ON f.job_position_id = p.id AND f.published = true
            WHERE p.public_slug = $1 AND p.published = true
            ORDER BY f.version DESC LIMIT 1`,
              [input.token]
            );
            if (!positionResult.rows[0])
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "La plaza no está publicada o ya no está disponible.",
              });
            scope = {
              positionId: Number(positionResult.rows[0].id),
              formId: Number(positionResult.rows[0].form_id),
            };
          }
          const candidate = await client.query(
            `INSERT INTO candidates (phone_international, phone_country, full_name, email)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (phone_international) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, updated_at = now()
           RETURNING id`,
            [phone.e164, phone.country, input.fullName, input.email || null]
          );
          const candidateId = Number(candidate.rows[0].id);
          const existingApplication = await client.query(
            `SELECT id FROM applications WHERE candidate_id=$1 AND job_position_id=$2 LIMIT 1`,
            [candidateId, scope.positionId]
          );
          let applicationId: number;
          if (existingApplication.rows[0]) {
            applicationId = Number(existingApplication.rows[0].id);
            const submission = await client.query(
              `SELECT 1 FROM application_form_submissions
                WHERE application_id=$1 AND form_id=$2 LIMIT 1`,
              [applicationId, scope.formId]
            );
            if (submission.rows[0]) {
              await client.query("ROLLBACK");
              return {
                alreadyApplied: true as const,
                message:
                  "Esta solicitud ya fue enviada previamente para este formulario. Puede completar otra variante con su enlace correspondiente.",
              };
            }
          } else {
            const application = await client.query(
              `INSERT INTO applications (
                 candidate_id,job_position_id,form_id,
                 location_zone_id,location_department_id,location_municipality_id,status
               ) VALUES ($1,$2,$3,$4,$5,$6,'en_revision') RETURNING id`,
              [
                candidateId,
                scope.positionId,
                scope.formId,
                location.zoneId,
                location.departmentId,
                location.municipalityId,
              ]
            );
            applicationId = Number(application.rows[0].id);
          }
          const questions = await client.query(
            `SELECT id,field_key,required,type,answer_config FROM form_questions WHERE form_id = $1 AND active = true`,
            [scope.formId]
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
                applicationId,
                question.id,
                asJson(input.answers[question.field_key]),
                String(input.answers[question.field_key] ?? ""),
              ]
            );
          }
          await client.query(
            `INSERT INTO application_form_submissions (application_id,form_id,source)
             VALUES ($1,$2,'formulario')
             ON CONFLICT (application_id,form_id) DO NOTHING`,
            [applicationId, scope.formId]
          );
          await client.query(
            `INSERT INTO audit_log
               (actor_user_id,entity_type,entity_id,action,before_json,after_json,comment)
             VALUES (NULL,'application',$1,'application_consents_confirmed',NULL,$2::jsonb,$3)`,
            [
              applicationId,
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
          setImmediate(() => {
            // El paso «Recepción del formulario» deja la conversación creada y
            // abre con la bienvenida; la precalificación, la entrevista y el
            // cierre se administran después, y el currículum se solicita al
            // llegar a su etapa. Todo fuera de la transacción para que un fallo
            // del proveedor nunca revierta la postulación.
            void dispatchWelcomeMessage(pool, applicationId).catch(error => {
              console.warn(
                `[cvRequest] Application ${applicationId}: ${safeIntegrationMessage(
                  error,
                  "No fue posible preparar la conversación automáticamente."
                )}`
              );
            });
            // La prueba psicométrica ya no se programa desde el formulario:
            // se activa únicamente desde la ficha del candidato, tras
            // concluir las nueve etapas de la IA.
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
            year: z.number().int().min(2000).max(2100).optional(),
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
      // Una plaza puede tener varios formularios y anuncios: el formulario se
      // resuelve con una subconsulta lateral de una sola fila para que la plaza
      // aparezca exactamente una vez en el listado (sin duplicar la tarjeta).
      const result = await pool.query(
        `SELECT p.*,
                latest_form.id AS form_id,
                latest_form.title AS form_title,
                latest_form.published AS form_published,
                (SELECT count(*)::int FROM applications a WHERE a.job_position_id = p.id) AS applications_count
           FROM job_positions p
           LEFT JOIN LATERAL (
             SELECT f.id, f.title, f.published
               FROM application_forms f
              WHERE f.job_position_id = p.id
              ORDER BY f.version DESC, f.id DESC
              LIMIT 1
           ) latest_form ON true
          ORDER BY p.created_at DESC`
      );
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
          screeningPrecalificacionEnabled: z.boolean().default(true),
          screeningEntrevistaEnabled: z.boolean().default(true),
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
            `UPDATE job_positions SET code=$1,title=$2,department=$3,location_label=$4,description=$5,agent_key=$6,whatsapp_message=$7,default_country=$8,published=$9,screening_precalificacion_enabled=$10,screening_entrevista_enabled=$11,updated_at=now() WHERE id=$12 RETURNING *`,
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
              input.screeningPrecalificacionEnabled,
              input.screeningEntrevistaEnabled,
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
          `INSERT INTO job_positions (public_slug,code,title,department,location_label,description,agent_key,whatsapp_message,default_country,published,screening_precalificacion_enabled,screening_entrevista_enabled,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
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
            input.screeningPrecalificacionEnabled,
            input.screeningEntrevistaEnabled,
            ctx.user.id,
          ]
        );
        await pool.query(
          `INSERT INTO application_forms (job_position_id,version,title,intro,published,public_token,created_by_user_id) VALUES ($1,1,$2,$3,false,$4,$5)`,
          [
            result.rows[0].id,
            `Formulario · ${normalizedInput.title}`,
            "Complete sus datos para postularse a esta plaza.",
            createFormPublicToken(),
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
    markRead: roleProcedure
      .input(z.object({ conversationId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) =>
        markInboxRead(await requirePool(), input.conversationId, ctx.user.id)
      ),
    syncNow: roleProcedure.mutation(async ({ ctx }) => {
      try {
        const pool = await requirePool();
        const result = await manualInboxSync(pool);
        await pool.query(
          `INSERT INTO audit_log
             (actor_user_id,entity_type,entity_id,action,after_json)
           VALUES ($1,'conversation',NULL,'inbox_sync_manual',$2::jsonb)`,
          [
            ctx.user.id,
            JSON.stringify({
              processed: result.processed,
              inserted: result.inserted,
              skipped: result.skipped,
              failures: result.failures,
              conversations: result.conversations,
            }),
          ]
        );
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: safeIntegrationMessage(
            error,
            "No fue posible sincronizar la bandeja con el proveedor."
          ),
        });
      }
    }),
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
            limit: z.number().int().min(1).max(200).optional(),
          })
          .optional()
      )
      .query(async ({ input, ctx }) =>
        listInbox(await requirePool(), { ...(input ?? {}), userId: ctx.user.id })
      ),
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
        z
          .object({
            conversationId: z.number().int().positive(),
            fileUrl: z.string().url().max(2_000).optional(),
            dataBase64: z.string().min(1).max(28_000_000).optional(),
            fileName: z.string().trim().max(260).optional(),
            caption: z.string().trim().max(1_000).optional(),
          })
          .refine(input => Boolean(input.fileUrl || input.dataBase64), {
            message: "Adjunte un archivo o indique su URL.",
          })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          const pool = await requirePool();
          return await sendInboxFile(pool, {
            ...input,
            actorUserId: ctx.user.id,
            publicBaseUrl: resolvePublicBaseUrl(
              ctx.req.headers,
              await resolveApiChatPublicBaseUrl(pool)
            ),
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
        z
          .object({
            conversationId: z.number().int().positive(),
            audioUrl: z.string().url().max(2_000).optional(),
            dataBase64: z.string().min(1).max(22_000_000).optional(),
            mimeType: z.string().trim().max(120).optional(),
            fileName: z.string().trim().max(180).optional(),
          })
          .refine(input => Boolean(input.audioUrl || input.dataBase64), {
            message: "Grabe una nota de voz o indique su URL.",
          })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          const pool = await requirePool();
          return await sendInboxPtt(pool, {
            ...input,
            actorUserId: ctx.user.id,
            publicBaseUrl: resolvePublicBaseUrl(
              ctx.req.headers,
              await resolveApiChatPublicBaseUrl(pool)
            ),
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

  conversation: router({
    state: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ input }) =>
        conversationPanelState(await requirePool(), input.applicationId)
      ),
    runNow: roleProcedure
      .input(z.object({ conversationId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          return await runConversationTurn(await requirePool(), {
            conversationId: input.conversationId,
          });
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible ejecutar el turno conversacional."
            ),
          });
        }
      }),
    dispatch: adminProcedure.mutation(async () => {
      try {
        return await dispatchQueuedReplies(await requirePool());
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: safeIntegrationMessage(
            error,
            "No fue posible despachar la cola conversacional."
          ),
        });
      }
    }),
  }),

  /**
   * Bitácora de la IA del agente conversacional, visible en la ficha de
   * Revisión Humana. Es de solo lectura: el tablero se compone con el asiento
   * vigente de cada etapa en el orden administrado y no asienta actividad.
   */
  agentLog: router({
    trace: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ input }) =>
        agentLogTrace(await requirePool(), input.applicationId)
      ),
  }),

  /**
   * RAG personal del candidato. Vive en la ficha de Revisión Humana y es
   * exclusivo del proceso de evaluación de esa persona: administra carpetas,
   * documentos, análisis de IA y visor con la misma configuración de
   * extensiones y peso que el RAG de proyectos.
   *
   * Lectura y operación están disponibles para Administración y Reclutamiento,
   * porque son quienes conducen el proceso; toda escritura queda auditada.
   */
  candidateKnowledge: router({
    /**
     * Expediente de CV de una postulación para la ficha administrativa: el
     * estado del ciclo y los documentos recibidos con su esencia.
     */
    cvAnalysis: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const state = await cvAwaitingState(pool, input.applicationId);
        const documents = await pool.query(
          `SELECT id,original_name,source,extension,analysis_status,
                  cv_essence,cv_essence_status,cv_essence_word_limit,
                  cv_essence_updated_at,uploaded_at
             FROM candidate_knowledge_files
            WHERE application_id=$1
            ORDER BY uploaded_at DESC LIMIT 10`,
          [input.applicationId]
        );
        return { state, documents: documents.rows };
      }),
    /**
     * Genera la esencia del CV de un documento del expediente. Aplica el
     * límite de palabras vigente y deja asiento propio en la auditoría.
     */
    generateCvEssence: roleProcedure
      .input(z.object({ fileId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) =>
        analyzeCandidateCvEssence(await requirePool(), {
          fileId: input.fileId,
          actorUserId: ctx.user.id,
        })
      ),
    tree: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ input }) =>
        candidateKnowledgeTree(await requirePool(), input.applicationId)
      ),
    storageHealth: roleProcedure.query(async () =>
      candidateKnowledgeHealth(await getPool())
    ),
    /** Vale del visor: las etiquetas `iframe`, `img`, `video` y `audio` las
     *  resuelve el navegador y no llevan cabeceras de sesión. */
    viewerToken: roleProcedure
      .input(z.object({ fileId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT id FROM candidate_knowledge_files WHERE id=$1 LIMIT 1`,
          [input.fileId]
        );
        if (!result.rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El documento del candidato no existe.",
          });
        }
        return { token: createViewerToken("candidate", input.fileId) };
      }),
    /** Árbol real de la carpeta del expediente en Dropbox: muestra la misma
     *  estructura que el usuario ve en su carpeta, con nombres originales. */
    dropboxTree: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          path: z.string().max(400).optional(),
        })
      )
      .query(async ({ input }) => {
        const pool = await requirePool();
        try {
          return await listApplicationDropboxTree(
            pool,
            input.applicationId,
            input.path ?? ""
          );
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible leer la carpeta del candidato en Dropbox."
            ),
          });
        }
      }),
    /** Vale del visor por ruta del expediente, con el alcance de Dropbox. */
    dropboxFileToken: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          path: z.string().min(1).max(400),
        })
      )
      .query(async ({ input }) => {
        const pool = await requirePool();
        const projectId = await projectIdForApplication(
          pool,
          input.applicationId
        );
        if (projectId == null) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "La postulación no tiene proyecto vinculado.",
          });
        }
        return {
          token: createViewerToken("dropbox", `${projectId}:${input.path}`),
          projectId,
          path: input.path,
        };
      }),
    upload: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          folderId: z.number().int().positive().nullable().optional(),
          fileName: z.string().trim().min(1).max(260),
          base64: z.string().min(1).max(40 * 1024 * 1024),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        // La política de extensiones y peso es la misma que la del RAG de
        // proyectos: una sola configuración gobierna ambos módulos.
        const settings = await getKnowledgeSettings(pool);
        try {
          const saved = await saveCandidateDocument(pool, {
            applicationId: input.applicationId,
            folderId: input.folderId ?? null,
            fileName: input.fileName,
            base64: input.base64,
            source: "manual",
            actorUserId: ctx.user.id,
            allowedExtensions: settings.allowedExtensions,
            maxBytes: settings.maxSizeMb * 1024 * 1024,
          });
          const analysis = await analyzeCandidateDocument(
            pool,
            saved.id,
            ctx.user.id
          );
          return { id: saved.id, analysisMessage: analysis.message };
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible guardar el documento del candidato.",
          });
        }
      }),
    analyze: roleProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await analyzeCandidateDocument(
            await requirePool(),
            input.id,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible analizar el documento.",
          });
        }
      }),
    saveAnalysis: roleProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          deepAnalysis: z.string().trim().max(8_000),
          summary: z.string().trim().max(1_600).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveCandidateAnalysis(
            await requirePool(),
            input,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible guardar el análisis.",
          });
        }
      }),
    move: roleProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          folderId: z.number().int().positive().nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await moveCandidateDocument(
            await requirePool(),
            input,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible mover el documento.",
          });
        }
      }),
    delete: roleProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await deleteCandidateDocument(
            await requirePool(),
            input.id,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible eliminar el documento.",
          });
        }
      }),
    saveFolder: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          folderId: z.number().int().positive().nullable().optional(),
          parentId: z.number().int().positive().nullable().optional(),
          name: z.string().trim().min(1).max(160),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveCandidateFolder(
            await requirePool(),
            {
              applicationId: input.applicationId,
              folderId: input.folderId ?? null,
              parentId: input.parentId ?? null,
              name: input.name,
            },
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible guardar la carpeta.",
          });
        }
      }),
    deleteFolder: roleProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await deleteCandidateFolder(
            await requirePool(),
            input.id,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible eliminar la carpeta.",
          });
        }
      }),
    /**
     * Adjuntos conservados en la bandeja que no constan en el expediente.
     *
     * Se leen del mismo conjunto que cuenta el diagnóstico del conducto como
     * rechazo de ingreso: la ficha declara lo que el diagnóstico numera.
     */
    conservedAttachments: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ input }) =>
        listConservedAttachments(await requirePool(), input.applicationId)
      ),
    /**
     * Adjuntos anunciados cuyo contenido nunca llegó.
     *
     * Se declaran por separado de los conservados porque son un hecho distinto:
     * aquí no hay binario que incorporar. La sentencia que los describe —causa y
     * remedio— procede del mismo catálogo que lee la bandeja, de modo que las dos
     * superficies no vuelvan a afirmar cosas contrarias sobre el mismo mensaje.
     */
    announcedAttachments: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ input }) =>
        listUnresolvedAttachments(await requirePool(), input.applicationId)
      ),
    /**
     * Carga manual de un anuncio desde la dirección que declaró el proveedor.
     *
     * Es un acto humano explícito sobre una dirección concreta —no una descarga
     * automática— y usa el conducto guardado de la recepción: destino público,
     * sin credenciales, tope de peso y verificación por contenido. Traer el
     * archivo no lo incorpora: la política vigente sigue decidiendo.
     */
    recoverAnnouncedAttachment: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          messageId: z.number().int().positive(),
          analyze: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await recoverAnnouncedAttachment(await requirePool(), {
            applicationId: input.applicationId,
            messageId: input.messageId,
            actorUserId: ctx.user.id,
            analyze: input.analyze ?? true,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible traer el adjunto anunciado.",
          });
        }
      }),
    /**
     * Incorpora al expediente los adjuntos conservados y ejecuta su análisis.
     *
     * La operación restituye la segunda decisión que el conducto no tenía: el
     * veredicto de política deja de ser terminal mientras el binario exista.
     */
    recoverConservedAttachments: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          analyze: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await recoverConservedAttachments(await requirePool(), {
            applicationId: input.applicationId,
            actorUserId: ctx.user.id,
            analyze: input.analyze ?? true,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible incorporar los adjuntos conservados.",
          });
        }
      }),
    /**
     * Acuse del expediente al candidato. Idempotente y con control humano: la
     * conversación debe estar tomada por una persona para que el mensaje salga.
     */
    acknowledgeExpediente: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) =>
        dispatchExpedienteAppreciation(await requirePool(), {
          applicationId: input.applicationId,
          actorUserId: ctx.user.id,
        })
      ),
    /**
     * Pase automático sobre los anuncios con dirección declarada.
     *
     * Lo dispara la apertura de la ficha cuando el reclutador no pulsó el
     * cohete. El reclamo, la ventana de silencio y el tope viven en la base: el
     * descarte ocurre antes de abrir ninguna conexión hacia afuera, de modo que
     * abrir la ficha muchas veces no multiplica las descargas.
     */
    autoRecoverAnnounced: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) =>
        autoRecoverAnnounced(await requirePool(), {
          applicationId: input.applicationId,
          actorUserId: ctx.user.id,
        })
      ),
  }),

  governance: router({
    catalog: adminProcedure.query(async () => {
      const pool = await requirePool();
      const coverage = await listGovernanceCoverage(pool);
      const coverageByRule = new Map(
        coverage.rules.map(row => [row.ruleId, row])
      );
      const domains = ASSESSMENT_GOVERNANCE_DOMAINS.map(domain => {
        const rules = ASSESSMENT_GOVERNANCE_RULES.filter(
          rule => rule.domainCode === domain.code
        ).map(rule => {
          const row = coverageByRule.get(rule.id);
          return {
            ...rule,
            verifications: row?.verifications ?? 0,
            lastVerifiedAt: row?.lastVerifiedAt ?? null,
            lastTraceId: row?.lastTraceId ?? null,
          };
        });
        return {
          ...domain,
          verifications: rules.reduce(
            (total, rule) => total + rule.verifications,
            0
          ),
          lastVerifiedAt:
            rules
              .map(rule => rule.lastVerifiedAt)
              .filter((value): value is string => Boolean(value))
              .sort()
              .at(-1) ?? null,
          rules,
        };
      });
      return {
        tableReady: coverage.tableReady,
        notice: GOVERNANCE_MONITORING_NOTICE,
        totalVerifications: coverage.totalVerifications,
        lastVerifiedAt: coverage.lastVerifiedAt,
        domains,
      };
    }),
    verify: adminProcedure
      .input(
        z.object({
          ruleIds: z
            .array(z.string().regex(/^[A-Z]{3}-[0-9]{2}$/))
            .min(1)
            .max(ASSESSMENT_GOVERNANCE_RULES.length),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const pool = await requirePool();
        try {
          const connection = await verifyLangfuseConnection(pool);
          const registration = await registerGovernanceVerification(pool, {
            ruleIds: input.ruleIds,
            traceId: connection.traceId,
            environment: connection.environment,
            release: APP_VERSION,
            actorUserId: ctx.user?.id ?? null,
            actorEmail: ctx.user?.email ?? null,
          });
          return {
            success: true as const,
            traceId: connection.traceId,
            environment: connection.environment,
            registered: registration.registered,
          };
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible registrar la verificación de gobierno."
            ),
          });
        }
      }),
  }),

  /**
   * Registro de códecs y decodificadores del transporte.
   *
   * La lectura la hace el panel de configuración; la escritura es
   * administrativa y queda auditada. El catálogo se declara completo a
   * propósito: el operador ve todo lo que puede llegar por el webhook, no solo
   * lo que el artefacto ya sabe procesar.
   */
  codecs: router({
    catalog: roleProcedure.query(async () => codecRegistry(await getPool())),
    save: adminProcedure
      .input(
        z.object({
          enabled: z.record(z.string().min(1).max(80), z.boolean()),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        await saveCodecSettings(pool, {
          enabled: input.enabled,
          actorUserId: ctx.user.id,
        });
        return codecRegistry(pool);
      }),
  }),

  /**
   * Roles de Seguridad · permisos por usuario.
   *
   * Todo el módulo es `adminProcedure`: el agente y un reclutador no pueden
   * concederse acceso a sí mismos. La escritura exige un código de seis dígitos
   * que viaja solo por correo, de modo que ningún permiso cambia sin
   * confirmación institucional.
   */
  /**
   * Agente del reclutador.
   *
   * Análisis interno del expediente de un candidato. **No expone ninguna
   * escritura** sobre la evaluación, el estado ni la decisión: solo consulta,
   * responde y registra el hilo. La carga de documentos alimenta el RAG
   * personal por el procedimiento que ya existe en el expediente.
   */
  recruiterAgent: router({
    thread: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const settings = await getAgentRuntimeSettings(pool);
        const thread = await recruiterThreadFor(pool, input.applicationId);
        return {
          messages: await loadRecruiterHistory(pool, input.applicationId),
          model: effectiveRecruiterModel({
            conversationModel: thread.model,
            institutionalModel: settings.model,
          }),
          models: RECRUITER_AGENT_MODELS,
        };
      }),
    ask: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          question: z
            .string()
            .trim()
            .min(1)
            .max(RECRUITER_AGENT_MAX_QUESTION_CHARS),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const outcome = await askRecruiterAgent(pool, {
          applicationId: input.applicationId,
          actorUserId: ctx.user.id,
          question: input.question,
        });
        if (!outcome.ok)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: outcome.reason,
          });
        return outcome;
      }),
    setModel: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          model: z.string().trim().max(120).nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const outcome = await setRecruiterThreadModel(pool, {
          applicationId: input.applicationId,
          model: input.model,
          actorUserId: ctx.user.id,
        });
        if (!outcome.ok)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: outcome.reason,
          });
        return outcome;
      }),
  }),

  /**
   * Auditoría del canal de ApiChat.
   *
   * **Solo lectura**: informa el estado del conducto, las pérdidas de recepción
   * y los fallos de entrega. No reintenta envíos, no cambia estados y no altera
   * ninguna evaluación: su función es que el fallo deje de ser invisible.
   */
  apiChatAudit: router({
    report: roleProcedure.query(async () =>
      apiChatChannelReport(await requirePool())
    ),
    /**
     * Conducto del adjunto: recepción durable, registro documental y derivación.
     *
     * Cierra el punto ciego que hacía indistinguible «no llegó» de «llegó y
     * murió»: la cola de recepción y la de procesamiento existían sin superficie
     * de lectura. El veredicto informa el eslabón más temprano con evidencia y
     * declara la incógnita cuando una fuente falla, en lugar de resumirla como
     * ausencia de adjuntos.
     */
    pipeline: roleProcedure.query(async () =>
      attachmentPipelineReport(await requirePool())
    ),
  }),

  security: router({
    /**
     * Visibilidad de las entradas del menú para la **cuenta que consulta**.
     *
     * Es la única lectura del módulo que no exige ser administrador: cada
     * cuenta necesita saber qué puede ver, y el administrador conserva todo por
     * rol. Devuelve únicamente la concesión de vista; las demás acciones no
     * viajan al menú porque el menú no las ejerce.
     */
    visibility: roleProcedure.query(async ({ ctx }) => {
      const pool = await requirePool();
      if (ctx.user.role === "admin") return { admin: true, visible: [] as string[] };
      const permissions = await loadUserPermissions(pool, ctx.user.id);
      const visible = securityModules()
        .filter(module =>
          permissionDecision({
            role: ctx.user.role,
            grants: Object.entries(permissions).map(([key, grant]) => {
              const [scope, resourceKey] = key.split(":");
              return {
                scope: scope ?? "",
                resourceKey: resourceKey ?? "",
                grant,
              };
            }),
            scope: "modulo",
            key: module.key,
            action: "view",
          })
        )
        .map(module => module.key);
      return { admin: false, visible };
    }),
    overview: adminProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const [permissions, recentActions, account] = await Promise.all([
          loadUserPermissions(pool, input.userId),
          recentUserActions(pool, input.userId),
          pool.query<{ email: string; name: string; role: string }>(
            `SELECT email,name,role FROM users WHERE id=$1 LIMIT 1`,
            [input.userId]
          ),
        ]);
        return {
          modules: securityModules(),
          resources: SECURITY_RESOURCES,
          actions: PERMISSION_ACTIONS.map(action => ({
            action,
            label: PERMISSION_LABELS[action],
          })),
          permissions,
          recentActions,
          account: account.rows[0] ?? null,
        };
      }),
    requestCode: adminProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const target = await pool.query<{ email: string; name: string }>(
          `SELECT email,name FROM users WHERE id=$1 LIMIT 1`,
          [input.userId]
        );
        const row = target.rows[0];
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El usuario no existe.",
          });
        const requester = await pool.query<{ email: string }>(
          `SELECT email FROM users WHERE id=$1 LIMIT 1`,
          [ctx.user.id]
        );
        const email = requester.rows[0]?.email;
        if (!email)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "La cuenta no registra un correo para la confirmación.",
          });
        try {
          return await requestSecurityChallenge(pool, {
            requestedByUserId: ctx.user.id,
            requestedByEmail: email,
            purpose: "permisos",
            targetUserId: input.userId,
            detail: `permisos de ${row.name} (${row.email})`,
            requestedIp: requestIp(ctx.req),
            sendCode: sendSecurityCode,
          });
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible solicitar el código de confirmación.",
          });
        }
      }),
    confirm: adminProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          code: z.string().trim().regex(/^\d{6}$/),
          grants: z
            .array(
              z.object({
                scope: z.enum(["modulo", "recurso"]),
                key: z.string().trim().min(1).max(120),
                grant: z.object({
                  view: z.boolean(),
                  read: z.boolean(),
                  write: z.boolean(),
                  edit: z.boolean(),
                  delete: z.boolean(),
                }),
              })
            )
            .max(200),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const target = await pool.query<{ role: string }>(
          `SELECT role FROM users WHERE id=$1 LIMIT 1`,
          [input.userId]
        );
        if (target.rows[0]?.role === "admin")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "El administrador conserva todos los módulos por rol: sus casillas no se editan.",
          });
        const verdict = await verifySecurityChallenge(pool, {
          requestedByUserId: ctx.user.id,
          purpose: "permisos",
          code: input.code,
        });
        if (!verdict.granted)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              verdict.reason === "codigo_invalido"
                ? `El código no corresponde al desafío vigente. Intentos restantes: ${verdict.attemptsRemaining}.`
                : verdict.reason === "expirado"
                  ? "El código caducó. Solicite uno nuevo."
                  : verdict.reason === "agotado"
                    ? "El desafío agotó sus cinco intentos. Solicite uno nuevo."
                    : "No hay un desafío vigente. Solicite el código.",
          });
        const permissions = await saveUserPermissions(pool, {
          userId: input.userId,
          grants: input.grants,
          actorUserId: ctx.user.id,
        });
        return { applied: true as const, permissions };
      }),
  }),

  evaluationAutomation: router({
    /**
     * Estado del ciclo automático y sus contadores. Los contadores son
     * **derivados**: los mueve cualquier camino de evaluación —evento, revisión
     * humana o el propio ciclo—, de modo que la superficie no puede discrepar
     * del estado real.
     */
    status: roleProcedure.query(async () => {
      const pool = await getPool();
      if (!pool)
        return {
          state: "apagado" as const,
          updatedAt: null,
          counters: {
            processed: 0,
            pending: 0,
            blocked: 0,
            lastEvaluationAt: null,
          },
        };
      const [automation, counters] = await Promise.all([
        getEvaluationAutomation(pool),
        evaluationAutomationCounters(pool),
      ]);
      return {
        state: automation.state,
        updatedAt: automation.updatedAt,
        counters,
      };
    }),
    /**
     * Solicita el código que autoriza encender o apagar el ciclo. El código
     * viaja solo por correo y no se revela en la respuesta.
     */
    requestCode: adminProcedure
      .input(
        z.object({ targetState: z.enum(["encendido", "apagado"]) })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const account = await pool.query<{ email: string }>(
          `SELECT email FROM users WHERE id=$1 LIMIT 1`,
          [ctx.user.id]
        );
        const email = account.rows[0]?.email;
        if (!email)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "La cuenta no registra un correo para la confirmación.",
          });
        try {
          return await requestEvaluationAutomationCode(pool, {
            targetState: input.targetState,
            actorUserId: ctx.user.id,
            actorEmail: email,
            requestedIp: requestIp(ctx.req),
          });
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible solicitar el código de confirmación.",
          });
        }
      }),
    /**
     * Confirma el cambio con el código recibido. Encender es inmediato;
     * apagar declara «deteniéndose» y el cese lo consuma el barrido entre
     * unidades.
     */
    confirm: adminProcedure
      .input(z.object({ code: z.string().trim().regex(/^\d{6}$/) }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const account = await pool.query<{ email: string }>(
          `SELECT email FROM users WHERE id=$1 LIMIT 1`,
          [ctx.user.id]
        );
        return confirmEvaluationAutomation(pool, {
          code: input.code,
          actorUserId: ctx.user.id,
          actorEmail: account.rows[0]?.email ?? "",
        });
      }),
  }),
  assessments: router({
    /**
     * Interruptor del ciclo de pruebas psicométricas. Encendido, el agente
     * inicia las pruebas activas de la plaza treinta segundos después de
     * recibir el formulario; apagado, no contacta por el webhook.
     */
    automation: roleProcedure.query(async () =>
      getAssessmentAutomation(await getPool())
    ),
    /**
     * Estado de la prueba psicométrica de una postulación y si el ciclo de las
     * nueve etapas de la IA quedó concluido: la prueba solo puede activarse
     * desde la ficha del candidato, nunca como flujo determinista.
     */
    applicationCycle: roleProcedure
      .input(z.object({ applicationId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const cycle = await pool.query<{
          id: number;
          state: string;
          ready_at: string | null;
        }>(
          `SELECT id,state,ready_at FROM assessment_cycles
            WHERE application_id=$1 ORDER BY id LIMIT 1`,
          [input.applicationId]
        );
        const conversation = await pool.query<{ automation_state: string }>(
          `SELECT automation_state FROM conversations
            WHERE application_id=$1 AND provider='apichat'
            ORDER BY id LIMIT 1`,
          [input.applicationId]
        );
        return {
          cycle: cycle.rows[0] ?? null,
          stagesCompleted:
            conversation.rows[0]?.automation_state === "completed",
        };
      }),
    /**
     * Interruptor por candidato de la prueba psicométrica: encendido programa
     * el ciclo solo si las etapas de la IA concluyeron; apagado cancela el
     * ciclo pendiente y rechaza apagar una prueba en curso.
     */
    toggleForApplication: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          enabled: z.boolean(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        if (input.enabled) {
          const result = await scheduleAssessmentCycle(
            pool,
            input.applicationId
          );
          if (!result.scheduled && result.reason === "etapas_incompletas") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "El candidato debe concluir las nueve etapas de la IA antes de activar la prueba psicométrica.",
            });
          }
          return result;
        }
        const cancelled = await pool.query(
          `DELETE FROM assessment_cycles
            WHERE application_id=$1 AND state='listo'
            RETURNING id`,
          [input.applicationId]
        );
        if (!cancelled.rows[0]) {
          const active = await pool.query<{ state: string }>(
            `SELECT state FROM assessment_cycles
              WHERE application_id=$1 ORDER BY id LIMIT 1`,
            [input.applicationId]
          );
          if (active.rows[0]?.state === "en_curso") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "La prueba psicométrica está en curso y no puede apagarse; ciérrela desde la prueba.",
            });
          }
        }
        await pool.query(
          `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
           VALUES ($1,'assessment_cycle',$2,'assessment_cycle_deactivated',$3::jsonb)`,
          [
            ctx.user.id,
            input.applicationId,
            JSON.stringify({ automatic: false }),
          ]
        );
        return { scheduled: false, reason: "desactivada" };
      }),
    saveAutomation: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input, ctx }) =>
        saveAssessmentAutomation(await requirePool(), {
          enabled: input.enabled,
          actorUserId: ctx.user.id,
        })
      ),
    /**
     * Cierra el ciclo de pruebas y ejecuta la re-evaluación automática. La
     * operación es idempotente: un ciclo ya concluido no vuelve a evaluarse.
     */
    completeCycle: roleProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          score: z.number().int().min(0).max(100).optional(),
        })
      )
      .mutation(async ({ input, ctx }) =>
        completeAssessmentCycle(await requirePool(), {
          applicationId: input.applicationId,
          score: input.score ?? null,
          actorUserId: ctx.user.id,
        })
      ),
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
        const activeCycles = await pool.query(
          `SELECT 1 FROM assessment_cycles
            WHERE protocol_id=$1 AND state IN ('listo','en_curso') LIMIT 1`,
          [input.id]
        );
        if (activeCycles.rows[0])
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "La versión tiene ciclos de evaluación en curso y no puede eliminarse.",
          });
        // La traza del acto pertenece al expediente: una versión que ya evaluó
        // conserva sus intentos registrados y no puede suprimirse.
        let linkedAttempts = false;
        try {
          const attempts = await pool.query(
            `SELECT 1 FROM assessment_item_attempts attempt
               JOIN assessment_items item ON item.id=attempt.item_id
              WHERE item.protocol_id=$1 LIMIT 1`,
            [input.id]
          );
          linkedAttempts = Boolean(attempts.rows[0]);
        } catch (error) {
          // Sin la migración de la traza no hay intentos que preservar.
          if (!isUndefinedTableError(error)) throw error;
        }
        if (linkedAttempts)
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
          const activeCycles = await client.query(
            `SELECT 1 FROM assessment_cycles
              WHERE protocol_id=$1 AND state IN ('listo','en_curso') LIMIT 1`,
            [input.id]
          );
          if (activeCycles.rows[0])
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "La versión tiene ciclos de evaluación en curso y no puede eliminarse.",
            });
          // La traza del acto pertenece al expediente y sobrevive a la versión.
          let linkedAttempts = false;
          try {
            const attempts = await client.query(
              `SELECT 1 FROM assessment_item_attempts attempt
                 JOIN assessment_items item ON item.id=attempt.item_id
                WHERE item.protocol_id=$1 LIMIT 1`,
              [input.id]
            );
            linkedAttempts = Boolean(attempts.rows[0]);
          } catch (error) {
            if (!isUndefinedTableError(error)) throw error;
          }
          if (linkedAttempts)
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
                  gd.name AS location_department,gm.name AS location_municipality,
                  COALESCE(answer_set.answers_summary,'') AS answers_summary
             FROM applications a
             JOIN candidates c ON c.id=a.candidate_id
             JOIN job_positions p ON p.id=a.job_position_id
             LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
             LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
             LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
             LEFT JOIN LATERAL (
               SELECT string_agg(
                        q.label || ': ' || left(COALESCE(aa.normalized_value,aa.value_json::text),90),
                        ' · ' ORDER BY q.order_index,q.id
                      ) AS answers_summary
                 FROM application_answers aa
                 JOIN form_questions q ON q.id=aa.question_id
                WHERE aa.application_id=a.id
             ) answer_set ON true
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
            applicationId: z.number().int().positive().optional(),
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
              .enum([
                "submitted_at",
                "name",
                "score",
                "status",
                "position",
                "human_review",
              ])
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
        if (input?.applicationId) {
          values.push(input.applicationId);
          clauses.push(`a.id = $${values.length}`);
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
          // Un expediente sin revisión humana no se hunde por su valor nulo:
          // se ordena por el extremo que le corresponde en cada dirección.
          human_review:
            "COALESCE(human_review.human_review_at,'epoch'::timestamptz)",
        } as const;
        const sortBy = input?.sortBy ?? "submitted_at";
        const sortDirection = input?.sortDirection === "asc" ? "ASC" : "DESC";
        const result = await pool.query(
          `SELECT
             a.id,a.status,a.submitted_at,a.evaluation_at,a.evaluation_reason,
             a.profile_summary,a.whatsapp_status,c.full_name,c.phone_international,
             c.email,p.id AS position_id,p.title AS position_title,p.public_slug,
             gz.name AS location_zone,gd.name AS location_department,
             gm.name AS location_municipality,co.name AS location_country,
             a.salary_expectation_gtq,a.salary_expectation_source,
             a.salary_expectation_captured_at,
             e.evaluation_id,e.evaluation_status,e.latest_reason,e.latest_profile_summary,
             e.ai_payload,e.ai_model,e.evaluation_created_at,
             ${scoreExpression} AS evaluation_score,
             human_review.human_review_at,human_review.human_review_action,
             human_review.human_review_actor,
             ${EXPEDIENTE_SIGNAL_COLUMNS},
             COALESCE(answer_set.answers,'[]'::jsonb) AS answers,
             COALESCE(submission_set.submissions,'[]'::jsonb) AS submissions
           FROM applications a
           JOIN candidates c ON c.id=a.candidate_id
           JOIN job_positions p ON p.id=a.job_position_id
           LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
           LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
           LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
           LEFT JOIN countries co ON co.id=gd.country_id
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
                        'formId',q.form_id,
                        'value',aa.value_json,
                        'normalizedValue',aa.normalized_value,
                        'deterministicResult',aa.deterministic_result
                      ) ORDER BY q.order_index,q.id
                    ) AS answers
               FROM application_answers aa
               JOIN form_questions q ON q.id=aa.question_id
              WHERE aa.application_id=a.id
           ) answer_set ON true
           LEFT JOIN LATERAL (
             SELECT al.created_at AS human_review_at,al.action AS human_review_action,
                    u.name AS human_review_actor
               FROM audit_log al
               LEFT JOIN users u ON u.id=al.actor_user_id
              WHERE al.entity_type='application' AND al.entity_id=a.id
                AND al.actor_user_id IS NOT NULL
                AND al.action IN ('status_changed','comment_added')
              ORDER BY al.created_at DESC,al.id DESC
              LIMIT 1
           ) human_review ON true
           ${EXPEDIENTE_SIGNAL_JOINS}
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
                      jsonb_build_object(
                        'formId',s.form_id,
                        'title',f.title,
                        'version',f.version,
                        'source',s.source,
                        'submittedAt',s.submitted_at
                      ) ORDER BY s.submitted_at DESC,s.id DESC
                    ) AS submissions
               FROM application_form_submissions s
               JOIN application_forms f ON f.id=s.form_id
              WHERE s.application_id=a.id
           ) submission_set ON true
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
          `SELECT q.form_id, q.label, q.field_key, aa.value_json, aa.normalized_value, aa.deterministic_result FROM application_answers aa JOIN form_questions q ON q.id=aa.question_id WHERE aa.application_id=$1 ORDER BY q.form_id, q.order_index`,
          [input.id]
        );
        const submissions = await pool.query(
          `SELECT s.form_id,s.source,s.submitted_at,f.title,f.version,f.source AS form_source,f.import_meta
             FROM application_form_submissions s
             JOIN application_forms f ON f.id=s.form_id
            WHERE s.application_id=$1
            ORDER BY s.submitted_at ASC,s.id ASC`,
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
          submissions: submissions.rows,
          evaluations: evaluations.rows.map(row => ({
            ...row,
            ai_payload: withBlockLabels(row.ai_payload),
          })),
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
        try {
          await client.query("BEGIN");
          const beforeResult = await client.query(
            `SELECT a.*,c.full_name,c.phone_international,p.title AS position_title,p.whatsapp_message
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
          // La solicitud del CV pertenece a la etapa «Solicitud del currículum»
          // del ciclo del agente: cambiar el estado de una postulación no la
          // despacha. El único proceso autorizado es el del ciclo administrado.
          const beforeApplication = { ...before };
          delete beforeApplication.full_name;
          delete beforeApplication.phone_international;
          delete beforeApplication.position_title;
          delete beforeApplication.whatsapp_message;
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
        return { success: true as const, application, audit };
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

  knowledge: router({
    settings: adminProcedure.query(async () => {
      return getKnowledgeSettings(await getPool());
    }),
    /**
     * Diagnóstico del volumen de conocimiento. Compara el catálogo de la base
     * con los binarios presentes en disco: un documento registrado cuyo archivo
     * no está en el volumen explica que el visor no pueda abrirlo.
     */
    storageHealth: adminProcedure.query(async () => {
      return knowledgeStorageHealth(await getPool());
    }),
    /**
     * Acuña el vale del visor. El navegador solicita el archivo y el HTML de
     * vista previa fuera del ciclo de tRPC (etiquetas `iframe`, `img`, `video` y
     * `audio`), por lo que esas peticiones no llevan cabeceras propias. El vale
     * firmado con caducidad corta autoriza únicamente la lectura del archivo
     * indicado sin depender de la cookie de sesión.
     */
    viewerToken: adminProcedure
      .input(z.object({ fileId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT id FROM knowledge_files WHERE id=$1 LIMIT 1`,
          [input.fileId]
        );
        if (!result.rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El archivo no existe.",
          });
        }
        return { token: createViewerToken("knowledge", input.fileId) };
      }),
    saveSettings: adminProcedure
      .input(
        z.object({
          allowedExtensions: z
            .array(z.string().trim().min(2).max(8))
            .min(1)
            .max(20),
          maxSizeMb: z.number().int().min(1).max(30),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveKnowledgeSettings(
            await requirePool(),
            input,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar la configuración de conocimiento."
            ),
          });
        }
      }),
    projects: adminProcedure.query(async () => {
      const pool = await requirePool();
      const result = await pool.query(
        `SELECT p.id,p.name,p.summary,p.created_at,p.updated_at,
                (SELECT count(*)::int FROM knowledge_project_positions link WHERE link.project_id=p.id) AS position_count,
                (SELECT count(*)::int FROM knowledge_files f WHERE f.project_id=p.id) AS file_count,
                (SELECT count(*)::int FROM knowledge_folders fo WHERE fo.project_id=p.id) AS folder_count
           FROM knowledge_projects p
          ORDER BY lower(p.name)`
      );
      return result.rows;
    }),
    saveProject: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          name: z.string().trim().min(1).max(160),
          summary: z.string().trim().max(2000),
          positionIds: z.array(z.number().int().positive()).max(120).default([]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const project = input.id
            ? (
                await client.query(
                  `UPDATE knowledge_projects
                      SET name=$1,summary=$2,updated_at=now()
                    WHERE id=$3 RETURNING id`,
                  [input.name, input.summary, input.id]
                )
              ).rows[0]
            : (
                await client.query(
                  `INSERT INTO knowledge_projects (name,summary,created_by_user_id)
                   VALUES ($1,$2,$3) RETURNING id`,
                  [input.name, input.summary, ctx.user.id]
                )
              ).rows[0];
          if (!project) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "El proyecto no existe.",
            });
          }
          const projectId = Number(project.id);
          const ids = Array.from(new Set(input.positionIds));
          const valid = ids.length
            ? (
                await client.query(
                  `SELECT id FROM job_positions WHERE id=ANY($1::int[])`,
                  [ids]
                )
              ).rows.map((row: { id: number }) => Number(row.id))
            : [];
          await client.query(
            `DELETE FROM knowledge_project_positions WHERE project_id=$1`,
            [projectId]
          );
          for (const positionId of valid) {
            await client.query(
              `INSERT INTO knowledge_project_positions (project_id,position_id,created_by_user_id)
               VALUES ($1,$2,$3) ON CONFLICT (project_id,position_id) DO NOTHING`,
              [projectId, positionId, ctx.user.id]
            );
          }
          await client.query(
            `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
             VALUES ($1,'knowledge_project',$2,$3,$4::jsonb)`,
            [
              ctx.user.id,
              projectId,
              input.id ? "project_updated" : "project_created",
              asJson({ name: input.name, positionIds: valid }),
            ]
          );
          await client.query("COMMIT");
          return { id: projectId, positionIds: valid };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    deleteProject: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const keys = await client.query(
            `SELECT storage_key FROM knowledge_files WHERE project_id=$1`,
            [input.id]
          );
          const deleted = await client.query(
            `DELETE FROM knowledge_projects WHERE id=$1 RETURNING id`,
            [input.id]
          );
          if (!deleted.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "El proyecto no existe.",
            });
          }
          await client.query(
            `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
             VALUES ($1,'knowledge_project',$2,'project_deleted')`,
            [ctx.user.id, input.id]
          );
          await client.query("COMMIT");
          for (const row of keys.rows) {
            try {
              await removeKnowledgeFile(String(row.storage_key));
            } catch {
              // best effort
            }
          }
          return { deleted: true };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    projectPositions: adminProcedure
      .input(z.object({ projectId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT link.position_id,pos.title
             FROM knowledge_project_positions link
             JOIN job_positions pos ON pos.id=link.position_id
            WHERE link.project_id=$1
            ORDER BY lower(pos.title)`,
          [input.projectId]
        );
        return result.rows;
      }),
    saveProjectPositions: adminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          positionIds: z.array(z.number().int().positive()).max(120),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        const ids = Array.from(new Set(input.positionIds));
        try {
          await client.query("BEGIN");
          const project = await client.query(
            `SELECT id FROM knowledge_projects WHERE id=$1 FOR UPDATE`,
            [input.projectId]
          );
          if (!project.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "El proyecto no existe.",
            });
          }
          if (ids.length) {
            const valid = await client.query(
              `SELECT id FROM job_positions WHERE id = ANY($1::int[])`,
              [ids]
            );
            if (valid.rows.length !== ids.length) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Una de las plazas seleccionadas no existe.",
              });
            }
          }
          await client.query(
            `DELETE FROM knowledge_project_positions
              WHERE project_id=$1 AND NOT (position_id = ANY($2::int[]))`,
            [input.projectId, ids]
          );
          if (ids.length) {
            await client.query(
              `INSERT INTO knowledge_project_positions (project_id,position_id,created_by_user_id)
               SELECT $1, unnest($2::int[]), $3
               ON CONFLICT (project_id,position_id) DO NOTHING`,
              [input.projectId, ids, ctx.user.id]
            );
          }
          await client.query(
            `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
             VALUES ($1,'knowledge_project',$2,'project_positions_updated',$3::jsonb)`,
            [ctx.user.id, input.projectId, asJson({ positionIds: ids })]
          );
          await client.query("COMMIT");
          return { positionIds: ids };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    positionProjectsMatrix: adminProcedure.query(async () => {
      const pool = await requirePool();
      const result = await pool.query(
        `SELECT link.position_id,link.project_id,p.name AS project_name
           FROM knowledge_project_positions link
           JOIN knowledge_projects p ON p.id=link.project_id
          ORDER BY lower(p.name)`
      );
      return result.rows;
    }),
    savePositionProjects: adminProcedure
      .input(
        z.object({
          positionId: z.number().int().positive(),
          projectIds: z.array(z.number().int().positive()).max(60),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const client = await pool.connect();
        const ids = Array.from(new Set(input.projectIds));
        try {
          await client.query("BEGIN");
          const position = await client.query(
            `SELECT id FROM job_positions WHERE id=$1 FOR UPDATE`,
            [input.positionId]
          );
          if (!position.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "La plaza no existe.",
            });
          }
          if (ids.length) {
            const valid = await client.query(
              `SELECT id FROM knowledge_projects WHERE id = ANY($1::int[])`,
              [ids]
            );
            if (valid.rows.length !== ids.length) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Uno de los proyectos seleccionados no existe.",
              });
            }
          }
          await client.query(
            `DELETE FROM knowledge_project_positions
              WHERE position_id=$1 AND NOT (project_id = ANY($2::int[]))`,
            [input.positionId, ids]
          );
          if (ids.length) {
            await client.query(
              `INSERT INTO knowledge_project_positions (project_id,position_id,created_by_user_id)
               SELECT unnest($2::int[]), $1, $3
               ON CONFLICT (project_id,position_id) DO NOTHING`,
              [input.positionId, ids, ctx.user.id]
            );
          }
          await client.query(
            `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
             VALUES ($1,'job_position',$2,'position_projects_updated',$3::jsonb)`,
            [ctx.user.id, input.positionId, asJson({ projectIds: ids })]
          );
          await client.query("COMMIT");
          return { projectIds: ids };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }),
    folders: adminProcedure
      .input(z.object({ projectId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT f.id,f.project_id,f.parent_id,f.name,f.created_at,
                  (SELECT count(*)::int FROM knowledge_files kf WHERE kf.folder_id=f.id) AS file_count,
                  (SELECT count(*)::int FROM knowledge_folders kfo WHERE kfo.parent_id=f.id) AS child_count
             FROM knowledge_folders f
            WHERE f.project_id=$1
            ORDER BY f.parent_id NULLS FIRST, lower(f.name)`,
          [input.projectId]
        );
        return result.rows;
      }),
    createFolder: adminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          parentId: z.number().int().positive().nullable(),
          name: z.string().trim().min(1).max(160),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `INSERT INTO knowledge_folders (project_id,parent_id,name,created_by_user_id)
           VALUES ($1,$2,$3,$4) RETURNING id,name,parent_id,created_at`,
          [input.projectId, input.parentId, input.name, ctx.user.id]
        );
        await pool.query(
          `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
           VALUES ($1,'knowledge_folder',$2,'folder_created',$3::jsonb)`,
          [
            ctx.user.id,
            result.rows[0].id,
            asJson({ name: input.name, parentId: input.parentId }),
          ]
        );
        return result.rows[0];
      }),
    deleteFolder: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const deleted = await pool.query(
          `DELETE FROM knowledge_folders WHERE id=$1 RETURNING id`,
          [input.id]
        );
        if (!deleted.rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "La carpeta no existe.",
          });
        }
        await pool.query(
          `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
           VALUES ($1,'knowledge_folder',$2,'folder_deleted')`,
          [ctx.user.id, input.id]
        );
        return { deleted: true };
      }),
    files: adminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          folderId: z.number().int().positive().nullable(),
          kind: z.string().trim().max(16).optional(),
        })
      )
      .query(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT f.id,f.project_id,f.folder_id,f.original_name,f.mime_type,f.extension,f.size_bytes,
                  f.summary_66,f.deep_analysis,f.analysis_status,f.analyzed_model,
                  f.uploaded_at,f.updated_at,u.name AS uploaded_by_name,u.email AS uploaded_by_email
             FROM knowledge_files f
             LEFT JOIN users u ON u.id=f.uploaded_by_user_id
            WHERE f.project_id=$1
              AND (($2::int IS NULL AND f.folder_id IS NULL) OR f.folder_id=$2)
            ORDER BY f.uploaded_at DESC`,
          [input.projectId, input.folderId]
        );
        const wantedKind = input.kind?.trim();
        const rows = result.rows.filter(
          row =>
            !wantedKind ||
            wantedKind === "todas" ||
            knowledgeFileKind(String(row.extension)) === wantedKind
        );
        return rows;
      }),
    upload: adminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          folderId: z.number().int().positive().nullable(),
          fileName: z.string().trim().min(1).max(260),
          base64: z.string().min(1).max(40 * 1024 * 1024),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const settings = await getKnowledgeSettings(pool);
        // El archivo se transporta en base64 y se reconstruye «normal»: bytes
        // binarios, extensión final y MIME verificados por contenido. Una
        // discordancia no rechaza la carga —eso retiraría una capacidad ya
        // declarada—: se corrige la extensión, se registra en auditoría y el
        // visor recibe el tipo real.
        let decoded;
        try {
          decoded = decodeTransport(
            { dataBase64: input.base64, fileName: input.fileName },
            {
              allowedExtensions: settings.allowedExtensions,
              maxBytes: settings.maxSizeMb * 1024 * 1024,
            }
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "El contenido del archivo no es válido.",
          });
        }
        const buffer = decoded.buffer;
        const extension = decoded.extension;
        const kind = knowledgeFileKind(extension);
        const project = await pool.query(
          `SELECT id FROM knowledge_projects WHERE id=$1 LIMIT 1`,
          [input.projectId]
        );
        if (!project.rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El proyecto no existe.",
          });
        }
        if (input.folderId) {
          const folder = await pool.query(
            `SELECT id FROM knowledge_folders WHERE id=$1 AND project_id=$2 LIMIT 1`,
            [input.folderId, input.projectId]
          );
          if (!folder.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "La carpeta no existe.",
            });
          }
        }
        const storageKey = buildStorageKey(input.projectId, extension);
        await writeKnowledgeFile(storageKey, buffer);
        // El nombre visible se reconstruye con la extensión final verificada.
        const finalFileName = reconstructTransportFileName(
          input.fileName,
          extension
        );
        let fileId: number;
        try {
          const inserted = await pool.query(
            `INSERT INTO knowledge_files
               (project_id,folder_id,original_name,storage_key,mime_type,extension,size_bytes,
                analysis_status,uploaded_by_user_id,uploaded_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'pendiente',$8,now(),now())
             RETURNING id`,
            [
              input.projectId,
              input.folderId,
              finalFileName,
              storageKey,
              decoded.mimeType,
              extension,
              buffer.length,
              ctx.user.id,
            ]
          );
          fileId = Number(inserted.rows[0].id);
        } catch (error) {
          try {
            await removeKnowledgeFile(storageKey);
          } catch {
            // best effort
          }
          throw error;
        }
        await pool.query(
          `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
           VALUES ($1,'knowledge_file',$2,'file_uploaded',$3::jsonb)`,
          [
            ctx.user.id,
            fileId,
            asJson({
              originalName: input.fileName,
              extension,
              declaredExtension: extensionOfTransportName(input.fileName),
              mimeType: decoded.mimeType,
              detectedMimeType: decoded.detectedMimeType,
              contentTypeMismatch: decoded.contentTypeMismatch,
              transportVersion: decoded.version,
              sha256: decoded.sha256,
              sizeBytes: buffer.length,
              projectId: input.projectId,
            }),
          ]
        );
        let analysisMessage: string;
        if (kind === "documento" && ["pdf", "docx"].includes(extension)) {
          try {
            const text = await extractKnowledgeText(storageKey, extension);
            if (!text) {
              await pool.query(
                `UPDATE knowledge_files SET analysis_status='no_aplica',updated_at=now() WHERE id=$1`,
                [fileId]
              );
              analysisMessage =
                "El documento no contiene texto extraíble; no se generó un análisis.";
            } else {
              const analysis = await analyzeKnowledgeDocument(
                pool,
                fileId,
                text
              );
              await pool.query(
                `UPDATE knowledge_files
                    SET summary_66=$1,deep_analysis=$2,analysis_status='analizado',
                        analyzed_model=$3,updated_at=now()
                  WHERE id=$4`,
                [
                  analysis.summary,
                  analysis.deepAnalysis,
                  analysis.model,
                  fileId,
                ]
              );
              analysisMessage = "Análisis de IA generado correctamente.";
            }
          } catch (error) {
            await pool.query(
              `UPDATE knowledge_files SET analysis_status='error',updated_at=now() WHERE id=$1`,
              [fileId]
            );
            analysisMessage = `El archivo se guardó, pero el análisis no pudo generarse: ${
              error instanceof Error ? error.message : "error desconocido"
            }`;
          }
        } else {
          await pool.query(
            `UPDATE knowledge_files SET analysis_status='no_aplica',updated_at=now() WHERE id=$1`,
            [fileId]
          );
          analysisMessage =
            "El análisis de IA aplica únicamente a documentos PDF y Word.";
        }
        return { id: fileId, analysisMessage };
      }),
    analyze: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `SELECT id,storage_key,extension FROM knowledge_files WHERE id=$1 LIMIT 1`,
          [input.id]
        );
        const file = result.rows[0];
        if (!file) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El archivo no existe.",
          });
        }
        if (!["pdf", "docx"].includes(String(file.extension))) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El análisis de IA aplica únicamente a documentos PDF y Word.",
          });
        }
        const text = await extractKnowledgeText(
          String(file.storage_key),
          String(file.extension)
        );
        if (!text) {
          await pool.query(
            `UPDATE knowledge_files SET analysis_status='no_aplica',updated_at=now() WHERE id=$1`,
            [input.id]
          );
          return { analysisMessage: "El documento no contiene texto extraíble." };
        }
        const analysis = await analyzeKnowledgeDocument(pool, input.id, text);
        await pool.query(
          `UPDATE knowledge_files
              SET summary_66=$1,deep_analysis=$2,analysis_status='analizado',
                  analyzed_model=$3,updated_at=now()
            WHERE id=$4`,
          [analysis.summary, analysis.deepAnalysis, analysis.model, input.id]
        );
        return { analysisMessage: "Análisis de IA generado correctamente." };
      }),
    saveAnalysis: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          deepAnalysis: z.string().trim().max(8_000),
          summary: z.string().trim().max(1_600).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (countWords(input.deepAnalysis) > KNOWLEDGE_ANALYSIS_WORD_LIMIT) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El análisis profundo supera el máximo de ${KNOWLEDGE_ANALYSIS_WORD_LIMIT} palabras.`,
          });
        }
        if (
          input.summary &&
          countWords(input.summary) > KNOWLEDGE_SUMMARY_WORD_LIMIT
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El resumen supera el máximo de ${KNOWLEDGE_SUMMARY_WORD_LIMIT} palabras.`,
          });
        }
        const pool = await requirePool();
        const updated = await pool.query(
          `UPDATE knowledge_files
              SET deep_analysis=$1::varchar,
                  summary_66=COALESCE($2::varchar,summary_66),
                  analysis_status=CASE WHEN $1::varchar<>'' THEN 'analizado' ELSE analysis_status END,
                  updated_at=now()
            WHERE id=$3 RETURNING id`,
          [
            limitWords(input.deepAnalysis, KNOWLEDGE_ANALYSIS_WORD_LIMIT),
            input.summary
              ? limitWords(input.summary, KNOWLEDGE_SUMMARY_WORD_LIMIT)
              : null,
            input.id,
          ]
        );
        if (!updated.rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El archivo no existe.",
          });
        }
        await pool.query(
          `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
           VALUES ($1,'knowledge_file',$2,'file_analysis_updated')`,
          [ctx.user.id, input.id]
        );
        return { updated: true };
      }),
    moveFile: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          folderId: z.number().int().positive().nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const file = await pool.query(
          `SELECT project_id FROM knowledge_files WHERE id=$1 LIMIT 1`,
          [input.id]
        );
        if (!file.rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El archivo no existe.",
          });
        }
        if (input.folderId) {
          const folder = await pool.query(
            `SELECT id FROM knowledge_folders WHERE id=$1 AND project_id=$2 LIMIT 1`,
            [input.folderId, file.rows[0].project_id]
          );
          if (!folder.rows[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "La carpeta no existe en este proyecto.",
            });
          }
        }
        await pool.query(
          `UPDATE knowledge_files SET folder_id=$1,updated_at=now() WHERE id=$2`,
          [input.folderId, input.id]
        );
        await pool.query(
          `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
           VALUES ($1,'knowledge_file',$2,'file_moved',$3::jsonb)`,
          [ctx.user.id, input.id, asJson({ folderId: input.folderId })]
        );
        return { moved: true };
      }),
    deleteFile: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const deleted = await pool.query(
          `DELETE FROM knowledge_files WHERE id=$1 RETURNING storage_key`,
          [input.id]
        );
        if (!deleted.rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El archivo no existe.",
          });
        }
        try {
          await removeKnowledgeFile(String(deleted.rows[0].storage_key));
        } catch {
          // best effort
        }
        await pool.query(
          `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
           VALUES ($1,'knowledge_file',$2,'file_deleted')`,
          [ctx.user.id, input.id]
        );
        return { deleted: true };
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
      .input(
        z.object({
          positionId: z.number(),
          formId: z.number().int().positive().optional(),
        })
      )
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return null;
        const form = input.formId
          ? await pool.query(
              `SELECT * FROM application_forms WHERE id=$1 AND job_position_id=$2 LIMIT 1`,
              [input.formId, input.positionId]
            )
          : await pool.query(
              `SELECT * FROM application_forms WHERE job_position_id=$1 ORDER BY version DESC, id DESC LIMIT 1`,
              [input.positionId]
            );
        if (!form.rows[0]) return null;
        const questions = await pool.query(
          `SELECT * FROM form_questions WHERE form_id=$1 ORDER BY order_index`,
          [form.rows[0].id]
        );
        return { ...form.rows[0], questions: questions.rows };
      }),
    getPreview: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return null;
        const rows = await pool.query(
          `SELECT p.id, p.public_slug, p.title, p.department, p.location_label, p.description, p.agent_key,
                  p.published AS position_published,
                  f.id AS form_id, f.title AS form_title, f.intro AS form_intro,
                  f.version AS form_version, f.public_token AS form_token,
                  f.published AS form_published,
                  profile.responsibilities,
                  q.id AS question_id, q.field_key, q.label, q.help_text, q.type, q.required,
                  q.order_index, q.answer_config
             FROM application_forms f
             JOIN job_positions p ON p.id = f.job_position_id
             LEFT JOIN LATERAL (
               SELECT jp.responsibilities
                 FROM job_profile_positions link
                 JOIN job_profiles jp ON jp.id = link.profile_id
                WHERE link.job_position_id = p.id
                  AND jp.active = true
                ORDER BY jp.updated_at DESC, jp.id DESC
                LIMIT 1
             ) profile ON true
             LEFT JOIN form_questions q ON q.form_id = f.id AND q.active = true
            WHERE f.id = $1
            ORDER BY q.order_index ASC`,
          [input.id]
        );
        const payload = publicFormPayload(rows.rows as PublicFormPayloadRow[]);
        if (!payload) return null;
        const state = rows.rows[0] as {
          form_published: boolean;
          position_published: boolean;
        };
        return {
          form: payload.form,
          position: {
            id: payload.id,
            title: payload.title,
            department: payload.department,
            locationLabel: payload.locationLabel,
            description: payload.description,
            responsibilities: payload.responsibilities,
          },
          questions: payload.questions,
          published: Boolean(state.form_published),
          positionPublished: Boolean(state.position_published),
          publicPath: `/apply/f/${payload.form.token}`,
        };
      }),
    listByPosition: roleProcedure
      .input(z.object({ positionId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return [];
        const forms = await pool.query(
          `SELECT f.id,f.version,f.title,f.intro,f.published,f.source,f.public_token,f.import_meta,f.updated_at,
                  (SELECT count(*)::int FROM form_questions q WHERE q.form_id=f.id) AS question_count,
                  (SELECT count(*)::int FROM application_form_submissions s WHERE s.form_id=f.id) AS submission_count
             FROM application_forms f
            WHERE f.job_position_id=$1
            ORDER BY f.version, f.id`,
          [input.positionId]
        );
        return forms.rows;
      }),
    importSpreadsheet: adminProcedure
      .input(
        z.object({
          positionId: z.number().int().positive(),
          fileName: z.string().trim().min(1).max(240),
          base64: z.string().min(1).max(9_000_000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        if (!/\.(csv|xlsx|xls)$/i.test(input.fileName))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Importe únicamente archivos CSV o Excel (.csv, .xlsx, .xls).",
          });
        let buffer: Buffer;
        try {
          buffer = Buffer.from(input.base64, "base64");
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El archivo recibido no es una codificación base64 válida.",
          });
        }
        if (buffer.length > 5 * 1024 * 1024)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La hoja supera el peso máximo de 5 MB.",
          });
        try {
          // La importación incorpora candidatos, postulaciones y respuestas de
          // una sola vez, pero conserva el formulario en borrador y NO ejecuta
          // la evaluación automática con IA: esa evaluación se solicita cuando
          // la persona responsable lo decida, para no cargar la infraestructura.
          return await importSpreadsheetForm(pool, {
            positionId: input.positionId,
            fileName: input.fileName,
            buffer,
            actorUserId: ctx.user.id,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible importar la hoja de cálculo.",
          });
        }
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
          `INSERT INTO application_forms (job_position_id,version,title,intro,published,public_token,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            input.positionId,
            version.rows[0].version,
            normalizedInput.title,
            normalizedInput.intro ?? null,
            false,
            createFormPublicToken(),
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

  screening: router({
    listQuestions: roleProcedure
      .input(z.object({ positionId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await getPool();
        if (!pool) return [];
        const result = await pool.query(
          `SELECT * FROM screening_questions
            WHERE job_position_id=$1
            ORDER BY phase, order_index, id`,
          [input.positionId]
        );
        return result.rows;
      }),
    saveQuestion: adminProcedure
      .input(
        z.object({
          id: z.number().optional(),
          positionId: z.number().int().positive(),
          phase: z.enum(["precalificacion", "entrevista"]),
          fieldKey: z.string().min(2).max(100),
          prompt: z.string().min(2),
          helpText: z.string().max(600).optional(),
          type: z.string().min(2).max(40).default("texto"),
          orderIndex: z.number().int().default(0),
          hardFail: z.boolean().default(false),
          acceptedAnswers: z.array(z.unknown()).default([]),
          answerConfig: z.record(z.string(), z.unknown()).default({}),
          evaluationCriteria: z.string().max(2000).optional(),
          dependsOnFieldKey: z.string().max(100).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
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
        if (input.id) {
          const result = await pool.query(
            `UPDATE screening_questions
                SET phase=$1,field_key=$2,prompt=$3,help_text=$4,type=$5,
                    order_index=$6,hard_fail=$7,accepted_answers=$8::jsonb,
                    answer_config=$9::jsonb,evaluation_criteria=$10,
                    depends_on_field_key=$11,updated_at=now()
              WHERE id=$12 AND job_position_id=$13
              RETURNING *`,
            [
              input.phase,
              input.fieldKey,
              input.prompt,
              input.helpText ?? null,
              input.type,
              input.orderIndex,
              input.hardFail,
              JSON.stringify(input.acceptedAnswers),
              JSON.stringify(input.answerConfig),
              input.evaluationCriteria ?? null,
              input.dependsOnFieldKey ?? null,
              input.id,
              input.positionId,
            ]
          );
          if (!result.rows[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Pregunta no encontrada en esta plaza.",
            });
          return result.rows[0];
        }
        const result = await pool.query(
          `INSERT INTO screening_questions
             (job_position_id,phase,field_key,prompt,help_text,type,order_index,
              hard_fail,accepted_answers,answer_config,evaluation_criteria,
              depends_on_field_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
           RETURNING *`,
          [
            input.positionId,
            input.phase,
            input.fieldKey,
            input.prompt,
            input.helpText ?? null,
            input.type,
            input.orderIndex,
            input.hardFail,
            JSON.stringify(input.acceptedAnswers),
            JSON.stringify(input.answerConfig),
            input.evaluationCriteria ?? null,
            input.dependsOnFieldKey ?? null,
          ]
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
            `SELECT job_position_id,phase FROM screening_questions WHERE id=$1 FOR UPDATE`,
            [input.id]
          );
          if (!current.rows[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Pregunta no encontrada.",
            });
          await client.query(`DELETE FROM screening_questions WHERE id=$1`, [
            input.id,
          ]);
          await client.query(
            `WITH ordered AS (
               SELECT id, row_number() OVER (ORDER BY order_index,id)-1 AS new_order
                 FROM screening_questions
                WHERE job_position_id=$1 AND phase=$2
             )
             UPDATE screening_questions q SET order_index=ordered.new_order
               FROM ordered WHERE q.id=ordered.id`,
            [current.rows[0].job_position_id, current.rows[0].phase]
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
    setQuestionActive: adminProcedure
      .input(z.object({ id: z.number(), active: z.boolean() }))
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        const result = await pool.query(
          `UPDATE screening_questions SET active=$1,updated_at=now()
            WHERE id=$2 RETURNING *`,
          [input.active, input.id]
        );
        if (!result.rows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pregunta no encontrada.",
          });
        return result.rows[0];
      }),
    setPhaseEnabled: adminProcedure
      .input(
        z.object({
          positionId: z.number().int().positive(),
          phase: z.enum(["precalificacion", "entrevista"]),
          enabled: z.boolean(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const pool = await requirePool();
        const column =
          input.phase === "precalificacion"
            ? "screening_precalificacion_enabled"
            : "screening_entrevista_enabled";
        const result = await pool.query(
          `UPDATE job_positions SET ${column}=$1,updated_at=now()
            WHERE id=$2 RETURNING *`,
          [input.enabled, input.positionId]
        );
        if (!result.rows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Plaza no encontrada.",
          });
        await pool.query(
          `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
           VALUES ($1,'job_position',$2,'screening_phase_toggled',$3::jsonb)`,
          [
            ctx.user.id,
            input.positionId,
            JSON.stringify({ phase: input.phase, enabled: input.enabled }),
          ]
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
            `SELECT id,job_position_id,phase,order_index FROM screening_questions
              WHERE id=$1 FOR UPDATE`,
            [input.id]
          );
          if (!current.rows[0])
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Pregunta no encontrada.",
            });
          const delta = input.direction === "up" ? -1 : 1;
          const target = await client.query(
            `SELECT id,order_index FROM screening_questions
              WHERE job_position_id=$1 AND phase=$2 AND order_index=$3
              ORDER BY id LIMIT 1 FOR UPDATE`,
            [
              current.rows[0].job_position_id,
              current.rows[0].phase,
              current.rows[0].order_index + delta,
            ]
          );
          if (target.rows[0]) {
            await client.query(
              `UPDATE screening_questions SET order_index=$1 WHERE id=$2`,
              [current.rows[0].order_index, target.rows[0].id]
            );
            await client.query(
              `UPDATE screening_questions SET order_index=$1 WHERE id=$2`,
              [target.rows[0].order_index, current.rows[0].id]
            );
          }
          const result = await client.query(
            `SELECT * FROM screening_questions WHERE id=$1`,
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
          primaryProvider: z.enum(providerValues),
          deepseekModel: z.enum(deepseekModelValues),
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
          input.key.startsWith("deepseek_") &&
          !input.value.startsWith("sk-")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La API key de DeepSeek debe comenzar con sk-.",
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
    verifyProvider: adminProcedure
      .input(
        z.object({
          provider: z.enum(providerValues),
          slot: z.enum(["primary", "backup"]),
        })
      )
      .mutation(async ({ input }) => {
        try {
          return await verifyProviderConnection(
            await requirePool(),
            input.provider,
            input.slot
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              `No fue posible verificar la conexión con ${input.provider}.`
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

  agentStages: router({
    configuration: adminProcedure.query(async () => {
      const configuration = await loadAgentStageConfiguration(
        await getPool()
      );
      return buildAgentStagesView(configuration);
    }),
    save: adminProcedure
      .input(
        z.object({
          flowEnabled: z.boolean(),
          enabled: z.record(z.enum(AGENT_STAGE_KEYS), z.boolean()),
          order: z.array(z.enum(AGENT_STAGE_KEYS)).length(AGENT_STAGE_KEYS.length),
          messages: z.object({
            bienvenida_formulario: z.string().trim().max(1_000),
            solicitud_cv: z.string().trim().max(1_000),
            confirmacion_cv: z.string().trim().max(1_000),
            recordatorio_cv: z.string().trim().max(1_000),
            pregunta_salario: z.string().trim().max(1_000),
            confirmacion_salario: z.string().trim().max(1_000),
            aviso_contacto: z.string().trim().max(1_000),
          }),
          instructions: z.record(
            z.enum(AGENT_STAGE_INSTRUCTION_KEYS),
            z.string().trim().max(2_000)
          ),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          // El comportamiento del agente y la evaluación automática son
          // modos excluyentes: con el ciclo automático activo no puede
          // encenderse el flujo de etapas.
          if (input.flowEnabled) {
            const automation = await getEvaluationAutomation(
              await requirePool()
            );
            if (automation.state !== "apagado") {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "La evaluación automática está activa: apáguela para encender el comportamiento del agente.",
              });
            }
          }
          return await saveAgentStageConfiguration(
            await requirePool(),
            input,
            ctx.user.id
          );
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar las etapas del agente."
            ),
          });
        }
      }),
    /**
     * Plantilla de solicitud de CV del ciclo de evaluación automática, para
     * las postulaciones en cola. Vive junto a las etapas porque es parte del
     * mismo módulo administrativo, pero no es un mensaje de etapa.
     */
    automaticCvMessage: adminProcedure.query(async () => ({
      message: await loadAutomaticEvaluationCvMessage(await getPool()),
    })),
    saveAutomaticCvMessage: adminProcedure
      .input(z.object({ message: z.string().trim().max(1_000) }))
      .mutation(async ({ input, ctx }) => {
        try {
          return {
            message: await saveAutomaticEvaluationCvMessage(
              await requirePool(),
              input.message,
              ctx.user.id
            ),
          };
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar la plantilla de CV de la cola."
            ),
          });
        }
      }),
  }),

  storage: router({
    connection: roleProcedure.query(async ({ ctx }) => {
      return getDropboxConnection(await getPool(), ctx.user.id);
    }),
    unlink: roleProcedure.mutation(async ({ ctx }) => {
      const pool = await requirePool();
      try {
        return await unlinkDropboxConnection(pool, ctx.user.id, ctx.user.id);
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: safeIntegrationMessage(
            error,
            "No fue posible desconectar el Dropbox."
          ),
        });
      }
    }),
    projects: projectAdminProcedure.query(async () => {
      const pool = await requirePool();
      const result = await pool.query(
        `SELECT p.id,p.name,p.storage_mode,
                p.dropbox_connection_user_id,p.created_by_user_id,
                owner.name AS owner_name,
                dropbox.name AS dropbox_name,
                (SELECT count(*)::int FROM knowledge_files f WHERE f.project_id=p.id) AS file_count,
                (SELECT count(*)::int
                   FROM candidate_knowledge_files c
                   JOIN applications a ON a.id=c.application_id
                   JOIN knowledge_project_positions link ON link.position_id=a.job_position_id
                  WHERE link.project_id=p.id) AS candidate_file_count
           FROM knowledge_projects p
           LEFT JOIN users owner ON owner.id=p.created_by_user_id
           LEFT JOIN users dropbox ON dropbox.id=p.dropbox_connection_user_id
          ORDER BY lower(p.name)`
      );
      return result.rows;
    }),
    connectedUsers: projectAdminProcedure.query(async () => {
      const pool = await requirePool();
      const result = await pool.query(
        `SELECT u.id,u.name,u.email,u.role
           FROM users u
          WHERE EXISTS (
                  SELECT 1 FROM integration_settings s
                   WHERE s.provider='dropbox'
                     AND s.setting_key='refresh:' || u.id
                     AND s.is_secret
                     AND COALESCE(s.setting_value,'') <> ''
                )
          ORDER BY lower(u.name)`
      );
      return result.rows;
    }),
    projectProfile: projectAdminProcedure
      .input(z.object({ projectId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const pool = await requirePool();
        return projectStorageProfile(pool, input.projectId);
      }),
    projectTree: projectAdminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          path: z.string().max(400).optional(),
        })
      )
      .query(async ({ input }) => {
        const pool = await requirePool();
        try {
          return await listProjectDropboxTree(
            pool,
            input.projectId,
            input.path ?? ""
          );
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible leer la carpeta del proyecto en Dropbox."
            ),
          });
        }
      }),
    projectFileToken: projectAdminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          path: z.string().min(1).max(400),
        })
      )
      .query(({ input }) => ({
        token: createViewerToken(
          "dropbox",
          `${input.projectId}:${input.path}`
        ),
      })),
    setProjectStorage: projectAdminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          mode: z.enum(["local", "dropbox"]),
        })
      )
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        try {
          await setProjectStorageMode(pool, input.projectId, input.mode);
          return { ok: true as const };
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible conmutar el almacenamiento del proyecto."
            ),
          });
        }
      }),
    assignProjectConnection: projectAdminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          userId: z.number().int().positive().nullable(),
        })
      )
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        try {
          await assignProjectDropboxConnection(
            pool,
            input.projectId,
            input.userId
          );
          return { ok: true as const };
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible asignar la cuenta de Dropbox del proyecto."
            ),
          });
        }
      }),
    migrateProject: projectAdminProcedure
      .input(
        z.object({
          projectId: z.number().int().positive(),
          direction: z.enum(["to_dropbox", "to_local"]),
        })
      )
      .mutation(async ({ input }) => {
        const pool = await requirePool();
        try {
          return await migrateProjectStorage(
            pool,
            input.projectId,
            input.direction
          );
        } catch (error) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: safeIntegrationMessage(
              error,
              "No fue posible migrar los documentos del proyecto."
            ),
          });
        }
      }),
  }),

  config: router({
    cvAnalysis: adminProcedure.query(async () =>
      loadCvAnalysisConfiguration(await getPool())
    ),
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
    dropboxOAuthConfiguration: adminProcedure.query(async () => {
      return getDropboxOAuthConfiguration(await getPool());
    }),
    dropboxOAuthDiagnostics: adminProcedure.query(async () => {
      return dropboxOAuthDiagnostics(await getPool());
    }),
    apiChatReception: adminProcedure.query(async () => {
      return getApiChatReceptionReadiness(await getPool());
    }),
    apiChatEndpoints: adminProcedure.query(async () => {
      return getApiChatEndpoints(await getPool());
    }),
    /**
     * Configuración efectiva de la cuenta del proveedor.
     *
     * La lectura es de la base: la verificación contra el proveedor es un acto
     * explícito y su resultado queda sellado con la marca de observación, de
     * modo que el panel no consulta la red en cada carga ni declara un modo que
     * no haya leído.
     */
    apiChatAccount: adminProcedure.query(async () => {
      return readApiChatAccountNotification(await getPool());
    }),
    verifyApiChatAccount: adminProcedure.mutation(async ({ ctx }) => {
      try {
        return await verifyApiChatAccount(await requirePool(), ctx.user.id);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: safeIntegrationMessage(
            error,
            "No fue posible verificar la configuración de la cuenta en ApiChat."
          ),
        });
      }
    }),
    /**
     * Corrige el modo de notificación de adjuntos del proveedor.
     *
     * La escritura reenvía la configuración leída y sólo invierte la casilla,
     * y su éxito se decide por la lectura posterior, no por el código HTTP.
     * Queda asentada en `audit_log` con el actor que la ejecutó.
     */
    setApiChatAttachmentNotification: adminProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await setApiChatAttachmentNotification(
            await requirePool(),
            input.enabled,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible actualizar el modo de notificación de adjuntos."
            ),
          });
        }
      }),
    /**
     * Recupera los adjuntos conservados sin exigir al candidato un reenvío.
     *
     * Devuelve a la cola las notificaciones agotadas y rebobina el cursor del
     * historial, y declara en su veredicto **qué puede recuperar cada vía**: el
     * reproceso reproduce la carga conservada —y sólo la resuelve si una base de
     * medios está declarada—, mientras que la relectura del historial recupera
     * las notificaciones que nunca llegaron a tener recibo.
     *
     * Escribe, y por eso no vive en la superficie de auditoría, que es de sólo
     * lectura. Queda asentada con el actor que la ejecutó.
     */
    recoverApiChatAttachments: adminProcedure.mutation(async ({ ctx }) => {
      try {
        return await recoverApiChatAttachments(await requirePool(), ctx.user.id);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: safeIntegrationMessage(
            error,
            "No fue posible ejecutar la recuperación de adjuntos."
          ),
        });
      }
    }),
    conversationActivation: adminProcedure.query(async () => {
      const activation = await getConversationActivation(await getPool());
      return {
        ...activation,
        advisories: conversationActivationAdvisories(activation),
        defaults: DEFAULT_CONVERSATION_ACTIVATION,
      };
    }),
    saveConversationActivation: adminProcedure
      .input(
        z.object({
          agentEnabled: z.boolean(),
          serviceMode: z.enum(["single", "split"]),
          capabilityReceive: z.boolean(),
          capabilityReason: z.boolean(),
          capabilitySend: z.boolean(),
          outboxDispatchEnabled: z.boolean(),
          memoryTurns: z.number().int().min(4).max(40),
          responseWordLimit: z.number().int().min(30).max(200),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveConversationActivation(
            await requirePool(),
            input,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar la activación del servicio conversacional."
            ),
          });
        }
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
    knowledgeSettings: adminProcedure.query(async () => {
      return getKnowledgeSettings(await getPool());
    }),
    saveKnowledgeSettings: adminProcedure
      .input(
        z.object({
          allowedExtensions: z
            .array(z.string().trim().min(2).max(8))
            .min(1)
            .max(20),
          maxSizeMb: z.number().int().min(1).max(30),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveKnowledgeSettings(
            await requirePool(),
            input,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar la configuración de conocimiento."
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
    savePublicBaseUrl: adminProcedure
      .input(z.object({ publicBaseUrl: z.string().trim().max(500) }))
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveApiChatPublicBaseUrl(
            await requirePool(),
            input.publicBaseUrl,
            ctx.user.id
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safeIntegrationMessage(
              error,
              "No fue posible guardar la dirección pública."
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
    saveDropboxOAuthSecret: adminProcedure
      .input(
        z.object({
          key: z.enum(DROPBOX_OAUTH_KEYS),
          value: z.string().trim().min(3).max(2_000).nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveDropboxOAuthSecret(
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
              "No fue posible guardar la credencial de Dropbox."
            ),
          });
        }
      }),
    /**
     * Credencial propia de ApiChat para la persona que consulta.
     *
     * La recepción sigue rigiéndose por la credencial de plataforma —el webhook
     * es una sola dirección sin sesión—, y la propia la usan las operaciones
     * atribuibles: el envío manual de la bandeja, el borrado en el proveedor y
     * la verificación de la cuenta. Donde no hay persona identificable rige la
     * de plataforma como respaldo.
     */
    apiChatUserConfiguration: roleProcedure.query(async ({ ctx }) => {
      return getApiChatUserConfiguration(await getPool(), ctx.user.id);
    }),
    saveApiChatUserSecret: roleProcedure
      .input(
        z.object({
          key: z.enum(APICHAT_PER_USER_SECRET_KEYS),
          value: z.string().trim().min(3).max(1_000).nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          return await saveApiChatUserSecret(
            await requirePool(),
            ctx.user.id,
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
    /**
     * Comprueba la conexión con la credencial que se elija.
     *
     * «usuario» verifica la credencial propia —o el respaldo vigente— de quien
     * pulsa; «plataforma» verifica la institucional y exige administración,
     * porque es la que gobierna la recepción.
     */
    verifyApiChat: roleProcedure
      .input(z.object({ scope: z.enum(["usuario", "plataforma"]) }))
      .mutation(async ({ input, ctx }) => {
        if (input.scope === "plataforma" && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "La verificación de la credencial de plataforma está reservada a la administración.",
          });
        }
        try {
          return await verifyApiChatConnection(
            await requirePool(),
            fetch,
            input.scope === "usuario" ? ctx.user.id : null
          );
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
    verifyApiChatReception: adminProcedure.mutation(async () => {
      try {
        return await verifyApiChatReception(await requirePool());
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: safeIntegrationMessage(
            error,
            "No fue posible verificar la recepción de ApiChat."
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
