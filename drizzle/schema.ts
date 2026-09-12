import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", [
  "user",
  "reclutador",
  "admin",
]);
export const applicationStatusEnum = pgEnum("application_status", [
  "en_revision",
  "pre_calificado_prioritario",
  "pre_calificado",
  "pre_calificado_condicionado",
  "pendiente_revision_humana",
  "no_calificado",
  "calificado",
  "calificado_aisa",
  "entrevista_iniciada",
  "entrevista_en_curso",
  "entrevista_finalizada",
  "error_procesamiento",
]);
export const evaluationStatusEnum = pgEnum("evaluation_status", [
  "pre_calificado_prioritario",
  "pre_calificado",
  "pre_calificado_condicionado",
  "calificado",
  "no_calificado",
  "pendiente_revision_humana",
  "error_procesamiento",
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  passwordHash: text("password_hash"),
  passwordChangeRequired: boolean("password_change_required")
    .default(false)
    .notNull(),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
  resetTokenHash: varchar("reset_token_hash", { length: 128 }),
  resetTokenExpiresAt: timestamp("reset_token_expires_at", {
    withTimezone: true,
  }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSignedIn: timestamp("last_signed_in", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const loginCodeChallenges = pgTable(
  "login_code_challenges",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    requestedIp: varchar("requested_ip", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    userCreatedIdx: index("login_code_challenges_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
    expiresIdx: index("login_code_challenges_expires_idx").on(table.expiresAt),
  })
);

export const countries = pgTable("countries", {
  id: serial("id").primaryKey(),
  iso2: varchar("iso2", { length: 2 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  dialingCode: varchar("dialing_code", { length: 8 }).notNull(),
  active: boolean("active").default(true).notNull(),
});

export const geoDepartments = pgTable(
  "geo_departments",
  {
    id: serial("id").primaryKey(),
    countryId: integer("country_id")
      .references(() => countries.id)
      .notNull(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    active: boolean("active").default(true).notNull(),
  },
  table => ({
    uniqueCountryCode: uniqueIndex("geo_departments_country_code_uq").on(
      table.countryId,
      table.code
    ),
  })
);

export const geoMunicipalities = pgTable(
  "geo_municipalities",
  {
    id: serial("id").primaryKey(),
    departmentId: integer("department_id")
      .references(() => geoDepartments.id)
      .notNull(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    active: boolean("active").default(true).notNull(),
  },
  table => ({
    uniqueDepartmentCode: uniqueIndex(
      "geo_municipalities_department_code_uq"
    ).on(table.departmentId, table.code),
  })
);

export const geoZones = pgTable(
  "geo_zones",
  {
    id: serial("id").primaryKey(),
    municipalityId: integer("municipality_id")
      .references(() => geoMunicipalities.id)
      .notNull(),
    code: varchar("code", { length: 40 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    active: boolean("active").default(true).notNull(),
  },
  table => ({
    uniqueMunicipalityCode: uniqueIndex("geo_zones_municipality_code_uq").on(
      table.municipalityId,
      table.code
    ),
  })
);

export const jobPositions = pgTable("job_positions", {
  id: serial("id").primaryKey(),
  publicSlug: varchar("public_slug", { length: 80 }).notNull().unique(),
  code: varchar("code", { length: 80 }).notNull().unique(),
  title: varchar("title", { length: 180 }).notNull(),
  department: varchar("department", { length: 160 }),
  locationLabel: varchar("location_label", { length: 240 }),
  description: text("description"),
  published: boolean("published").default(false).notNull(),
  agentKey: varchar("agent_key", { length: 120 }).notNull(),
  whatsappMessage: text("whatsapp_message").default(
    "Gracias por postularse. Nos pondremos en contacto con usted para continuar con el proceso de evaluación."
  ),
  defaultCountry: varchar("default_country", { length: 2 })
    .default("GT")
    .notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const jobProfiles = pgTable("job_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  summary: text("summary"),
  objective: text("objective"),
  responsibilities: jsonb("responsibilities").default([]).notNull(),
  requiredRequirements: jsonb("required_requirements").default([]).notNull(),
  technicalSkills: jsonb("technical_skills").default([]).notNull(),
  softSkills: jsonb("soft_skills").default([]).notNull(),
  knowledge: jsonb("knowledge").default([]).notNull(),
  academicLevel: varchar("academic_level", { length: 120 }),
  experienceYearsMin: integer("experience_years_min"),
  experienceYearsMax: integer("experience_years_max"),
  languages: jsonb("languages").default([]).notNull(),
  licenses: jsonb("licenses").default([]).notNull(),
  availability: text("availability"),
  location: text("location"),
  salaryRange: varchar("salary_range", { length: 160 }),
  workMode: varchar("work_mode", { length: 80 }),
  aiCriteria: text("ai_criteria"),
  active: boolean("active").default(true).notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const jobProfilePositions = pgTable(
  "job_profile_positions",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .references(() => jobProfiles.id, { onDelete: "cascade" })
      .notNull(),
    jobPositionId: integer("job_position_id")
      .references(() => jobPositions.id, { onDelete: "cascade" })
      .notNull(),
  },
  table => ({
    profilePositionUq: uniqueIndex("job_profile_position_uq").on(
      table.profileId,
      table.jobPositionId
    ),
  })
);

export const applicationForms = pgTable(
  "application_forms",
  {
    id: serial("id").primaryKey(),
    jobPositionId: integer("job_position_id")
      .references(() => jobPositions.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").default(1).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    intro: text("intro"),
    published: boolean("published").default(false).notNull(),
    createdByUserId: integer("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    oneVersion: uniqueIndex("application_forms_job_version_uq").on(
      table.jobPositionId,
      table.version
    ),
  })
);

export const formQuestions = pgTable(
  "form_questions",
  {
    id: serial("id").primaryKey(),
    formId: integer("form_id")
      .references(() => applicationForms.id, { onDelete: "cascade" })
      .notNull(),
    fieldKey: varchar("field_key", { length: 100 }).notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    type: varchar("type", { length: 40 }).notNull(),
    required: boolean("required").default(false).notNull(),
    orderIndex: integer("order_index").default(0).notNull(),
    answerConfig: jsonb("answer_config").default({}).notNull(),
    acceptedAnswers: jsonb("accepted_answers").default([]).notNull(),
    hardFail: boolean("hard_fail").default(false).notNull(),
    evaluationCriteria: text("evaluation_criteria"),
    aiPrompt: text("ai_prompt"),
    active: boolean("active").default(true).notNull(),
  },
  table => ({
    uniqueFieldPerForm: uniqueIndex("form_questions_form_field_uq").on(
      table.formId,
      table.fieldKey
    ),
    formOrderIdx: index("form_questions_form_order_idx").on(
      table.formId,
      table.orderIndex
    ),
  })
);

export const candidates = pgTable("candidates", {
  id: serial("id").primaryKey(),
  phoneInternational: varchar("phone_international", { length: 32 })
    .notNull()
    .unique(),
  phoneCountry: varchar("phone_country", { length: 2 }).default("GT").notNull(),
  fullName: varchar("full_name", { length: 240 }),
  email: varchar("email", { length: 320 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const applications = pgTable(
  "applications",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .references(() => candidates.id, { onDelete: "cascade" })
      .notNull(),
    jobPositionId: integer("job_position_id")
      .references(() => jobPositions.id)
      .notNull(),
    formId: integer("form_id")
      .references(() => applicationForms.id)
      .notNull(),
    locationZoneId: integer("location_zone_id").references(() => geoZones.id),
    locationDepartmentId: integer("location_department_id").references(
      () => geoDepartments.id
    ),
    locationMunicipalityId: integer("location_municipality_id").references(
      () => geoMunicipalities.id
    ),
    status: applicationStatusEnum("status").default("en_revision").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    evaluationAt: timestamp("evaluation_at", { withTimezone: true }),
    evaluationReason: text("evaluation_reason"),
    profileSummary: text("profile_summary"),
    salaryExpectationGtq: numeric("salary_expectation_gtq", {
      precision: 12,
      scale: 2,
    })
      .default("0")
      .notNull(),
    salaryExpectationSource: varchar("salary_expectation_source", {
      length: 32,
    })
      .default("no_declarada")
      .notNull(),
    salaryExpectationCapturedAt: timestamp("salary_expectation_captured_at", {
      withTimezone: true,
    }),
    reviewHoldUntil: timestamp("review_hold_until", { withTimezone: true }),
    reviewToken: varchar("review_token", { length: 80 }),
    whatsappStatus: varchar("whatsapp_status", { length: 48 })
      .default("no_enviado")
      .notNull(),
    lastWhatsappError: text("last_whatsapp_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    candidatePositionUq: uniqueIndex("applications_candidate_position_uq").on(
      table.candidateId,
      table.jobPositionId
    ),
    statusIdx: index("applications_status_idx").on(table.status),
    positionIdx: index("applications_position_idx").on(table.jobPositionId),
    locationIdx: index("applications_location_idx").on(
      table.locationDepartmentId,
      table.locationMunicipalityId,
      table.locationZoneId
    ),
    salaryNonnegativeCheck: check(
      "applications_salary_expectation_nonnegative_ck",
      sql`${table.salaryExpectationGtq} >= 0`
    ),
    salarySourceCheck: check(
      "applications_salary_expectation_source_ck",
      sql`${table.salaryExpectationSource} IN ('no_declarada','message','cv','human')`
    ),
    salaryEvidenceCheck: check(
      "applications_salary_expectation_evidence_ck",
      sql`(${table.salaryExpectationSource} = 'no_declarada' AND ${table.salaryExpectationGtq} = 0 AND ${table.salaryExpectationCapturedAt} IS NULL)
          OR (${table.salaryExpectationSource} <> 'no_declarada' AND ${table.salaryExpectationGtq} > 0 AND ${table.salaryExpectationCapturedAt} IS NOT NULL)`
    ),
  })
);

export const applicationAnswers = pgTable(
  "application_answers",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .notNull(),
    questionId: integer("question_id")
      .references(() => formQuestions.id)
      .notNull(),
    valueJson: jsonb("value_json").notNull(),
    normalizedValue: text("normalized_value"),
    deterministicResult: varchar("deterministic_result", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    applicationQuestionUq: uniqueIndex(
      "application_answers_application_question_uq"
    ).on(table.applicationId, table.questionId),
  })
);

export const evaluations = pgTable(
  "evaluations",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .notNull(),
    status: evaluationStatusEnum("status").notNull(),
    reason: text("reason").notNull(),
    profileSummary: text("profile_summary").notNull(),
    ruleResults: jsonb("rule_results").default([]).notNull(),
    aiPayload: jsonb("ai_payload"),
    aiModel: varchar("ai_model", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    evaluationApplicationIdx: index("evaluations_application_idx").on(
      table.applicationId
    ),
  })
);

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar("provider", { length: 48 }).default("apichat").notNull(),
    externalConversationId: varchar("external_conversation_id", { length: 180 }),
    status: varchar("status", { length: 48 }).default("pendiente").notNull(),
    automationState: varchar("automation_state", { length: 32 })
      .default("agent")
      .notNull(),
    agentEnabled: boolean("agent_enabled").default(true).notNull(),
    humanTakeover: boolean("human_takeover").default(false).notNull(),
    assignedUserId: integer("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    automationCompletedAt: timestamp("automation_completed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    lastMessageIdx: index("conversations_last_message_idx").on(
      table.lastMessageAt.desc().nullsLast(),
      table.id.desc()
    ),
    automationStateCheck: check(
      "conversations_automation_state_ck",
      sql`${table.automationState} IN ('agent','handoff_pending','human','completed','error')`
    ),
    exclusiveControlCheck: check(
      "conversations_exclusive_control_ck",
      sql`NOT (${table.agentEnabled} AND ${table.humanTakeover})`
    ),
  })
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    direction: varchar("direction", { length: 16 }).notNull(),
    messageType: varchar("message_type", { length: 40 })
      .default("text")
      .notNull(),
    body: text("body"),
    providerMessageId: varchar("provider_message_id", { length: 180 }),
    messageKey: varchar("message_key", { length: 120 }),
    deliveryStatus: varchar("delivery_status", { length: 32 })
      .default("recorded")
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    storageKey: text("storage_key"),
    originalFileName: varchar("original_file_name", { length: 260 }),
    mimeType: varchar("mime_type", { length: 160 }),
    sizeBytes: integer("size_bytes"),
    transcript: text("transcript"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    messageKeyUq: uniqueIndex("conversation_messages_message_key_uq").on(
      table.messageKey
    ),
    timelineIdx: index("conversation_messages_timeline_idx").on(
      table.conversationId,
      table.createdAt,
      table.id
    ),
    providerMessageIdx: index("conversation_messages_provider_idx")
      .on(table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    directionCheck: check(
      "conversation_messages_direction_ck",
      sql`${table.direction} IN ('inbound','outbound')`
    ),
    sizeCheck: check(
      "conversation_messages_size_ck",
      sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`
    ),
  })
);

export const inboundMessageQuarantine = pgTable(
  "inbound_message_quarantine",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 48 }).notNull(),
    providerMessageHash: varchar("provider_message_hash", {
      length: 64,
    }).notNull(),
    phoneFingerprint: varchar("phone_fingerprint", { length: 64 }).notNull(),
    reason: varchar("reason", { length: 64 }).notNull(),
    occurrenceCount: integer("occurrence_count").default(1).notNull(),
    firstReceivedAt: timestamp("first_received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    providerMessageUq: uniqueIndex(
      "inbound_message_quarantine_provider_message_uq"
    ).on(table.provider, table.providerMessageHash),
    receivedIdx: index("inbound_message_quarantine_received_idx").on(
      table.lastReceivedAt.desc()
    ),
    occurrenceCheck: check(
      "inbound_message_quarantine_occurrence_ck",
      sql`${table.occurrenceCount} > 0`
    ),
  })
);

export const candidateAttachments = pgTable(
  "candidate_attachments",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .notNull(),
    conversationMessageId: integer("conversation_message_id").references(
      () => conversationMessages.id,
      { onDelete: "set null" }
    ),
    category: varchar("category", { length: 32 }).notNull(),
    objectKey: text("object_key").notNull(),
    originalName: varchar("original_name", { length: 260 }).notNull(),
    declaredMimeType: varchar("declared_mime_type", { length: 160 }),
    detectedMimeType: varchar("detected_mime_type", { length: 160 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    providerMediaId: varchar("provider_media_id", { length: 180 }),
    status: varchar("status", { length: 32 }).default("almacenado").notNull(),
    transcription: text("transcription"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    applicationCreatedIdx: index(
      "candidate_attachments_application_created_idx"
    ).on(table.applicationId, table.createdAt.desc()),
    sha256Idx: index("candidate_attachments_sha256_idx").on(table.sha256),
    sizeCheck: check(
      "candidate_attachments_size_ck",
      sql`${table.sizeBytes} >= 0`
    ),
    sha256Check: check(
      "candidate_attachments_sha256_ck",
      sql`${table.sha256} ~ '^[a-f0-9]{64}$'`
    ),
  })
);

export const agentUserAssignments = pgTable(
  "agent_user_assignments",
  {
    id: serial("id").primaryKey(),
    agentKey: varchar("agent_key", { length: 80 }).notNull(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    identityEmail: varchar("identity_email", { length: 320 }).notNull(),
    active: boolean("active").default(true).notNull(),
    assignedByUserId: integer("assigned_by_user_id").references(
      () => users.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    agentKeyUq: uniqueIndex("agent_user_assignments_agent_key_uq").on(
      table.agentKey
    ),
  })
);

export const adminActivityEvents = pgTable(
  "admin_activity_events",
  {
    id: serial("id").primaryKey(),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorUserId: integer("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorEmail: varchar("actor_email", { length: 320 }),
    pagePath: varchar("page_path", { length: 240 }).notNull(),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    expectedAction: varchar("expected_action", { length: 160 }),
    actualAction: varchar("actual_action", { length: 160 }),
    entityType: varchar("entity_type", { length: 80 }),
    entityId: integer("entity_id"),
    correlationId: varchar("correlation_id", { length: 80 }).notNull(),
    controlStartedAt: timestamp("control_started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    pageCreatedIdx: index("admin_activity_events_page_created_idx").on(
      table.pagePath,
      table.createdAt.desc()
    ),
    actorCreatedIdx: index("admin_activity_events_actor_created_idx").on(
      table.actorUserId,
      table.createdAt.desc()
    ),
    correlationUq: uniqueIndex("admin_activity_events_correlation_uq").on(
      table.correlationId
    ),
    actorTypeCheck: check(
      "admin_activity_events_actor_type_ck",
      sql`${table.actorType} IN ('human','ai','system')`
    ),
    outcomeCheck: check(
      "admin_activity_events_outcome_ck",
      sql`${table.outcome} IN ('guardado','configuracion','trabajando','error')`
    ),
  })
);

export const assessmentProtocols = pgTable(
  "assessment_protocols",
  {
    id: serial("id").primaryKey(),
    jobPositionId: integer("job_position_id")
      .references(() => jobPositions.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    level: varchar("level", { length: 32 }).notNull(),
    assessmentType: varchar("assessment_type", { length: 48 }).notNull(),
    version: integer("version").default(1).notNull(),
    status: varchar("status", { length: 24 }).default("borrador").notNull(),
    executionMode: varchar("execution_mode", { length: 32 })
      .default("esperar_respuesta")
      .notNull(),
    greeting: text("greeting"),
    farewell: text("farewell"),
    methodology: text("methodology"),
    validationEvidence: text("validation_evidence"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: integer("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    positionIdx: index("assessment_protocols_position_idx").on(
      table.jobPositionId,
      table.status
    ),
    versionUq: uniqueIndex("assessment_protocols_version_uq").on(
      table.jobPositionId,
      table.name,
      table.version
    ),
    versionCheck: check(
      "assessment_protocols_version_ck",
      sql`${table.version} > 0`
    ),
    levelCheck: check(
      "assessment_protocols_level_ck",
      sql`${table.level} IN ('nivel','basica','tecnica','avanzada')`
    ),
    typeCheck: check(
      "assessment_protocols_type_ck",
      sql`${table.assessmentType} IN ('competencias','conocimiento','psicometrica_validada')`
    ),
    statusCheck: check(
      "assessment_protocols_status_ck",
      sql`${table.status} IN ('borrador','activo','retirado')`
    ),
    executionCheck: check(
      "assessment_protocols_execution_ck",
      sql`${table.executionMode} IN ('esperar_respuesta','evaluacion_inmediata')`
    ),
  })
);

export const assessmentItems = pgTable(
  "assessment_items",
  {
    id: serial("id").primaryKey(),
    protocolId: integer("protocol_id")
      .references(() => assessmentProtocols.id, { onDelete: "cascade" })
      .notNull(),
    orderIndex: integer("order_index").default(0).notNull(),
    prompt: text("prompt").notNull(),
    agentInstruction: text("agent_instruction").notNull(),
    evaluationCriterion: text("evaluation_criterion").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    protocolOrderUq: uniqueIndex("assessment_items_protocol_order_uq").on(
      table.protocolId,
      table.orderIndex
    ),
    orderCheck: check(
      "assessment_items_order_ck",
      sql`${table.orderIndex} >= 0`
    ),
  })
);

export const assessmentSessions = pgTable(
  "assessment_sessions",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .notNull(),
    protocolId: integer("protocol_id")
      .references(() => assessmentProtocols.id, { onDelete: "restrict" })
      .notNull(),
    status: varchar("status", { length: 32 }).default("pendiente").notNull(),
    currentItemIndex: integer("current_item_index").default(0).notNull(),
    score: numeric("score", { precision: 5, scale: 2 }),
    agentEnabled: boolean("agent_enabled").default(true).notNull(),
    humanTakeover: boolean("human_takeover").default(false).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    applicationProtocolUq: uniqueIndex(
      "assessment_sessions_application_protocol_uq"
    ).on(table.applicationId, table.protocolId),
    currentItemCheck: check(
      "assessment_sessions_current_item_ck",
      sql`${table.currentItemIndex} >= 0`
    ),
    scoreCheck: check(
      "assessment_sessions_score_ck",
      sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 100)`
    ),
    statusCheck: check(
      "assessment_sessions_status_ck",
      sql`${table.status} IN ('pendiente','en_curso','finalizada','error')`
    ),
  })
);

export const protocolDeleteChallenges = pgTable(
  "protocol_delete_challenges",
  {
    id: serial("id").primaryKey(),
    protocolId: integer("protocol_id")
      .references(() => assessmentProtocols.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    requestedIp: varchar("requested_ip", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    protocolUserCreatedIdx: index(
      "protocol_delete_challenges_protocol_user_created_idx"
    ).on(table.protocolId, table.userId, table.createdAt),
    expiresIdx: index("protocol_delete_challenges_expires_idx").on(
      table.expiresAt
    ),
  })
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id").references(() => users.id),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: integer("entity_id").notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    entityIdx: index("audit_log_entity_idx").on(
      table.entityType,
      table.entityId
    ),
    createdIdx: index("audit_log_created_idx").on(
      table.createdAt.desc(),
      table.id.desc()
    ),
    actorCreatedIdx: index("audit_log_actor_created_idx").on(
      table.actorUserId,
      table.createdAt.desc()
    ),
  })
);

export const internalAlertRecipients = pgTable("internal_alert_recipients", {
  id: serial("id").primaryKey(),
  label: varchar("label", { length: 120 }).notNull(),
  phoneInternational: varchar("phone_international", { length: 32 })
    .notNull()
    .unique(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const integrationSettings = pgTable(
  "integration_settings",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 64 }).notNull(),
    settingKey: varchar("setting_key", { length: 120 }).notNull(),
    settingValue: text("setting_value"),
    isSecret: boolean("is_secret").default(false).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    providerKeyUq: uniqueIndex("integration_settings_provider_key_uq").on(
      table.provider,
      table.settingKey
    ),
  })
);

export const methodologyDocuments = pgTable(
  "methodology_documents",
  {
    id: serial("id").primaryKey(),
    documentKey: varchar("document_key", { length: 32 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    version: integer("version").default(1).notNull(),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: integer("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    documentKeyUq: uniqueIndex("methodology_documents_document_key_uq").on(
      table.documentKey
    ),
  })
);

export const methodologyDocumentRevisions = pgTable(
  "methodology_document_revisions",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .references(() => methodologyDocuments.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    changedByUserId: integer("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => ({
    documentVersionUq: uniqueIndex(
      "methodology_document_revisions_document_version_uq"
    ).on(table.documentId, table.version),
    documentIdx: index("methodology_document_revisions_document_idx").on(
      table.documentId
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type LoginCodeChallenge = typeof loginCodeChallenges.$inferSelect;
export type JobPosition = typeof jobPositions.$inferSelect;
export type JobProfile = typeof jobProfiles.$inferSelect;
export type ApplicationForm = typeof applicationForms.$inferSelect;
export type FormQuestion = typeof formQuestions.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type ApplicationAnswer = typeof applicationAnswers.$inferSelect;
export type Evaluation = typeof evaluations.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type InboundMessageQuarantine =
  typeof inboundMessageQuarantine.$inferSelect;
export type AdminActivityEvent = typeof adminActivityEvents.$inferSelect;
export type AssessmentProtocol = typeof assessmentProtocols.$inferSelect;
export type AssessmentItem = typeof assessmentItems.$inferSelect;
export type MethodologyDocument = typeof methodologyDocuments.$inferSelect;
export type MethodologyDocumentRevision =
  typeof methodologyDocumentRevisions.$inferSelect;
