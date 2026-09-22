-- ============================================================================
-- 0040 · Banco de preguntas de precalificación y entrevista por plaza
-- ============================================================================
-- Modelo único de preguntas guiadas que el agente administra en dos fases:
-- precalificación (después de recibir el CV) y entrevista (segunda ronda).
-- Cada pregunta declara su criterio de descarte: respuestas aprobadas o rango
-- permitido, y un criterio de razonamiento editable que la IA usa para reforzar
-- la decisión. La máquina de estados de cada postulación vive en
-- screening_runs. Idempotente: se puede repetir sin efecto.

CREATE TABLE IF NOT EXISTS "screening_questions" (
  "id" serial PRIMARY KEY,
  "job_position_id" integer NOT NULL REFERENCES "job_positions" ("id") ON DELETE CASCADE,
  "phase" varchar(24) NOT NULL,
  "field_key" varchar(100) NOT NULL,
  "prompt" text NOT NULL,
  "help_text" text,
  "type" varchar(40) NOT NULL DEFAULT 'texto',
  "order_index" integer NOT NULL DEFAULT 0,
  "hard_fail" boolean NOT NULL DEFAULT false,
  "accepted_answers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "answer_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evaluation_criteria" text,
  "depends_on_field_key" varchar(100),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "screening_questions_phase_ck"
    CHECK ("phase" IN ('precalificacion','entrevista')),
  CONSTRAINT "screening_questions_order_ck" CHECK ("order_index" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "screening_questions_position_phase_field_uq"
  ON "screening_questions" ("job_position_id", "phase", "field_key");
CREATE INDEX IF NOT EXISTS "screening_questions_position_phase_idx"
  ON "screening_questions" ("job_position_id", "phase", "order_index");

-- ============================================================================
-- Máquina de estados de precalificación y entrevista por postulación.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "screening_runs" (
  "id" serial PRIMARY KEY,
  "application_id" integer NOT NULL UNIQUE REFERENCES "applications" ("id") ON DELETE CASCADE,
  "phase" varchar(24) NOT NULL DEFAULT 'esperando_cv',
  "current_question_index" integer NOT NULL DEFAULT 0,
  "status" varchar(24) NOT NULL DEFAULT 'en_curso',
  "disqualified_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "screening_runs_phase_ck"
    CHECK ("phase" IN ('esperando_cv','precalificacion','entrevista','descalificado','concluido')),
  CONSTRAINT "screening_runs_status_ck"
    CHECK ("status" IN ('en_curso','descalificado','concluido')),
  CONSTRAINT "screening_runs_question_ck" CHECK ("current_question_index" >= 0)
);

CREATE INDEX IF NOT EXISTS "screening_runs_phase_idx"
  ON "screening_runs" ("phase", "status");
