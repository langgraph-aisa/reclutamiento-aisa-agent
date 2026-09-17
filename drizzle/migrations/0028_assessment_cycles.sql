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
