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
