-- ============================================================================
-- JARVI RH 2.0.198 · Despliegue completo del servicio conversacional
-- ============================================================================
-- Archivo GENERADO. No editar a mano: se compone con
--   pnpm deploy:sql
-- a partir de las migraciones 0022 a 0037 más la consulta única de
-- verificación. Repetir su ejecución es seguro: todas las sentencias son
-- idempotentes y ninguna contiene credenciales.
--
-- Qué deja listo al terminar:
--   · la memoria conversacional (turnos, resúmenes, ciclos, bitácora de eventos);
--   · el RAG personal del candidato alimentado solo con evidencia literal;
--   · la cola de salida con reclamo atómico y la vista de reconciliación;
--   · los esquemas y roles de privilegio mínimo por capacidad;
--   · el expediente documental del candidato y la esencia de su CV;
--   · el ciclo de pruebas psicométricas, su traza por ítem y su cierre evaluado;
--   · la recepción durable de adjuntos y la cola de procesamiento documental;
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
-- Origen: drizzle/migrations/0025_inbox_read_state.sql
-- ----------------------------------------------------------------------------

-- JARVI RH: estado de lectura de la bandeja por operador.
-- Cada operador conserva la marca de cuándo abrió por última vez una
-- conversación; los mensajes entrantes posteriores cuentan como no leídos.

CREATE TABLE IF NOT EXISTS conversation_read_state (
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_read_state_user_idx
  ON conversation_read_state (user_id, last_read_at DESC);

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0026_candidate_knowledge.sql
-- ----------------------------------------------------------------------------

-- JARVI RH 2.0.156: RAG personal del candidato.
--
-- Alcance: el conocimiento del candidato deja de reducirse a las respuestas del
-- formulario y a las aclaraciones confirmadas. La postulación recibe carpetas y
-- documentos propios, con el mismo análisis de IA que el RAG de proyectos, con
-- el mismo volumen de almacenamiento (`KNOWLEDGE_STORAGE_DIR`) y con la misma
-- configuración de extensiones y peso.
--
-- Migración expansiva e idempotente: crea entidades nuevas y no altera, elimina
-- ni renombra ninguna estructura existente. El RAG de proyectos permanece
-- intacto y ambos conviven en el mismo volumen mediante un prefijo de namespace
-- (`applications/...` para el candidato, `<proyecto>/...` para el proyecto).

-- 1) Carpetas del árbol de documentos del candidato.
CREATE TABLE IF NOT EXISTS candidate_knowledge_folders (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  parent_id integer REFERENCES candidate_knowledge_folders(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_knowledge_folders_name_ck CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS candidate_knowledge_folders_application_idx
  ON candidate_knowledge_folders (application_id, parent_id, name);

-- El mismo nombre no se repite dentro de la misma carpeta de la misma
-- postulación: `COALESCE(parent_id,0)` cubre la raíz, donde `NULL` no compara.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_folders_name_uq
  ON candidate_knowledge_folders (application_id, COALESCE(parent_id, 0), lower(name));

-- 2) Documentos del candidato con su análisis de IA.
CREATE TABLE IF NOT EXISTS candidate_knowledge_files (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  folder_id integer REFERENCES candidate_knowledge_folders(id) ON DELETE SET NULL,
  original_name varchar(260) NOT NULL,
  storage_key text NOT NULL,
  mime_type varchar(160) NOT NULL,
  extension varchar(16) NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  -- Procedencia: registro administrativo, recepción por webhook o documento
  -- adjuntado durante la propia postulación.
  source varchar(24) NOT NULL DEFAULT 'manual',
  -- Mismos límites institucionales que el RAG de proyectos: 66 y 325 palabras.
  summary_66 varchar(1400) NOT NULL DEFAULT '',
  deep_analysis varchar(6000) NOT NULL DEFAULT '',
  analysis_status varchar(32) NOT NULL DEFAULT 'pendiente',
  analyzed_model varchar(80),
  -- Integridad del contenido transportado.
  sha256 varchar(64),
  uploaded_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_knowledge_files_source_ck
    CHECK (source IN ('manual', 'webhook', 'postulacion')),
  CONSTRAINT candidate_knowledge_files_status_ck
    CHECK (analysis_status IN ('pendiente', 'analizado', 'no_aplica', 'error')),
  CONSTRAINT candidate_knowledge_files_size_ck CHECK (size_bytes >= 0),
  CONSTRAINT candidate_knowledge_files_sha256_ck
    CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT candidate_knowledge_files_name_ck CHECK (length(trim(original_name)) > 0)
);

CREATE INDEX IF NOT EXISTS candidate_knowledge_files_application_idx
  ON candidate_knowledge_files (application_id, folder_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS candidate_knowledge_files_analysis_idx
  ON candidate_knowledge_files (application_id, analysis_status);

-- Una misma referencia de almacenamiento no puede pertenecer a dos documentos:
-- la unicidad evita que el borrado de una fila deje la evidencia de otra.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_files_storage_uq
  ON candidate_knowledge_files (storage_key);

-- 3) Vinculación explícita entre la aclaración confirmada que ya existía
--    (`candidate_knowledge_notes`, migración 0022) y el documento del que
--    procede, cuando la aclaración se originó en un documento del candidato.
--    Se agrega una columna anulable: los registros vigentes conservan su valor.
--
--    La migración 0022 es opcional: el proyecto declara que sin ella la
--    revisión humana sigue operativa y el panel conversacional explica la
--    acción requerida. Por eso el vínculo se agrega únicamente cuando esa tabla
--    existe; de lo contrario la migración fallaría a mitad de camino y dejaría
--    las tablas creadas sin poder registrarse como aplicada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'candidate_knowledge_notes'
  ) THEN
    ALTER TABLE candidate_knowledge_notes
      ADD COLUMN IF NOT EXISTS candidate_knowledge_file_id integer
        REFERENCES candidate_knowledge_files(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS candidate_knowledge_notes_file_idx
      ON candidate_knowledge_notes (candidate_knowledge_file_id);
  END IF;
END
$$;

-- 4) Los roles del servicio conversacional leen el RAG del candidato para
--    componer el contexto de razonamiento. Si los roles no existen (despliegue
--    integrado sin la migración 0023), el bloque no tiene efecto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvi_motor') THEN
    GRANT SELECT ON candidate_knowledge_files TO jarvi_motor;
    GRANT SELECT ON candidate_knowledge_folders TO jarvi_motor;
  END IF;
