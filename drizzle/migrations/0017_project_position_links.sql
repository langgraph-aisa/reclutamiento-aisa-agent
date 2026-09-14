-- JARVI RH 2.0.135: vinculación múltiple de plazas a la base de conocimiento del proyecto.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos de candidatos.

CREATE TABLE IF NOT EXISTS knowledge_project_positions (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
  position_id integer NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_project_positions_uq UNIQUE (project_id, position_id)
);
CREATE INDEX IF NOT EXISTS knowledge_project_positions_position_idx
  ON knowledge_project_positions (position_id);

-- Conserva la vinculación única anterior como vinculación múltiple.
INSERT INTO knowledge_project_positions (project_id, position_id, created_by_user_id)
SELECT id, job_position_id, created_by_user_id
  FROM knowledge_projects
 WHERE job_position_id IS NOT NULL
ON CONFLICT (project_id, position_id) DO NOTHING;

ALTER TABLE knowledge_projects DROP COLUMN IF EXISTS job_position_id;
