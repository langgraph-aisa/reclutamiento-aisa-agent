-- JARVI RH 2.0.141: servicio conversacional gobernado con doble RAG y memoria propia.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos personales.
-- Igual que 0015 a 0021, se aplica de forma manual y no se registra en el diario
-- de Drizzle para no alterar su último índice histórico.
--
-- Decisiones de arquitectura que esta migración materializa:
--   1. El hilo conversacional vive en PostgreSQL; OpenAI se consume sin estado.
--   2. La recepción registra cada entrega con identificador de proveedor único.
--   3. Cada turno del agente conserva traza, huella de contexto y resultado de
--      la verificación de conducta antes de cualquier envío.
--   4. El conocimiento confirmado por el candidato se acumula como RAG personal.

-- 1) Estado adicional de la conversación (etapa conversacional y control del motor).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS conversation_stage varchar(32) NOT NULL DEFAULT 'apertura';
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_agent_turn_at timestamptz;
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_agent_error text;
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS agent_turn_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_stage_ck'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_stage_ck
      CHECK (conversation_stage IN ('apertura','descubrimiento','confirmacion','cierre'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_agent_turn_count_ck'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_agent_turn_count_ck
      CHECK (agent_turn_count >= 0);
  END IF;
END $$;

-- 2) Bitácora de eventos de recepción: la unicidad por (conversación, evento)
--    hace idempotente cualquier reintento del proveedor o del puente de sondeo.
CREATE TABLE IF NOT EXISTS conversation_events (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_id varchar(180) NOT NULL,
  event_type varchar(48) NOT NULL,
  source varchar(24) NOT NULL DEFAULT 'webhook',
  status varchar(24) NOT NULL DEFAULT 'procesado',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_events_type_ck
    CHECK (event_type IN ('message_received','message_sent','handoff_requested','agent_turn_failed')),
  CONSTRAINT conversation_events_source_ck
    CHECK (source IN ('webhook','history','agent','human')),
  CONSTRAINT conversation_events_status_ck
    CHECK (status IN ('pendiente','procesado','descartado','error')),
  CONSTRAINT conversation_events_attempt_ck CHECK (attempt_count >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_events_event_uq
  ON conversation_events (conversation_id, event_id);
CREATE INDEX IF NOT EXISTS conversation_events_status_idx
  ON conversation_events (status, created_at DESC);

-- 3) Turnos del agente: traza verificable de cada respuesta generada.
CREATE TABLE IF NOT EXISTS conversation_turns (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  inbound_message_id integer REFERENCES conversation_messages(id) ON DELETE SET NULL,
  outbound_message_id integer REFERENCES conversation_messages(id) ON DELETE SET NULL,
  turn_index integer NOT NULL DEFAULT 0,
  model varchar(80) NOT NULL,
  response_id varchar(180),
  context_fingerprint varchar(64) NOT NULL,
  context_characters integer NOT NULL DEFAULT 0,
  response_characters integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  validation_status varchar(24) NOT NULL DEFAULT 'aprobado',
  validation_reasons jsonb,
  attempt integer NOT NULL DEFAULT 1,
  governance_rules jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_turns_validation_ck
    CHECK (validation_status IN ('aprobado','regenerado','escalado')),
  CONSTRAINT conversation_turns_fingerprint_ck
    CHECK (context_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT conversation_turns_latency_ck CHECK (latency_ms >= 0),
  CONSTRAINT conversation_turns_attempt_ck CHECK (attempt >= 1)
);
CREATE INDEX IF NOT EXISTS conversation_turns_conversation_idx
  ON conversation_turns (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_turns_fingerprint_idx
  ON conversation_turns (context_fingerprint);

-- 4) Memoria jerárquica: resúmenes versionados para sobrevivir pausas de meses.
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  from_message_id integer REFERENCES conversation_messages(id) ON DELETE SET NULL,
  to_message_id integer REFERENCES conversation_messages(id) ON DELETE SET NULL,
  summary varchar(4000) NOT NULL,
  model varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_summaries_version_ck CHECK (version >= 1),
  CONSTRAINT conversation_summaries_summary_ck CHECK (length(trim(summary)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_summaries_version_uq
  ON conversation_summaries (conversation_id, version);

-- 5) Ciclos de información: cada pregunta abierta con propósito y su cierre.
CREATE TABLE IF NOT EXISTS conversation_cycles (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  dimension varchar(48) NOT NULL,
  question varchar(600) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'abierto',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  evidence_message_id integer REFERENCES conversation_messages(id) ON DELETE SET NULL,
  answer_excerpt varchar(600),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_cycles_status_ck
    CHECK (status IN ('abierto','cerrado','descartado')),
  CONSTRAINT conversation_cycles_dimension_ck
    CHECK (dimension IN ('identificacion_ajuste','evidencia_experiencia','competencias',
                         'disponibilidad_logistica','riesgos_brechas','dictamen_ia','remuneracion')),
  CONSTRAINT conversation_cycles_question_ck CHECK (length(trim(question)) > 0)
);
CREATE INDEX IF NOT EXISTS conversation_cycles_open_idx
  ON conversation_cycles (conversation_id, status, opened_at DESC);

-- 6) RAG personal del candidato: cada aclaración confirmada por la persona.
CREATE TABLE IF NOT EXISTS candidate_knowledge_notes (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  conversation_id integer REFERENCES conversations(id) ON DELETE SET NULL,
  source_message_id integer REFERENCES conversation_messages(id) ON DELETE SET NULL,
  dimension varchar(48) NOT NULL,
  topic varchar(160) NOT NULL,
  detail varchar(1200) NOT NULL,
  evidence_excerpt varchar(600) NOT NULL,
  confirmed_by_candidate boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_knowledge_notes_dimension_ck
    CHECK (dimension IN ('identificacion_ajuste','evidencia_experiencia','competencias',
                         'disponibilidad_logistica','riesgos_brechas','dictamen_ia','remuneracion')),
  CONSTRAINT candidate_knowledge_notes_detail_ck CHECK (length(trim(detail)) > 0),
  CONSTRAINT candidate_knowledge_notes_evidence_ck CHECK (length(trim(evidence_excerpt)) > 0)
);
CREATE INDEX IF NOT EXISTS candidate_knowledge_notes_application_idx
  ON candidate_knowledge_notes (application_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_notes_evidence_uq
  ON candidate_knowledge_notes (application_id, source_message_id, dimension)
  WHERE source_message_id IS NOT NULL;