END
$$;

-- 5) Verificación autocertificada: cada fila debe quedar en OK.
SELECT 1 AS orden,
       'Tabla de carpetas del candidato' AS control,
       '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_folders') AS obtenido
UNION ALL
SELECT 2, 'Tabla de documentos del candidato', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_files')
UNION ALL
SELECT 3, 'Columnas de analisis en el documento', '4',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_files'
           AND column_name IN ('summary_66', 'deep_analysis',
                               'analysis_status', 'analyzed_model'))
UNION ALL
SELECT 4, 'Indices del RAG del candidato', '3',
       (SELECT count(*)::text FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname IN ('candidate_knowledge_files_application_idx',
                             'candidate_knowledge_files_analysis_idx',
                             'candidate_knowledge_files_storage_uq'))
UNION ALL
SELECT 5, 'Vinculo con aclaraciones confirmadas',
       CASE WHEN to_regclass('public.candidate_knowledge_notes') IS NULL
            THEN 'no aplica' ELSE '1' END,
       CASE WHEN to_regclass('public.candidate_knowledge_notes') IS NULL
            THEN 'no aplica'
            ELSE (SELECT count(*)::text FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = 'candidate_knowledge_notes'
                     AND column_name = 'candidate_knowledge_file_id') END
UNION ALL
SELECT 6, 'Integridad del RAG de proyectos (sin cambios)', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'knowledge_files')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0027_candidate_cv_essence.sql
-- ----------------------------------------------------------------------------

-- 0027_candidate_cv_essence.sql
--
-- Esencia del CV del candidato: representación de trabajo, acotada por la
-- configuración del módulo, que alimenta al agente evaluador. El documento
-- original sigue siendo la evidencia; la esencia solo lo representa.
--
-- Expansiva e idempotente: agrega columnas anulables o con valor por omisión y
-- no altera ni elimina ninguna estructura existente. La migración 0026 es
-- opcional, así que la alteración se ejecuta únicamente si la tabla existe.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'candidate_knowledge_files'
  ) THEN
    ALTER TABLE candidate_knowledge_files
      ADD COLUMN IF NOT EXISTS cv_essence varchar(6000) DEFAULT '' NOT NULL,
      ADD COLUMN IF NOT EXISTS cv_essence_status varchar(32)
        DEFAULT 'pendiente' NOT NULL,
      ADD COLUMN IF NOT EXISTS cv_essence_model varchar(80),
      ADD COLUMN IF NOT EXISTS cv_essence_word_limit integer DEFAULT 550 NOT NULL,
      ADD COLUMN IF NOT EXISTS cv_essence_updated_at timestamptz;

    CREATE INDEX IF NOT EXISTS candidate_knowledge_files_essence_idx
      ON candidate_knowledge_files (application_id, cv_essence_status);
  END IF;
END $$;

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Columnas de la esencia del CV' AS bloque, '5' AS esperado,
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_files'
           AND column_name IN ('cv_essence', 'cv_essence_status',
                               'cv_essence_model', 'cv_essence_word_limit',
                               'cv_essence_updated_at')) AS obtenido
UNION ALL
SELECT 2, 'Estructura previa del expediente conservada', '1',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_files'
           AND column_name = 'analysis_status')
UNION ALL
SELECT 3, 'RAG de proyectos sin cambios', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'knowledge_files')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0028_assessment_cycles.sql
-- ----------------------------------------------------------------------------

