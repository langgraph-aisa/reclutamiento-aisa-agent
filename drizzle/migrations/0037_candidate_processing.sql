-- Procesamiento durable. Aplicar antes de desplegar los nuevos workers.
ALTER TABLE candidate_knowledge_files DROP CONSTRAINT IF EXISTS candidate_knowledge_files_source_ck;
ALTER TABLE candidate_knowledge_files ADD CONSTRAINT candidate_knowledge_files_source_ck CHECK (source IN ('manual','webhook','sondeo','postulacion'));
ALTER TABLE candidate_knowledge_files
  ADD COLUMN IF NOT EXISTS extracted_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS extraction_method varchar(48),
  ADD COLUMN IF NOT EXISTS extraction_truncated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_error_code varchar(64),
  ADD COLUMN IF NOT EXISTS document_class varchar(24) NOT NULL DEFAULT 'unclassified';

CREATE TABLE IF NOT EXISTS candidate_document_jobs (
  file_id integer PRIMARY KEY REFERENCES candidate_knowledge_files(id) ON DELETE CASCADE,
  state varchar(24) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','retry','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_document_jobs_available_idx ON candidate_document_jobs(state,available_at);

INSERT INTO candidate_document_jobs(file_id)
SELECT id FROM candidate_knowledge_files WHERE analysis_status IN ('pendiente','error')
  OR (analysis_status='no_aplica' AND extension IN ('doc','pdf','jpg','jpeg','png','webp','mp3','ogg','opus','m4a','aac','amr','wav','webm','flac','mpeg','mpga','3gp'))
ON CONFLICT (file_id) DO NOTHING;
UPDATE candidate_knowledge_files k SET analysis_status='pendiente'
WHERE EXISTS (SELECT 1 FROM candidate_document_jobs j WHERE j.file_id=k.id AND j.state='pending');

-- El rol de razonamiento procesa y conserva su evidencia documental.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jarvi_motor') THEN
    GRANT SELECT,INSERT,UPDATE ON candidate_document_jobs TO jarvi_motor;
    GRANT SELECT,UPDATE ON candidate_knowledge_files TO jarvi_motor;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jarvi_receptor') THEN
    GRANT SELECT,INSERT,UPDATE ON candidate_document_jobs TO jarvi_receptor;
    GRANT SELECT,INSERT,UPDATE ON candidate_knowledge_files TO jarvi_receptor;
    GRANT USAGE,SELECT ON SEQUENCE candidate_knowledge_files_id_seq TO jarvi_receptor;
  END IF;
END $$;

-- Amplía solamente el catálogo de fábrica anterior; respeta políticas específicas.
UPDATE integration_settings SET setting_value='jpg,jpeg,png,webp,mp4,mp3,ogg,opus,m4a,aac,amr,wav,webm,flac,mpeg,mpga,3gp,doc,docx,xls,xlsx,csv,pdf',updated_at=now()
WHERE provider='knowledge' AND setting_key='allowed_extensions'
  AND regexp_split_to_array(replace(setting_value,' ',''),',') <@ ARRAY['jpg','jpeg','png','mp4','mp3','doc','docx','xls','xlsx','csv','pdf']
  AND regexp_split_to_array(replace(setting_value,' ',''),',') @> ARRAY['jpg','jpeg','png','mp4','mp3','doc','docx','xls','xlsx','csv','pdf'];
