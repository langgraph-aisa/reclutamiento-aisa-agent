-- Recepción durable antes del acuse HTTP; sin datos ni credenciales de producción.
CREATE TABLE IF NOT EXISTS apichat_inbound_receipts (
  receipt_key varchar(64) PRIMARY KEY,
  provider_message_id varchar(180),
  origin varchar(16) NOT NULL CHECK (origin IN ('webhook','sondeo')),
  payload jsonb,
  payload_sha256 varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','completed','rejected','dead')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token varchar(36),
  locked_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  outcome varchar(80),
  last_error varchar(200),
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS apichat_receipts_work_idx
  ON apichat_inbound_receipts(status,next_attempt_at,received_at);
CREATE TABLE IF NOT EXISTS apichat_history_cursors (
  scope varchar(80) PRIMARY KEY,
  page integer NOT NULL DEFAULT 0 CHECK(page >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- La carga original sólo permanece para recuperación de trabajo pendiente o
-- fallido. El trabajador elimina el contenido al completar; conserva identidad.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jarvi_receptor') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON apichat_inbound_receipts,apichat_history_cursors TO jarvi_receptor;
  END IF;
END $$;