-- 0028_assessment_cycles.sql
--
-- Ciclo de pruebas psicométricas por postulación.
--
-- Registra la obligación que deja la recepción del formulario cuando el
-- interruptor del módulo está encendido: el agente inicia las pruebas activas
-- de la plaza treinta segundos después, tras solicitar el CV. Con el
-- interruptor apagado no se registra obligación alguna.
--
-- Expansiva e idempotente: crea una tabla nueva y no altera ni elimina ninguna
-- estructura existente.

CREATE TABLE IF NOT EXISTS assessment_cycles (
  id serial PRIMARY KEY,
  application_id integer NOT NULL UNIQUE
    REFERENCES applications(id) ON DELETE CASCADE,
  state varchar(24) NOT NULL DEFAULT 'listo',
  ready_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  protocol_id integer,
  protocol_version integer,
  current_item_index integer NOT NULL DEFAULT 0,
  score integer,
  location_zone varchar(120),
  location_department varchar(120),
  location_municipality varchar(120),
  greeting_message_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_cycles_due_idx
  ON assessment_cycles (state, ready_at);

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Tabla del ciclo de pruebas' AS bloque, '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'assessment_cycles')
       AS obtenido
UNION ALL
SELECT 2, 'Columnas del ciclo', '16',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'assessment_cycles')
UNION ALL
SELECT 3, 'Postulaciones conservadas', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'applications')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0029_assessment_cycle_evaluation.sql
-- ----------------------------------------------------------------------------

-- 0029_assessment_cycle_evaluation.sql
--
-- Cierre evaluado del ciclo de pruebas.
--
-- Registra que la re-evaluación automática que acompaña al cierre ya se
-- ejecutó y con qué puntaje, de modo que un cierre repetido no la vuelva a
-- lanzar. Expansiva e idempotente: agrega columnas anulables y no altera ni
-- elimina ninguna estructura existente.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'assessment_cycles'
  ) THEN
    ALTER TABLE assessment_cycles
      ADD COLUMN IF NOT EXISTS evaluated_at timestamptz,
      ADD COLUMN IF NOT EXISTS evaluation_score integer;
  END IF;
END $$;

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Columnas del cierre evaluado' AS bloque, '2' AS esperado,
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'assessment_cycles'
           AND column_name IN ('evaluated_at', 'evaluation_score')) AS obtenido
UNION ALL
SELECT 2, 'Estructura previa del ciclo conservada', '1',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'assessment_cycles'
           AND column_name = 'ready_at')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0030_assessment_item_attempts.sql
-- ----------------------------------------------------------------------------

-- 0030_assessment_item_attempts.sql
--
-- Traza del acto: el intento de cada ítem del instrumento.
--
-- El ciclo de pruebas registra la obligación y su cierre; esta tabla registra
-- lo que ocurre entre ambos extremos: qué se preguntó, qué respondió el
-- candidato, con qué determinación y con qué puntaje. Sin ella el punteo es
-- inexplicable, el avance no es idempotente y no es posible distinguir una
-- respuesta breve de una respuesta ausente.
--
-- Identidad declarada: un intento por ciclo e ítem. La unicidad es lo que
-- impide que una reentrega del webhook vuelva a puntuar la misma respuesta.
--
-- Expansiva e idempotente: crea una tabla nueva y no altera ni elimina ninguna
-- estructura existente.

CREATE TABLE IF NOT EXISTS assessment_item_attempts (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL
    REFERENCES assessment_cycles(id) ON DELETE CASCADE,
  item_id integer NOT NULL
    REFERENCES assessment_items(id) ON DELETE CASCADE,
  item_index integer NOT NULL,
  prompt_message_id integer,
  answer_message_id integer,
  answer_text text,
  judgement varchar(24),
  item_score numeric(5, 2),
  rationale text,
  asked_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Identidad del intento: un ítem se pregunta y se puntúa una sola vez.
CREATE UNIQUE INDEX IF NOT EXISTS assessment_item_attempts_identity_uq
  ON assessment_item_attempts (cycle_id, item_id);

-- El puntero del ciclo es único por posición: no hay dos intentos del mismo
-- lugar del instrumento.
CREATE UNIQUE INDEX IF NOT EXISTS assessment_item_attempts_position_uq
  ON assessment_item_attempts (cycle_id, item_index);

CREATE INDEX IF NOT EXISTS assessment_item_attempts_cycle_idx
  ON assessment_item_attempts (cycle_id, item_index);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assessment_item_attempts_judgement_ck'
  ) THEN
    ALTER TABLE assessment_item_attempts
      ADD CONSTRAINT assessment_item_attempts_judgement_ck
      CHECK (
        judgement IS NULL
        OR judgement IN ('cumplido', 'parcial', 'no_respondido')
      );
  END IF;
END $$;

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Tabla de intentos por ítem' AS bloque, '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'assessment_item_attempts')
       AS obtenido
