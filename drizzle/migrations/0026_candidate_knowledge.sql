-- JARVI RH 2.0.156: RAG personal del candidato.
--
-- Alcance: el conocimiento del candidato deja de reducirse a las respuestas del
-- formulario y a las aclaraciones confirmadas. La postulación recibe carpetas y
-- documentos propios, con el mismo análisis de IA que el RAG de proyectos, con
-- el mismo volumen de almacenamiento (`KNOWLEDGE_STORAGE_DIR`) y con la misma
-- configuración de extensiones y peso.
--
-- Migración expansiva e idempotente: crea entidades nuevas y no altera, elimina
-- ni renombra ninguna estructura existente. El RAG de proyectos permanece
-- intacto y ambos conviven en el mismo volumen mediante un prefijo de namespace
-- (`applications/...` para el candidato, `<proyecto>/...` para el proyecto).

-- 1) Carpetas del árbol de documentos del candidato.
CREATE TABLE IF NOT EXISTS candidate_knowledge_folders (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  parent_id integer REFERENCES candidate_knowledge_folders(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_knowledge_folders_name_ck CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS candidate_knowledge_folders_application_idx
  ON candidate_knowledge_folders (application_id, parent_id, name);

-- El mismo nombre no se repite dentro de la misma carpeta de la misma
-- postulación: `COALESCE(parent_id,0)` cubre la raíz, donde `NULL` no compara.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_folders_name_uq
  ON candidate_knowledge_folders (application_id, COALESCE(parent_id, 0), lower(name));

-- 2) Documentos del candidato con su análisis de IA.
CREATE TABLE IF NOT EXISTS candidate_knowledge_files (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  folder_id integer REFERENCES candidate_knowledge_folders(id) ON DELETE SET NULL,
  original_name varchar(260) NOT NULL,
  storage_key text NOT NULL,
  mime_type varchar(160) NOT NULL,
  extension varchar(16) NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  -- Procedencia: registro administrativo, recepción por webhook o documento
  -- adjuntado durante la propia postulación.
  source varchar(24) NOT NULL DEFAULT 'manual',
  -- Mismos límites institucionales que el RAG de proyectos: 66 y 325 palabras.
  summary_66 varchar(1400) NOT NULL DEFAULT '',
  deep_analysis varchar(6000) NOT NULL DEFAULT '',
  analysis_status varchar(32) NOT NULL DEFAULT 'pendiente',
  analyzed_model varchar(80),
  -- Integridad del contenido transportado.
  sha256 varchar(64),
  uploaded_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_knowledge_files_source_ck
    CHECK (source IN ('manual', 'webhook', 'postulacion')),
  CONSTRAINT candidate_knowledge_files_status_ck
    CHECK (analysis_status IN ('pendiente', 'analizado', 'no_aplica', 'error')),
  CONSTRAINT candidate_knowledge_files_size_ck CHECK (size_bytes >= 0),
  CONSTRAINT candidate_knowledge_files_sha256_ck
    CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT candidate_knowledge_files_name_ck CHECK (length(trim(original_name)) > 0)
);

CREATE INDEX IF NOT EXISTS candidate_knowledge_files_application_idx
  ON candidate_knowledge_files (application_id, folder_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS candidate_knowledge_files_analysis_idx
  ON candidate_knowledge_files (application_id, analysis_status);

-- Una misma referencia de almacenamiento no puede pertenecer a dos documentos:
-- la unicidad evita que el borrado de una fila deje la evidencia de otra.
CREATE UNIQUE INDEX IF NOT EXISTS candidate_knowledge_files_storage_uq
  ON candidate_knowledge_files (storage_key);

-- 3) Vinculación explícita entre la aclaración confirmada que ya existía
--    (`candidate_knowledge_notes`, migración 0022) y el documento del que
--    procede, cuando la aclaración se originó en un documento del candidato.
--    Se agrega una columna anulable: los registros vigentes conservan su valor.
ALTER TABLE candidate_knowledge_notes
  ADD COLUMN IF NOT EXISTS candidate_knowledge_file_id integer
    REFERENCES candidate_knowledge_files(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS candidate_knowledge_notes_file_idx
  ON candidate_knowledge_notes (candidate_knowledge_file_id);

-- 4) Los roles del servicio conversacional leen el RAG del candidato para
--    componer el contexto de razonamiento. Si los roles no existen (despliegue
--    integrado sin la migración 0023), el bloque no tiene efecto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jarvi_motor') THEN
    GRANT SELECT ON candidate_knowledge_files TO jarvi_motor;
    GRANT SELECT ON candidate_knowledge_folders TO jarvi_motor;
  END IF;
END
$$;

-- 5) Verificación autocertificada: cada fila debe quedar en OK.
SELECT 1 AS orden,
       'Tabla de carpetas del candidato' AS control,
       '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_folders') AS obtenido
UNION ALL
SELECT 2, 'Tabla de documentos del candidato', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_files')
UNION ALL
SELECT 3, 'Columnas de analisis en el documento', '4',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_files'
           AND column_name IN ('summary_66', 'deep_analysis',
                               'analysis_status', 'analyzed_model'))
UNION ALL
SELECT 4, 'Indices del RAG del candidato', '3',
       (SELECT count(*)::text FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname IN ('candidate_knowledge_files_application_idx',
                             'candidate_knowledge_files_analysis_idx',
                             'candidate_knowledge_files_storage_uq'))
UNION ALL
SELECT 5, 'Vinculo con aclaraciones confirmadas', '1',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_notes'
           AND column_name = 'candidate_knowledge_file_id')
UNION ALL
SELECT 6, 'Integridad del RAG de proyectos (sin cambios)', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'knowledge_files')
ORDER BY orden;
