-- JARVI RH 2.0.134: Administrador de Proyectos con base de conocimiento (RAG) por proyecto.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos de candidatos.
-- Cada proyecto administra carpetas, archivos y análisis de IA (resumen y análisis profundo).

CREATE TABLE IF NOT EXISTS knowledge_projects (
  id serial PRIMARY KEY,
  name varchar(160) NOT NULL,
  summary varchar(2000) NOT NULL DEFAULT '',
  job_position_id integer REFERENCES job_positions(id) ON DELETE SET NULL,
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_projects_name_uq
  ON knowledge_projects (lower(name));
CREATE INDEX IF NOT EXISTS knowledge_projects_position_idx
  ON knowledge_projects (job_position_id);

CREATE TABLE IF NOT EXISTS knowledge_folders (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
  parent_id integer REFERENCES knowledge_folders(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_folders_name_ck CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_folders_path_uq
  ON knowledge_folders (project_id, COALESCE(parent_id, 0), lower(name));
CREATE INDEX IF NOT EXISTS knowledge_folders_project_parent_idx
  ON knowledge_folders (project_id, parent_id);

CREATE TABLE IF NOT EXISTS knowledge_files (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
  folder_id integer REFERENCES knowledge_folders(id) ON DELETE SET NULL,
  original_name varchar(260) NOT NULL,
  storage_key text NOT NULL,
  mime_type varchar(160) NOT NULL,
  extension varchar(16) NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  summary_66 varchar(1400) NOT NULL DEFAULT '',
  deep_analysis varchar(6000) NOT NULL DEFAULT '',
  analysis_status varchar(32) NOT NULL DEFAULT 'pendiente',
  analyzed_model varchar(80),
  uploaded_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_files_size_ck CHECK (size_bytes >= 0),
  CONSTRAINT knowledge_files_status_ck CHECK (analysis_status IN ('pendiente','analizado','no_aplica','error'))
);
CREATE INDEX IF NOT EXISTS knowledge_files_project_folder_idx
  ON knowledge_files (project_id, folder_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_files_analysis_idx
  ON knowledge_files (project_id, analysis_status);
