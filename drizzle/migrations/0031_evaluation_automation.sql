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