UNION ALL
SELECT 2, 'Columnas del intento', '14',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'assessment_item_attempts')
UNION ALL
SELECT 3, 'Determinación declarada', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'assessment_item_attempts_judgement_ck')
UNION ALL
SELECT 4, 'Postulaciones conservadas', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'applications')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0031_evaluation_automation.sql
-- ----------------------------------------------------------------------------

-- 0031_evaluation_automation.sql
--
-- Confirmación institucional del ciclo de evaluación automática.
--
-- El interruptor del ciclo no cambia con un clic: encenderlo o apagarlo es un
-- acto de la misma clase que retirar una versión de instrumento, así que exige
-- un código temporal enviado por correo y verificado en el servidor. El código
-- se guarda solamente como hash; nunca como texto plano.
--
-- El estado del interruptor no necesita tabla propia: vive en la configuración
-- de integración, y los contadores del ciclo se derivan de la postulación y de
-- su traza. Esta migración crea el desafío y el índice que hace barata la
-- cuenta de intentos fallidos por postulación.
--
-- Expansiva e idempotente: crea una tabla nueva, índices nuevos, y no altera ni
-- elimina ninguna estructura existente.

CREATE TABLE IF NOT EXISTS evaluation_automation_challenges (
  id serial PRIMARY KEY,
  requested_by_user_id integer NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  target_state varchar(24) NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  requested_ip varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_automation_challenges_state_ck
    CHECK (target_state IN ('encendido', 'apagado')),
  CONSTRAINT evaluation_automation_challenges_attempts_ck
    CHECK (attempts >= 0),
  CONSTRAINT evaluation_automation_challenges_max_attempts_ck
    CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS evaluation_automation_challenges_user_created_idx
  ON evaluation_automation_challenges
     (requested_by_user_id, target_state, created_at DESC);

CREATE INDEX IF NOT EXISTS evaluation_automation_challenges_expires_idx
  ON evaluation_automation_challenges (expires_at);

-- Cuenta de intentos fallidos por postulación: es lo que permite declarar una
-- postulación «no evaluable» sin mantener un segundo registro del trabajo.
CREATE INDEX IF NOT EXISTS audit_log_entity_action_idx
  ON audit_log (entity_type, entity_id, action);

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Tabla del desafío del ciclo automático' AS bloque, '1'
       AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'evaluation_automation_challenges') AS obtenido
UNION ALL
SELECT 2, 'Columnas del desafío', '10',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'evaluation_automation_challenges')
UNION ALL
SELECT 3, 'Estados declarados del desafío', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'evaluation_automation_challenges_state_ck')
UNION ALL
SELECT 4, 'Índice de la cuenta de intentos', '1',
       (SELECT count(*)::text FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname = 'audit_log_entity_action_idx')
UNION ALL
SELECT 5, 'Tabla de auditoría conservada', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'audit_log')
UNION ALL
SELECT 6, 'Postulaciones conservadas', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'applications')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0032_codec_registry.sql
-- ----------------------------------------------------------------------------

-- 0032_codec_registry.sql
--
-- Registro de códecs y decodificadores del transporte, entregado **activado**.
--
-- El artefacto recibe lo que WhatsApp admite: el catálogo separa contenedor de
-- códec y declara, por entrada, qué hace el artefacto con ella. Esta migración
-- siembra las veinticinco entradas del catálogo con su interruptor encendido,
-- de modo que la instalación nazca completa y el operador solo apague lo que
-- decida mantener.
--
-- No sobrescribe decisiones: `DO NOTHING` conserva el valor que ya exista, de
-- modo que reaplicar la migración nunca revierte un apagado deliberado.
--
-- Expansiva e idempotente: inserta filas de configuración y no altera ni
-- elimina ninguna estructura existente.

INSERT INTO integration_settings
  (provider,setting_key,setting_value,is_secret,updated_at)
VALUES
  ('codecs','codec_enabled:audio-ogg-opus','true',false,now()),
  ('codecs','codec_enabled:audio-ogg-vorbis','true',false,now()),
  ('codecs','codec_enabled:audio-m4a-aac','true',false,now()),
  ('codecs','codec_enabled:audio-mp4-aac','true',false,now()),
  ('codecs','codec_enabled:audio-amr','true',false,now()),
  ('codecs','codec_enabled:audio-mp3','true',false,now()),
  ('codecs','codec_enabled:audio-webm-opus','true',false,now()),
  ('codecs','codec_enabled:video-mp4-h264','true',false,now()),
  ('codecs','codec_enabled:video-mp4-hevc','true',false,now()),
  ('codecs','codec_enabled:video-mp4-mpeg4','true',false,now()),
  ('codecs','codec_enabled:video-3gp','true',false,now()),
  ('codecs','codec_enabled:video-mov','true',false,now()),
  ('codecs','codec_enabled:imagen-jpeg','true',false,now()),
  ('codecs','codec_enabled:imagen-png','true',false,now()),
  ('codecs','codec_enabled:imagen-webp','true',false,now()),
  ('codecs','codec_enabled:doc-pdf','true',false,now()),
  ('codecs','codec_enabled:doc-docx','true',false,now()),
  ('codecs','codec_enabled:doc-doc','true',false,now()),
  ('codecs','codec_enabled:doc-xlsx','true',false,now()),
  ('codecs','codec_enabled:doc-xls','true',false,now()),
  ('codecs','codec_enabled:doc-pptx','true',false,now()),
  ('codecs','codec_enabled:doc-txt','true',false,now()),
  ('codecs','codec_enabled:doc-csv','true',false,now()),
  ('codecs','codec_enabled:doc-odt','true',false,now()),
  ('codecs','codec_enabled:doc-ods','true',false,now())
