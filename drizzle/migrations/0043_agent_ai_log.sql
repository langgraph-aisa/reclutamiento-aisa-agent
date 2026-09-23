-- ============================================================================
-- 0043 · Bitácora de la IA del agente conversacional
-- ============================================================================
-- Un asiento por etapa completada, con la acción ejecutada, la justificación
-- técnica y el visto de completado. Las etapas omitidas también quedan
-- asentadas con su motivo. La huella deduplica líneas idénticas de una misma
-- etapa: el tablero conserva solo el estado vigente de cada una sin repetir
-- turnos. Idempotente: se puede repetir sin efecto.

CREATE TABLE IF NOT EXISTS "agent_ai_log" (
  "id" bigserial PRIMARY KEY,
  "application_id" integer NOT NULL REFERENCES "applications" ("id") ON DELETE CASCADE,
  "conversation_id" integer REFERENCES "conversations" ("id") ON DELETE CASCADE,
  "stage_key" varchar(40) NOT NULL,
  "category" varchar(32) NOT NULL,
  "action" text NOT NULL,
  "justification" text NOT NULL,
  "completed" boolean NOT NULL DEFAULT true,
  "skip_reason" text,
  "stage_order" integer NOT NULL DEFAULT 0,
  "turn_id" integer,
  "fingerprint" varchar(40) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agent_ai_log_category_ck"
    CHECK ("category" IN ('nlp','vision','audio','data','reasoning')),
  CONSTRAINT "agent_ai_log_order_ck" CHECK ("stage_order" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_ai_log_app_stage_fingerprint_uq"
  ON "agent_ai_log" ("application_id", "stage_key", "fingerprint");
CREATE INDEX IF NOT EXISTS "agent_ai_log_app_idx"
  ON "agent_ai_log" ("application_id", "stage_order", "created_at", "id");
