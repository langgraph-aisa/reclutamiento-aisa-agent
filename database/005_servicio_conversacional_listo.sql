-- ============================================================================
-- JARVI RH 2.0.160 · Despliegue completo del servicio conversacional
-- ============================================================================
-- Archivo GENERADO. No editar a mano: se compone con
--   pnpm deploy:sql
-- a partir de las migraciones 0022, 0023 y 0024 más la consulta única de
-- verificación. Repetir su ejecución es seguro: todas las sentencias son
-- idempotentes y ninguna contiene credenciales.
--
-- Qué deja listo al terminar:
--   · la memoria conversacional (turnos, resúmenes, ciclos, bitácora de eventos);
--   · el RAG personal del candidato alimentado solo con evidencia literal;
--   · la cola de salida con reclamo atómico y la vista de reconciliación;
--   · los esquemas y roles de privilegio mínimo por capacidad;
--   · la activación **preactivada** en el panel de configuración.
--
-- Cómo usarlo: pegue el contenido completo en el ejecutor SQL (dbgate o
-- EasyPanel) y ejecútelo una sola vez. Al final se imprime la verificación
-- autocertificada: todas las filas en OK y el GATE GLOBAL en OK.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0022_conversational_agent.sql
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0023_conversation_service_split.sql
-- ----------------------------------------------------------------------------

-- JARVI RH 2.0.142: esquema final del servicio conversacional separado por capacidad.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos personales.
-- Igual que 0015 a 0022, se aplica de forma manual y no se registra en el diario
-- de Drizzle para no alterar su último índice histórico.
--
-- Qué materializa esta migración:
--   1. Una cola de salida dedicada (`conversation_outbox`) con reclamo atómico
--      `FOR UPDATE SKIP LOCKED`, para que el emisor no compita con la bandeja.
--   2. Un esquema por capacidad con vistas de solo lectura sobre lo que cada
--      servicio puede observar.
--   3. Un rol de inicio de sesión por capacidad con privilegio mínimo.
--   4. Una vista de reconciliación para operación y auditoría.
--
-- Las contraseñas de los roles NO se declaran aquí: el operador las define en
-- EasyPanel. Sin contraseña asignada el rol existe pero no puede autenticarse.

-- 1) Cola de salida dedicada del agente conversacional.
CREATE TABLE IF NOT EXISTS conversation_outbox (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id integer NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL DEFAULT 'text',
  status varchar(24) NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by varchar(80),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_outbox_status_ck
    CHECK (status IN ('queued','sending','sent','failed','unknown','cancelled')),
  CONSTRAINT conversation_outbox_kind_ck CHECK (kind IN ('text','link','location','file','ptt')),
  CONSTRAINT conversation_outbox_attempt_ck CHECK (attempt_count >= 0)
);
-- Un mensaje no puede encolarse dos veces: el reintento reutiliza su fila.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_outbox_message_uq
  ON conversation_outbox (message_id);
-- El emisor solo recorre la cola pendiente; el índice parcial evita escanear
-- el historial entregado.
CREATE INDEX IF NOT EXISTS conversation_outbox_queue_idx
  ON conversation_outbox (status, available_at, id)
  WHERE status IN ('queued','sending');
CREATE INDEX IF NOT EXISTS conversation_outbox_conversation_idx
  ON conversation_outbox (conversation_id, created_at DESC);

-- 2) Esquemas por capacidad.
CREATE SCHEMA IF NOT EXISTS wa_receiver;
CREATE SCHEMA IF NOT EXISTS wa_sender;
CREATE SCHEMA IF NOT EXISTS wa_engine;

COMMENT ON SCHEMA wa_receiver IS
  'Superficie de recepción: solo lectura de la conversación y escritura del mensaje entrante.';
COMMENT ON SCHEMA wa_sender IS
  'Superficie de envío: solo la cola de salida y la confirmación de entrega.';
COMMENT ON SCHEMA wa_engine IS
  'Superficie de razonamiento: contexto, memoria y propuestas de respuesta; sin acceso al proveedor.';

-- 3) Vistas de capacidad. Se recrean para conservar su definición vigente.
CREATE OR REPLACE VIEW wa_receiver.inbound_conversations AS
SELECT conv.id AS conversation_id,
       conv.application_id,
       conv.provider,
       conv.status,
       conv.automation_state,
       conv.agent_enabled,
       conv.human_takeover,
       conv.last_message_at,
       conv.last_inbound_at,
       c.phone_international
  FROM conversations conv
  JOIN applications a ON a.id = conv.application_id
  JOIN candidates c ON c.id = a.candidate_id
 WHERE conv.provider = 'apichat'
   AND conv.status IN ('pendiente', 'activo');

