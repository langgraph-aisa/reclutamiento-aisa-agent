-- JARVI RH 2.0.137: múltiples formularios por plaza, importación desde hoja de cálculo y participaciones del candidato.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos de candidatos.

ALTER TABLE application_forms ADD COLUMN IF NOT EXISTS source varchar(24) NOT NULL DEFAULT 'herramienta';
ALTER TABLE application_forms ADD COLUMN IF NOT EXISTS import_meta jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_forms_source_ck'
  ) THEN
    ALTER TABLE application_forms
      ADD CONSTRAINT application_forms_source_ck
      CHECK (source IN ('herramienta','importado'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS application_form_submissions (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  form_id integer NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
  source varchar(24) NOT NULL DEFAULT 'formulario',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT application_form_submissions_uq UNIQUE (application_id, form_id),
  CONSTRAINT application_form_submissions_source_ck
    CHECK (source IN ('formulario','importado'))
);
CREATE INDEX IF NOT EXISTS application_form_submissions_application_idx
  ON application_form_submissions (application_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS application_form_submissions_form_idx
  ON application_form_submissions (form_id);

-- Participaciones históricas: cada postulación existente registró su formulario de origen.
INSERT INTO application_form_submissions (application_id, form_id, source, submitted_at)
SELECT a.id, a.form_id, 'formulario', a.submitted_at
  FROM applications a
 WHERE a.form_id IS NOT NULL
ON CONFLICT (application_id, form_id) DO NOTHING;
