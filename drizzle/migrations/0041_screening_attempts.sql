-- ============================================================================
-- 0041 · Traza de los intentos de precalificación y entrevista
-- ============================================================================
-- Un intento por pregunta y por recorrido: conserva la respuesta literal, el
-- veredicto y su motivo, de modo que el descarte sea auditable y la dependencia
-- entre preguntas pueda resolverse sin consultar la conversación. Idempotente:
-- se puede repetir sin efecto.

CREATE TABLE IF NOT EXISTS "screening_attempts" (
  "id" serial PRIMARY KEY,
  "run_id" integer NOT NULL REFERENCES "screening_runs" ("id") ON DELETE CASCADE,
  "question_id" integer NOT NULL REFERENCES "screening_questions" ("id") ON DELETE CASCADE,
  "question_index" integer NOT NULL,
  "phase" varchar(24) NOT NULL,
  "field_key" varchar(100) NOT NULL,
  "prompt_message_id" integer,
  "answer_message_id" integer,
  "answer_text" text,
  "judgement" varchar(24),
  "passed" boolean,
  "rationale" text,
  "asked_at" timestamptz NOT NULL DEFAULT now(),
  "answered_at" timestamptz,
  CONSTRAINT "screening_attempts_judgement_ck"
    CHECK ("judgement" IS NULL OR "judgement" IN ('aprobado','descartado','no_aplica','repetido')),
  CONSTRAINT "screening_attempts_index_ck" CHECK ("question_index" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "screening_attempts_run_question_uq"
  ON "screening_attempts" ("run_id", "question_id");
CREATE INDEX IF NOT EXISTS "screening_attempts_run_idx"
  ON "screening_attempts" ("run_id", "question_index");
