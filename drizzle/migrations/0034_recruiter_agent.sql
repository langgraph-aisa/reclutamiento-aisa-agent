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