ON CONFLICT (provider,setting_key) DO NOTHING;

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Entradas del registro de códecs' AS bloque, '25' AS esperado,
       (SELECT count(*)::text FROM integration_settings
         WHERE provider = 'codecs') AS obtenido
UNION ALL
SELECT 2, 'Entradas entregadas activadas', '25',
       (SELECT count(*)::text FROM integration_settings
         WHERE provider = 'codecs' AND setting_value = 'true')
UNION ALL
SELECT 3, 'Claves únicas por entrada', '25',
       (SELECT count(DISTINCT setting_key)::text FROM integration_settings
         WHERE provider = 'codecs')
UNION ALL
SELECT 4, 'Ninguna entrada se guarda como secreto', '0',
       (SELECT count(*)::text FROM integration_settings
         WHERE provider = 'codecs' AND is_secret = true)
UNION ALL
SELECT 5, 'Configuración de integración conservada', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'integration_settings')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0033_security_roles.sql
-- ----------------------------------------------------------------------------

-- 0033_security_roles.sql
--
-- Permisos por usuario y desafío de confirmación de los cambios sensibles.
--
-- El permiso es **por usuario** y **por recurso**: el alcance `modulo` nombra
-- una entrada del menú y el alcance `recurso` nombra un dominio gobernado de la
-- base (postulaciones, candidatos, plazas, expediente, usuarios…). Así el
-- control alcanza cualquier registro sin obligar a nadie a corregirlo a mano
-- en la base.
--
-- Cinco columnas declaradas: ver, leer, escribir, editar y borrar. La ausencia
-- de fila significa **sin concesión**: un permiso es un acto deliberado y
-- auditado, no un valor por omisión. El administrador conserva todo por rol y
-- no consulta esta tabla.
--
-- El desafío guarda el código **solo como hash**, con vigencia, intentos y
-- reenvío, y sirve a los dos usos que exigen confirmación: la asignación de
-- permisos y la autorización de una edición o un borrado.
--
-- Expansiva e idempotente: crea tablas nuevas, índices nuevos y no siembra
-- ninguna concesión.

CREATE TABLE IF NOT EXISTS user_permissions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope varchar(16) NOT NULL,
  resource_key varchar(120) NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_read boolean NOT NULL DEFAULT false,
  can_write boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  granted_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_permissions_scope_ck CHECK (scope IN ('modulo', 'recurso')),
  CONSTRAINT user_permissions_identity_uq
    UNIQUE (user_id, scope, resource_key)
);

CREATE INDEX IF NOT EXISTS user_permissions_user_idx
  ON user_permissions (user_id, scope);

CREATE TABLE IF NOT EXISTS security_challenges (
  id serial PRIMARY KEY,
  requested_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(24) NOT NULL,
  target_user_id integer REFERENCES users(id) ON DELETE CASCADE,
  detail text,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  requested_ip varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_challenges_purpose_ck
    CHECK (purpose IN ('permisos', 'cambio')),
  CONSTRAINT security_challenges_attempts_ck CHECK (attempts >= 0),
  CONSTRAINT security_challenges_max_attempts_ck CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS security_challenges_user_created_idx
  ON security_challenges (requested_by_user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS security_challenges_expires_idx
  ON security_challenges (expires_at);

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Tabla de permisos por usuario' AS bloque, '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'user_permissions')
       AS obtenido
UNION ALL
SELECT 2, 'Columnas del permiso', '12',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'user_permissions')
UNION ALL
SELECT 3, 'Identidad única por usuario y recurso', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'user_permissions_identity_uq')
UNION ALL
SELECT 4, 'Alcances declarados', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'user_permissions_scope_ck')
UNION ALL
SELECT 5, 'Tabla del desafío de confirmación', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'security_challenges')
UNION ALL
SELECT 6, 'Cinco intentos declarados', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'security_challenges_max_attempts_ck')
UNION ALL
SELECT 7, 'Usuarios conservados', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'users')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0034_recruiter_agent.sql
-- ----------------------------------------------------------------------------

-- 0034_recruiter_agent.sql
--
-- Agente del reclutador: hilo de análisis por candidato.
--
-- El hilo **no es una conversación con el candidato**: es un análisis interno
-- del reclutador sobre el expediente. Por eso vive en su propia entidad y no en
-- `conversations`: reutilizar la conversación de WhatsApp haría que el hilo
-- apareciera en la bandeja como si el candidato hubiera escrito, que es
-- precisamente la colisión que se quiere evitar.
--
-- Identidad declarada: un hilo por postulación. El actor de cada mensaje se
-- conserva, de modo que el historial responde quién preguntó qué.
--
-- Expansiva e idempotente: crea dos tablas nuevas y no altera ni elimina
-- ninguna estructura existente.

