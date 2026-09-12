-- JARVI RH 2.0.133: confirmación de borrado de protocolos de prueba con código temporal.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos de candidatos.
-- El código de borrado se almacena únicamente como hash con salt; nunca como texto plano.

CREATE TABLE IF NOT EXISTS protocol_delete_challenges (
  id serial PRIMARY KEY,
  protocol_id integer NOT NULL REFERENCES assessment_protocols(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  requested_ip varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protocol_delete_challenges_attempts_ck CHECK (attempts >= 0),
  CONSTRAINT protocol_delete_challenges_max_attempts_ck CHECK (max_attempts > 0)
);
CREATE INDEX IF NOT EXISTS protocol_delete_challenges_protocol_user_created_idx
  ON protocol_delete_challenges (protocol_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS protocol_delete_challenges_expires_idx
  ON protocol_delete_challenges (expires_at);
