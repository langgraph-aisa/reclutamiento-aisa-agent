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