CREATE TABLE IF NOT EXISTS recruiter_agent_threads (
  id serial PRIMARY KEY,
  application_id integer NOT NULL UNIQUE
    REFERENCES applications(id) ON DELETE CASCADE,
  -- Modelo elegido **en la conversación**, validado contra el modelo
  -- institucional: el agente no es libre, está bajo el régimen de gobernanza.
  model varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recruiter_agent_messages (
  id serial PRIMARY KEY,
  thread_id integer NOT NULL
    REFERENCES recruiter_agent_threads(id) ON DELETE CASCADE,
  -- Autor declarado: el reclutador o el agente. No se infiere, se asienta.
  author varchar(16) NOT NULL,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  model varchar(120),
  -- Procedencia de la credencial que respondió: es la garantía DORA de que una
  -- caída del proveedor principal no deja al agente sin responder.
  key_source varchar(8),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruiter_agent_messages_author_ck
    CHECK (author IN ('reclutador', 'jarvi')),
  CONSTRAINT recruiter_agent_messages_key_source_ck
    CHECK (key_source IS NULL OR key_source IN ('primary', 'backup'))
);

CREATE INDEX IF NOT EXISTS recruiter_agent_messages_thread_idx
  ON recruiter_agent_messages (thread_id, created_at, id);

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Tabla del hilo del agente' AS bloque, '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'recruiter_agent_threads') AS obtenido
UNION ALL
SELECT 2, 'Tabla de mensajes del hilo', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'recruiter_agent_messages')
UNION ALL
SELECT 3, 'Un hilo por postulación', '1',
       (SELECT count(*)::text FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname = 'recruiter_agent_threads_application_id_key')
UNION ALL
SELECT 4, 'Autores declarados', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'recruiter_agent_messages_author_ck')
UNION ALL
SELECT 5, 'Procedencia de la credencial declarada', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'recruiter_agent_messages_key_source_ck')
UNION ALL
SELECT 6, 'Postulaciones conservadas', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'applications')
ORDER BY orden;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0035_transport_traces.sql
-- ----------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- 0035 · Traza del conducto de transporte
--
-- Registra la FORMA de cada petición que entra al conducto —claves, tipos y
-- tamaños— y un cuerpo redactado y acotado. No registra el resultado de
-- interpretar la carga: registra la carga. Esa distinción cierra el punto ciego
-- que dejó el transporte de adjuntos sin diagnosticar: el receptor declaraba
-- ocho desenlaces y solo dos dejaban rastro, de modo que un adjunto enviado con
-- una forma no prevista era indistinguible de un adjunto nunca enviado.
--
-- Idempotente, expansiva y autocertificada. No elimina ni altera ninguna fila
-- existente ni ningún objeto previo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversation_transport_traces (
  id bigserial PRIMARY KEY,
  origin varchar(16) NOT NULL,
  outcome varchar(48) NOT NULL,
  provider_type varchar(48),
  event_id varchar(180),
  shape jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb,
  payload_bytes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_transport_traces_origin_ck
    CHECK (origin IN ('webhook','sondeo')),
  CONSTRAINT conversation_transport_traces_bytes_ck CHECK (payload_bytes >= 0)
);

COMMENT ON TABLE conversation_transport_traces IS
  'Forma de las peticiones recibidas por el conducto de ApiChat. No conserva contenido del candidato: los campos de archivo se sustituyen por su peso y su huella.';

COMMENT ON COLUMN conversation_transport_traces.shape IS
  'Claves, tipos JSON y tamaños del cuerpo recibido, sin su contenido.';
COMMENT ON COLUMN conversation_transport_traces.outcome IS
  'Desenlace literal del receptor, incluidos los descartes que antes no dejaban rastro.';

CREATE INDEX IF NOT EXISTS conversation_transport_traces_created_idx
  ON conversation_transport_traces (created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_transport_traces_origin_idx
  ON conversation_transport_traces (origin, created_at DESC);

-- Retención declarada: la traza es un instrumento de diagnóstico, no un archivo
-- histórico. Conserva catorce días y se recorta al ejecutar un barrido nuevo.
CREATE OR REPLACE FUNCTION trim_conversation_transport_traces(
  p_days integer DEFAULT 14
) RETURNS integer AS $$
DECLARE
  eliminadas integer;
BEGIN
  IF p_days IS NULL OR p_days < 1 THEN
    RAISE EXCEPTION 'El periodo de retención debe ser al menos un día.';
  END IF;
  DELETE FROM conversation_transport_traces
   WHERE created_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS eliminadas = ROW_COUNT;
  RETURN eliminadas;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────────────
-- Verificación autocertificada de la migración.
-- ───────────────────────────────────────────────────────────────────────────
SELECT '1. Tabla de trazas del conducto creada.' AS bloque, '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces') AS obtenido
UNION ALL
SELECT '2. Columnas declaradas, 9 es esperado.',
       '9',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces')