CREATE OR REPLACE VIEW wa_sender.pending_outbox AS
SELECT o.id AS outbox_id,
       o.conversation_id,
       o.message_id,
       o.kind,
       o.status,
       o.attempt_count,
       o.available_at,
       m.body,
       c.phone_international
  FROM conversation_outbox o
  JOIN conversation_messages m ON m.id = o.message_id
  JOIN conversations conv ON conv.id = o.conversation_id
  JOIN applications a ON a.id = conv.application_id
  JOIN candidates c ON c.id = a.candidate_id
 WHERE o.status = 'queued'
   AND o.available_at <= now();

CREATE OR REPLACE VIEW wa_engine.conversation_context AS
SELECT conv.id AS conversation_id,
       conv.application_id,
       conv.automation_state,
       conv.agent_enabled,
       conv.human_takeover,
       conv.conversation_stage,
       conv.agent_turn_count,
       conv.last_agent_turn_at,
       a.job_position_id,
       a.salary_expectation_gtq,
       a.salary_expectation_source
  FROM conversations conv
  JOIN applications a ON a.id = conv.application_id
 WHERE conv.agent_enabled = true
   AND conv.human_takeover = false;

CREATE OR REPLACE VIEW wa_engine.open_cycles AS
SELECT cc.id AS cycle_id,
       cc.conversation_id,
       cc.dimension,
       cc.question,
       cc.status,
       cc.opened_at,
       cc.answer_excerpt
  FROM conversation_cycles cc
 WHERE cc.status = 'abierto';

CREATE OR REPLACE VIEW wa_engine.personal_knowledge AS
SELECT ckn.id AS note_id,
       ckn.application_id,
       ckn.dimension,
       ckn.topic,
       ckn.detail,
       ckn.evidence_excerpt,
       ckn.confirmed_by_candidate,
       ckn.created_at
  FROM candidate_knowledge_notes ckn;

-- 4) Vista de reconciliación para operación y auditoría interna.
CREATE OR REPLACE VIEW conversation_reconciliation AS
SELECT conv.id AS conversation_id,
       conv.application_id,
       conv.automation_state,
       conv.agent_enabled,
       conv.human_takeover,
       conv.conversation_stage,
       conv.agent_turn_count,
       conv.last_agent_turn_at,
       conv.last_agent_error,
       last_inbound.id AS last_inbound_message_id,
       last_inbound.created_at AS last_inbound_at,
       turns.id AS last_turn_id,
       turns.validation_status AS last_turn_validation,
       turns.context_fingerprint AS last_turn_fingerprint,
       COALESCE(outbox.pending, 0) AS pending_outbox,
       COALESCE(outbox.unknown, 0) AS unknown_outbox,
       COALESCE(cycles.open_cycles, 0) AS open_cycles
  FROM conversations conv
  LEFT JOIN LATERAL (
    SELECT m.id, m.created_at FROM conversation_messages m
     WHERE m.conversation_id = conv.id AND m.direction = 'inbound'
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) last_inbound ON true
  LEFT JOIN LATERAL (
    SELECT t.id, t.validation_status, t.context_fingerprint
      FROM conversation_turns t
     WHERE t.conversation_id = conv.id
     ORDER BY t.created_at DESC, t.id DESC LIMIT 1
  ) turns ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE o.status IN ('queued','sending'))::int AS pending,
           count(*) FILTER (WHERE o.status = 'unknown')::int AS unknown
      FROM conversation_outbox o
     WHERE o.conversation_id = conv.id
  ) outbox ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS open_cycles
      FROM conversation_cycles cc
     WHERE cc.conversation_id = conv.id AND cc.status = 'abierto'
  ) cycles ON true;

