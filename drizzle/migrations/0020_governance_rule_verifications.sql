-- JARVI RH: registro auditable de la verificación de cada política de gobierno.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos personales.
-- Igual que 0015 a 0019, se aplica de forma manual y no se registra en el
-- diario de Drizzle para no alterar su último índice histórico.

CREATE TABLE IF NOT EXISTS governance_rule_verifications (
  id serial PRIMARY KEY,
  rule_id varchar(16) NOT NULL,
  domain_code varchar(8) NOT NULL,
  source varchar(32) NOT NULL DEFAULT 'langgraph',
  trace_id varchar(120),
  environment varchar(64),
  release varchar(32),
  registered_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  registered_by_email varchar(320),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT governance_rule_verifications_rule_id_ck
    CHECK (rule_id ~ '^[A-Z]{3}-[0-9]{2}$'),
  CONSTRAINT governance_rule_verifications_domain_code_ck
    CHECK (domain_code ~ '^[A-Z]{3}$'),
  CONSTRAINT governance_rule_verifications_source_ck
    CHECK (source IN ('langgraph', 'langfuse'))
);

-- El contador «Trazas auditadas» agrupa por política y ordena por fecha.
CREATE INDEX IF NOT EXISTS governance_rule_verifications_rule_created_idx
  ON governance_rule_verifications (rule_id, created_at DESC);

-- Permite reconstruir la cobertura por categoría sin recorrer la tabla completa.
CREATE INDEX IF NOT EXISTS governance_rule_verifications_domain_created_idx
  ON governance_rule_verifications (domain_code, created_at DESC);