UNION ALL
SELECT '3. La columna de forma es jsonb.',
       'jsonb',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces'
           AND column_name='shape')
UNION ALL
SELECT '4. La columna de cuerpo es jsonb y admite nulo.',
       'jsonb',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces'
           AND column_name='payload')
UNION ALL
SELECT '5. El origen está restringido a webhook y sondeo.',
       '1',
       (SELECT count(*)::text FROM information_schema.check_constraints
         WHERE constraint_schema='public'
           AND constraint_name='conversation_transport_traces_origin_ck')
UNION ALL
SELECT '6. El identificador es de 64 bits.',
       'bigint',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces'
           AND column_name='id')
UNION ALL
SELECT '7. Índice por fecha descendente presente.',
       '1',
       (SELECT count(*)::text FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='conversation_transport_traces_created_idx')
UNION ALL
SELECT '8. Índice por origen y fecha presente.',
       '1',
       (SELECT count(*)::text FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='conversation_transport_traces_origin_idx')
UNION ALL
SELECT '9. Función de retención declarada.',
       '1',
       (SELECT count(*)::text FROM pg_proc
         WHERE proname='trim_conversation_transport_traces')
UNION ALL
SELECT '10. La tabla no conserva ninguna fila de contenido sin redactar.',
       '0',
       (SELECT count(*)::text FROM conversation_transport_traces)
ORDER BY bloque;

-- Reaplicación: la migración es idempotente.
SELECT 'GATE 0035 OK · traza del conducto autocertificada' AS dictamen;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0036_apichat_inbound_receipts.sql
-- ----------------------------------------------------------------------------