-- 5) Roles de privilegio mínimo. La contraseña la asigna el operador en EasyPanel.
--    El bloque tolera un usuario de base sin privilegio de administración: en ese
--    caso advierte y continúa, de modo que el despliegue nunca queda a medias.
DO $grants$
DECLARE
  stmt text;
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvi_receptor') THEN
      EXECUTE 'CREATE ROLE jarvi_receptor LOGIN PASSWORD NULL';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvi_emisor') THEN
      EXECUTE 'CREATE ROLE jarvi_emisor LOGIN PASSWORD NULL';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvi_motor') THEN
      EXECUTE 'CREATE ROLE jarvi_motor LOGIN PASSWORD NULL';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'JARVI RH: sin privilegio para crear los roles por capacidad; el servicio opera con la conexión principal.';
  END;

  FOREACH stmt IN ARRAY ARRAY[
    'GRANT USAGE ON SCHEMA wa_receiver TO jarvi_receptor',
    'GRANT USAGE ON SCHEMA wa_sender TO jarvi_emisor',
    'GRANT USAGE ON SCHEMA wa_engine TO jarvi_motor',
    'GRANT SELECT ON wa_receiver.inbound_conversations TO jarvi_receptor',
    'GRANT SELECT, INSERT ON conversation_messages TO jarvi_receptor',
    'GRANT SELECT, INSERT, UPDATE ON conversation_events TO jarvi_receptor',
    'GRANT INSERT ON inbound_message_quarantine TO jarvi_receptor',
    'GRANT SELECT ON wa_sender.pending_outbox TO jarvi_emisor',
    'GRANT SELECT, INSERT, UPDATE ON conversation_outbox TO jarvi_emisor',
    'GRANT SELECT, UPDATE ON conversation_messages TO jarvi_emisor',
    'GRANT SELECT, UPDATE ON conversations TO jarvi_emisor',
    'GRANT SELECT ON applications, candidates TO jarvi_emisor',
    'GRANT SELECT ON wa_engine.conversation_context, wa_engine.open_cycles, wa_engine.personal_knowledge TO jarvi_motor',
    'GRANT SELECT, INSERT, UPDATE ON conversation_turns TO jarvi_motor',
    'GRANT SELECT, INSERT, UPDATE ON conversation_cycles TO jarvi_motor',
    'GRANT SELECT, INSERT, UPDATE ON conversation_summaries TO jarvi_motor',
    'GRANT SELECT, INSERT ON candidate_knowledge_notes TO jarvi_motor',
    'GRANT SELECT, INSERT ON conversation_outbox TO jarvi_motor',
    'GRANT SELECT, INSERT ON conversation_messages TO jarvi_motor',
    'GRANT SELECT, UPDATE ON conversations TO jarvi_motor',
    'GRANT SELECT ON applications, candidates, job_positions TO jarvi_motor',
    'GRANT SELECT ON conversation_reconciliation TO jarvi_motor, jarvi_emisor'
  ]
  LOOP
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'JARVI RH: privilegio insuficiente para ejecutar %.', stmt;
    END;
  END LOOP;
END
$grants$;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0024_conversation_activation.sql
-- ----------------------------------------------------------------------------

-- JARVI RH 2.0.144: activación del servicio conversacional en el panel de configuración.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos personales.
--
-- Decisión de diseño: la activación deja de depender de variables de entorno.
-- Al aplicar esta migración el servicio queda **preactivado** con valores de
-- fábrica seguros; el operador ajusta cualquier interruptor desde
-- Configuración › WhatsApp y el cambio se audita. Las variables de entorno
-- permanecen únicamente como anulación manual para despliegues avanzados.

INSERT INTO integration_settings
  (provider, setting_key, setting_value, is_secret, updated_at)
VALUES
  ('conversation', 'agent_enabled',            'true',   false, now()),
  ('conversation', 'service_mode',             'single', false, now()),
  ('conversation', 'capability_receive',       'true',   false, now()),
  ('conversation', 'capability_reason',        'true',   false, now()),
  ('conversation', 'capability_send',          'true',   false, now()),
  ('conversation', 'outbox_dispatch_enabled',  'true',   false, now()),
  ('conversation', 'memory_turns',             '12',     false, now()),
  ('conversation', 'response_word_limit',      '90',     false, now())
