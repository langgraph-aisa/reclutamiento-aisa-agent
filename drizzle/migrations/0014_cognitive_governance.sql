-- JARVI RH 2.0.130: gobierno cognitivo, actividad, conversaciones y pruebas.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos de candidatos.
-- Drizzle ejecuta el archivo dentro de una única transacción.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS salary_expectation_gtq numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_expectation_source varchar(32) NOT NULL DEFAULT 'no_declarada',
  ADD COLUMN IF NOT EXISTS salary_expectation_captured_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'applications_salary_expectation_nonnegative_ck'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_salary_expectation_nonnegative_ck
      CHECK (salary_expectation_gtq >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'applications_salary_expectation_source_ck'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_salary_expectation_source_ck
      CHECK (salary_expectation_source IN ('no_declarada','message','cv','human'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'applications_salary_expectation_evidence_ck'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_salary_expectation_evidence_ck
      CHECK (
        (salary_expectation_source = 'no_declarada'
          AND salary_expectation_gtq = 0
          AND salary_expectation_captured_at IS NULL)
        OR
        (salary_expectation_source <> 'no_declarada'
          AND salary_expectation_gtq > 0
          AND salary_expectation_captured_at IS NOT NULL)
      );
  END IF;
END $$;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS automation_state varchar(32) NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS agent_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS human_takeover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assigned_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS automation_completed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conversations_automation_state_ck'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_automation_state_ck
      CHECK (automation_state IN ('agent','handoff_pending','human','completed','error'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conversations_exclusive_control_ck'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_exclusive_control_ck
      CHECK (NOT (agent_enabled AND human_takeover));
  END IF;
END $$;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS original_file_name varchar(260),
  ADD COLUMN IF NOT EXISTS mime_type varchar(160),
  ADD COLUMN IF NOT EXISTS size_bytes integer,
  ADD COLUMN IF NOT EXISTS transcript text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conversation_messages_direction_ck'
  ) THEN
    ALTER TABLE conversation_messages
      ADD CONSTRAINT conversation_messages_direction_ck
      CHECK (direction IN ('inbound','outbound'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conversation_messages_size_ck'
  ) THEN
    ALTER TABLE conversation_messages
      ADD CONSTRAINT conversation_messages_size_ck
      CHECK (size_bytes IS NULL OR size_bytes >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversations_last_message_idx
  ON conversations (last_message_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_timeline_idx
  ON conversation_messages (conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS conversation_messages_provider_idx
  ON conversation_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Cuarentena operacional del adaptador normalizado. Por minimización de datos
-- solo conserva huellas HMAC; nunca almacena teléfono ni contenido del mensaje.
CREATE TABLE IF NOT EXISTS inbound_message_quarantine (
  id serial PRIMARY KEY,
  provider varchar(48) NOT NULL,
  provider_message_hash varchar(64) NOT NULL,
  phone_fingerprint varchar(64) NOT NULL,
  reason varchar(64) NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_received_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_message_quarantine_occurrence_ck
    CHECK (occurrence_count > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_message_quarantine_provider_message_uq
  ON inbound_message_quarantine (provider, provider_message_hash);
CREATE INDEX IF NOT EXISTS inbound_message_quarantine_received_idx
  ON inbound_message_quarantine (last_received_at DESC);

CREATE TABLE IF NOT EXISTS candidate_attachments (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  conversation_message_id integer REFERENCES conversation_messages(id) ON DELETE SET NULL,
  category varchar(32) NOT NULL,
  object_key text NOT NULL,
  original_name varchar(260) NOT NULL,
  declared_mime_type varchar(160),
  detected_mime_type varchar(160) NOT NULL,
  size_bytes integer NOT NULL,
  sha256 varchar(64) NOT NULL,
  provider_media_id varchar(180),
  status varchar(32) NOT NULL DEFAULT 'almacenado',
  transcription text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_attachments_size_ck CHECK (size_bytes >= 0),
  CONSTRAINT candidate_attachments_sha256_ck CHECK (sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS candidate_attachments_application_created_idx
  ON candidate_attachments (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS candidate_attachments_sha256_idx
  ON candidate_attachments (sha256);

CREATE TABLE IF NOT EXISTS agent_user_assignments (
  id serial PRIMARY KEY,
  agent_key varchar(80) NOT NULL,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  identity_email varchar(320) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  assigned_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_user_assignments_agent_key_uq
  ON agent_user_assignments (agent_key);

INSERT INTO agent_user_assignments
  (agent_key, user_id, identity_email, active)
SELECT 'jarvi_hr', id, 'adminit@aisa.com.gt', true
  FROM users
 WHERE lower(email) = 'adminit@aisa.com.gt'
 ORDER BY id
 LIMIT 1
ON CONFLICT (agent_key) DO UPDATE
  SET user_id = COALESCE(agent_user_assignments.user_id, EXCLUDED.user_id),
      identity_email = EXCLUDED.identity_email,
      updated_at = now();

INSERT INTO agent_user_assignments
  (agent_key, user_id, identity_email, active)
VALUES ('jarvi_hr', NULL, 'adminit@aisa.com.gt', true)
ON CONFLICT (agent_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_activity_events (
  id serial PRIMARY KEY,
  actor_type varchar(16) NOT NULL,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  actor_email varchar(320),
  page_path varchar(240) NOT NULL,
  event_type varchar(48) NOT NULL,
  outcome varchar(24) NOT NULL,
  expected_action varchar(160),
  actual_action varchar(160),
  entity_type varchar(80),
  entity_id integer,
  correlation_id varchar(80) NOT NULL,
  control_started_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_activity_events_actor_type_ck
    CHECK (actor_type IN ('human', 'ai', 'system')),
  CONSTRAINT admin_activity_events_outcome_ck
    CHECK (outcome IN ('guardado', 'configuracion', 'trabajando', 'error'))
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_activity_events_correlation_uq
  ON admin_activity_events (correlation_id);
CREATE INDEX IF NOT EXISTS admin_activity_events_page_created_idx
  ON admin_activity_events (page_path, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_events_actor_created_idx
  ON admin_activity_events (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx
  ON audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx
  ON audit_log (actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assessment_protocols (
  id serial PRIMARY KEY,
  job_position_id integer NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  name varchar(180) NOT NULL,
  level varchar(32) NOT NULL,
  assessment_type varchar(48) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status varchar(24) NOT NULL DEFAULT 'borrador',
  execution_mode varchar(32) NOT NULL DEFAULT 'esperar_respuesta',
  greeting text,
  farewell text,
  methodology text,
  validation_evidence text,
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_protocols_version_ck CHECK (version > 0),
  CONSTRAINT assessment_protocols_level_ck
    CHECK (level IN ('nivel','basica','tecnica','avanzada')),
  CONSTRAINT assessment_protocols_type_ck
    CHECK (assessment_type IN ('competencias','conocimiento','psicometrica_validada')),
  CONSTRAINT assessment_protocols_status_ck
    CHECK (status IN ('borrador','activo','retirado')),
  CONSTRAINT assessment_protocols_execution_ck
    CHECK (execution_mode IN ('esperar_respuesta','evaluacion_inmediata'))
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_protocols_version_uq
  ON assessment_protocols (job_position_id, name, version);
CREATE INDEX IF NOT EXISTS assessment_protocols_position_idx
  ON assessment_protocols (job_position_id, status);

CREATE TABLE IF NOT EXISTS assessment_items (
  id serial PRIMARY KEY,
  protocol_id integer NOT NULL REFERENCES assessment_protocols(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  prompt text NOT NULL,
  agent_instruction text NOT NULL,
  evaluation_criterion text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_items_order_ck CHECK (order_index >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_items_protocol_order_uq
  ON assessment_items (protocol_id, order_index);

CREATE TABLE IF NOT EXISTS assessment_sessions (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  protocol_id integer NOT NULL REFERENCES assessment_protocols(id) ON DELETE RESTRICT,
  status varchar(32) NOT NULL DEFAULT 'pendiente',
  current_item_index integer NOT NULL DEFAULT 0,
  score numeric(5,2),
  agent_enabled boolean NOT NULL DEFAULT true,
  human_takeover boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_sessions_current_item_ck CHECK (current_item_index >= 0),
  CONSTRAINT assessment_sessions_score_ck
    CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  CONSTRAINT assessment_sessions_status_ck
    CHECK (status IN ('pendiente','en_curso','finalizada','error'))
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_sessions_application_protocol_uq
  ON assessment_sessions (application_id, protocol_id);

INSERT INTO integration_settings
  (provider, setting_key, setting_value, is_secret, updated_at)
VALUES
  ('ai_agent', 'psychometric_model', 'gpt-4.1-mini', false, now()),
  ('ai_agent', 'activity_summary_model', 'gpt-4o-mini', false, now()),
  ('ai_agent', 'transcription_model', 'gpt-4o-mini-transcribe', false, now()),
  ('ai_agent', 'tts_model', 'gpt-4o-mini-tts', false, now()),
  ('ai_agent', 'tts_voice', 'coral', false, now()),
  ('ai_agent', 'audio_max_mb', '5', false, now()),
  ('ai_agent', 'document_max_mb', '5', false, now())
ON CONFLICT (provider, setting_key) DO NOTHING;

INSERT INTO integration_settings
  (provider, setting_key, setting_value, is_secret, updated_at)
VALUES ('apichat', 'webhook_secret', NULL, true, now())
ON CONFLICT (provider, setting_key) DO NOTHING;