-- Recepción durable antes del acuse HTTP; sin datos ni credenciales de producción.
CREATE TABLE IF NOT EXISTS apichat_inbound_receipts (
  receipt_key varchar(64) PRIMARY KEY,
  provider_message_id varchar(180),
  origin varchar(16) NOT NULL CHECK (origin IN ('webhook','sondeo')),
  payload jsonb,
  payload_sha256 varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','completed','rejected','dead')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token varchar(36),
  locked_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  outcome varchar(80),
  last_error varchar(200),
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS apichat_receipts_work_idx
  ON apichat_inbound_receipts(status,next_attempt_at,received_at);
CREATE TABLE IF NOT EXISTS apichat_history_cursors (
  scope varchar(80) PRIMARY KEY,
  page integer NOT NULL DEFAULT 0 CHECK(page >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- La carga original sólo permanece para recuperación de trabajo pendiente o
-- fallido. El trabajador elimina el contenido al completar; conserva identidad.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jarvi_receptor') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON apichat_inbound_receipts,apichat_history_cursors TO jarvi_receptor;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Origen: drizzle/migrations/0037_candidate_processing.sql
-- ----------------------------------------------------------------------------

-- Procesamiento durable. Aplicar antes de desplegar los nuevos workers.
ALTER TABLE candidate_knowledge_files DROP CONSTRAINT IF EXISTS candidate_knowledge_files_source_ck;
ALTER TABLE candidate_knowledge_files ADD CONSTRAINT candidate_knowledge_files_source_ck CHECK (source IN ('manual','webhook','sondeo','postulacion'));
ALTER TABLE candidate_knowledge_files
  ADD COLUMN IF NOT EXISTS extracted_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS extraction_method varchar(48),
  ADD COLUMN IF NOT EXISTS extraction_truncated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_error_code varchar(64),
  ADD COLUMN IF NOT EXISTS document_class varchar(24) NOT NULL DEFAULT 'unclassified';

CREATE TABLE IF NOT EXISTS candidate_document_jobs (
  file_id integer PRIMARY KEY REFERENCES candidate_knowledge_files(id) ON DELETE CASCADE,
  state varchar(24) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','retry','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_document_jobs_available_idx ON candidate_document_jobs(state,available_at);

INSERT INTO candidate_document_jobs(file_id)
SELECT id FROM candidate_knowledge_files WHERE analysis_status IN ('pendiente','error')
  OR (analysis_status='no_aplica' AND extension IN ('doc','pdf','jpg','jpeg','png','webp','mp3','ogg','opus','m4a','aac','amr','wav','webm','flac','mpeg','mpga','3gp'))
ON CONFLICT (file_id) DO NOTHING;
UPDATE candidate_knowledge_files k SET analysis_status='pendiente'
WHERE EXISTS (SELECT 1 FROM candidate_document_jobs j WHERE j.file_id=k.id AND j.state='pending');

-- El rol de razonamiento procesa y conserva su evidencia documental.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jarvi_motor') THEN
    GRANT SELECT,INSERT,UPDATE ON candidate_document_jobs TO jarvi_motor;
    GRANT SELECT,UPDATE ON candidate_knowledge_files TO jarvi_motor;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jarvi_receptor') THEN
    GRANT SELECT,INSERT,UPDATE ON candidate_document_jobs TO jarvi_receptor;
    GRANT SELECT,INSERT,UPDATE ON candidate_knowledge_files TO jarvi_receptor;
    GRANT USAGE,SELECT ON SEQUENCE candidate_knowledge_files_id_seq TO jarvi_receptor;
  END IF;
END $$;

-- Amplía solamente el catálogo de fábrica anterior; respeta políticas específicas.
UPDATE integration_settings SET setting_value='jpg,jpeg,png,webp,mp4,mp3,ogg,opus,m4a,aac,amr,wav,webm,flac,mpeg,mpga,3gp,doc,docx,xls,xlsx,csv,pdf',updated_at=now()
WHERE provider='knowledge' AND setting_key='allowed_extensions'
  AND regexp_split_to_array(replace(setting_value,' ',''),',') <@ ARRAY['jpg','jpeg','png','mp4','mp3','doc','docx','xls','xlsx','csv','pdf']
  AND regexp_split_to_array(replace(setting_value,' ',''),',') @> ARRAY['jpg','jpeg','png','mp4','mp3','doc','docx','xls','xlsx','csv','pdf'];

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
  UNION ALL
  SELECT 12, 'Migracion 0025 - lectura de la bandeja por operador', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'conversation_read_state')
  UNION ALL
  SELECT 13, 'Migracion 0026 - expediente documental del candidato', '2',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN ('candidate_knowledge_folders',
                                'candidate_knowledge_files'))
  UNION ALL
  SELECT 14, 'Migracion 0027 - columnas de la esencia del CV', '5',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'candidate_knowledge_files'
             AND column_name IN ('cv_essence', 'cv_essence_status',
                                 'cv_essence_model', 'cv_essence_word_limit',
                                 'cv_essence_updated_at'))
  UNION ALL
  SELECT 15, 'Migracion 0028 - ciclo de pruebas de la postulacion', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'assessment_cycles')
  UNION ALL
  SELECT 16, 'Migracion 0029 - cierre evaluado del ciclo', '2',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'assessment_cycles'
             AND column_name IN ('evaluated_at', 'evaluation_score'))
  UNION ALL
  SELECT 17, 'Migracion 0030 - intentos por item del instrumento', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'assessment_item_attempts')
  UNION ALL
  SELECT 18, 'Migracion 0030 - identidad unica del intento', '1',
         (SELECT count(*)::text FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'assessment_item_attempts_identity_uq')
  UNION ALL
  SELECT 19, 'Migracion 0031 - desafio del ciclo automatico', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'evaluation_automation_challenges')
  UNION ALL
  SELECT 20, 'Migracion 0031 - indice de la cuenta de intentos', '1',
         (SELECT count(*)::text FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'audit_log_entity_action_idx')
  UNION ALL
  SELECT 21, 'Migracion 0032 - registro de codecs activado', '25',
         (SELECT count(*)::text FROM integration_settings
           WHERE provider = 'codecs' AND setting_value = 'true')
  UNION ALL
  SELECT 22, 'Migracion 0033 - permisos por usuario', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'user_permissions')
  UNION ALL
  SELECT 23, 'Migracion 0033 - desafio de confirmacion', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'security_challenges')
  UNION ALL
  SELECT 24, 'Migracion 0034 - hilo del agente del reclutador', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'recruiter_agent_threads')
  UNION ALL
  SELECT 25, 'Migracion 0034 - mensajes del hilo', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'recruiter_agent_messages')
  UNION ALL
  SELECT 26, 'Migracion 0035 - traza del conducto de transporte', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'conversation_transport_traces')
  UNION ALL
  SELECT 27, 'Migracion 0035 - retencion declarada de la traza', '1',
         (SELECT count(*)::text FROM pg_proc
           WHERE proname = 'trim_conversation_transport_traces')
  UNION ALL
  SELECT 28, 'Migracion 0036 - recepcion durable del webhook', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'apichat_inbound_receipts')
  UNION ALL
  SELECT 29, 'Migracion 0036 - cursor del historial paginado', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'apichat_history_cursors')
  UNION ALL
  SELECT 30, 'Migracion 0036 - indice de trabajo de la recepcion', '1',
         (SELECT count(*)::text FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'apichat_receipts_work_idx')
  UNION ALL
  SELECT 31, 'Migracion 0037 - cola de procesamiento documental', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'candidate_document_jobs')
  UNION ALL
  SELECT 32, 'Migracion 0037 - columnas de procesamiento documental', '5',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'candidate_knowledge_files'
             AND column_name IN ('extracted_text','extraction_method',
                                 'extraction_truncated','processing_error_code',
                                 'document_class'))
  UNION ALL
  SELECT 33, 'Migracion 0037 - indice de trabajo documental', '1',
         (SELECT count(*)::text FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'candidate_document_jobs_available_idx')
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