ON CONFLICT (provider, setting_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Verificación autocertificada
-- ----------------------------------------------------------------------------

-- Verificación autocertificada del servicio conversacional JARVI RH.
-- Consulta única: devuelve un control por fila y un dictamen final.
-- Se ejecuta al final del script de despliegue; también puede ejecutarse sola
-- en cualquier momento, incluso antes de aplicar las migraciones.
--
-- Honestidad del resultado: la cola se informa como «sin-tabla» mientras la
-- migración de la cola no esté aplicada, de modo que el gate nunca declara
-- listo un esquema incompleto.

WITH controles AS (
  SELECT 1 AS orden, 'Migracion 0022 - tablas del agente' AS control, '6' AS esperado,
         (SELECT count(*)::text
            FROM (VALUES ('conversation_turns'),('conversation_summaries'),
                         ('conversation_cycles'),('conversation_events'),
                         ('candidate_knowledge_notes'),('conversation_outbox')) AS t(nombre)
           WHERE to_regclass('public.'||t.nombre) IS NOT NULL) AS obtenido
  UNION ALL
  SELECT 2, 'Migracion 0022 - columnas de conversations', '4',
         (SELECT count(*)::text
            FROM (VALUES ('conversation_stage'),('last_agent_turn_at'),
                         ('last_agent_error'),('agent_turn_count')) AS c(nombre)
           WHERE EXISTS (SELECT 1 FROM information_schema.columns col
                          WHERE col.table_schema='public'
                            AND col.table_name='conversations'
                            AND col.column_name=c.nombre))
  UNION ALL
  SELECT 3, 'Migracion 0023 - esquemas por capacidad', '3',
         (SELECT count(*)::text FROM information_schema.schemata
           WHERE schema_name IN ('wa_receiver','wa_sender','wa_engine'))
  UNION ALL
  SELECT 4, 'Migracion 0023 - vistas de capacidad y reconciliacion', '6',
         (SELECT count(*)::text FROM information_schema.views
           WHERE (table_schema='wa_receiver' AND table_name='inbound_conversations')
              OR (table_schema='wa_sender' AND table_name='pending_outbox')
              OR (table_schema='wa_engine' AND table_name IN ('conversation_context','open_cycles','personal_knowledge'))
              OR (table_schema='public' AND table_name='conversation_reconciliation'))
  UNION ALL
  SELECT 5, 'Migracion 0023 - roles de capacidad', '3',
         (SELECT count(*)::text FROM pg_roles
           WHERE rolname IN ('jarvi_receptor','jarvi_emisor','jarvi_motor'))
  UNION ALL
  SELECT 6, 'Indices de idempotencia y de cola', '3',
         (SELECT count(*)::text FROM pg_indexes
           WHERE schemaname='public'
             AND indexname IN ('conversation_events_event_uq',
                               'conversation_outbox_message_uq',
                               'conversation_summaries_version_uq'))
  UNION ALL
  SELECT 7, 'Cola pendiente de entrega', '0',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_outbox') IS NULL
                THEN 'SELECT ''sin-tabla'' AS c'
                ELSE 'SELECT count(*)::text AS c FROM conversation_outbox WHERE status IN (''queued'',''sending'')' END,
           false, true, '')))[1]::text, 'sin-tabla')
  UNION ALL
  SELECT 8, 'Envios desconocidos con revision pendiente', '0',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_outbox') IS NULL
                THEN 'SELECT ''sin-tabla'' AS c'
                ELSE 'SELECT count(*)::text AS c FROM conversation_outbox WHERE status = ''unknown''' END,
           false, true, '')))[1]::text, 'sin-tabla')
  UNION ALL
  SELECT 9, 'Turnos registrados con huella de contexto (informativo)', 'informativo',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_turns') IS NULL
                THEN 'SELECT 0 AS c'
                ELSE 'SELECT count(*)::text AS c FROM conversation_turns' END,
           false, true, '')))[1]::text, '0')
  UNION ALL
  SELECT 10, 'Migracion 0024 - activacion preactivada en el panel', '8',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.integration_settings') IS NULL
                THEN 'SELECT 0 AS c'
                ELSE 'SELECT count(*)::text AS c FROM integration_settings WHERE provider = ''conversation''' END,
           false, true, '')))[1]::text, '0')
  UNION ALL
  SELECT 11, 'Activacion del agente encendida', 'true',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.integration_settings') IS NULL
                THEN 'SELECT ''sin-panel'' AS c'
                ELSE 'SELECT setting_value AS c FROM integration_settings WHERE provider = ''conversation'' AND setting_key = ''agent_enabled''' END,
           false, true, '')))[1]::text, 'sin-panel')
)
SELECT orden, control, esperado, obtenido,
       CASE WHEN orden = 9 THEN 'INFORMATIVO'
            WHEN obtenido = esperado THEN 'OK'
            ELSE 'PENDIENTE' END AS estado
  FROM controles
UNION ALL
SELECT 999, 'GATE GLOBAL', 'sin pendientes',
       (SELECT count(*)::text || ' control(es) pendiente(s)' FROM controles
         WHERE orden <> 9 AND obtenido <> esperado),
       CASE WHEN (SELECT count(*) FROM controles
                   WHERE orden <> 9 AND obtenido <> esperado) = 0
            THEN 'OK' ELSE 'PENDIENTE' END
 ORDER BY orden;
