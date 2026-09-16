-- JARVI RH: estado de lectura de la bandeja por operador.
-- Cada operador conserva la marca de cuándo abrió por última vez una
-- conversación; los mensajes entrantes posteriores cuentan como no leídos.

CREATE TABLE IF NOT EXISTS conversation_read_state (
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_read_state_user_idx
  ON conversation_read_state (user_id, last_read_at DESC);
