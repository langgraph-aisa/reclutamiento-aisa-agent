-- 0027_candidate_cv_essence.sql
--
-- Esencia del CV del candidato: representación de trabajo, acotada por la
-- configuración del módulo, que alimenta al agente evaluador. El documento
-- original sigue siendo la evidencia; la esencia solo lo representa.
--
-- Expansiva e idempotente: agrega columnas anulables o con valor por omisión y
-- no altera ni elimina ninguna estructura existente. La migración 0026 es
-- opcional, así que la alteración se ejecuta únicamente si la tabla existe.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'candidate_knowledge_files'
  ) THEN
    ALTER TABLE candidate_knowledge_files
      ADD COLUMN IF NOT EXISTS cv_essence varchar(6000) DEFAULT '' NOT NULL,
      ADD COLUMN IF NOT EXISTS cv_essence_status varchar(32)
        DEFAULT 'pendiente' NOT NULL,
      ADD COLUMN IF NOT EXISTS cv_essence_model varchar(80),
      ADD COLUMN IF NOT EXISTS cv_essence_word_limit integer DEFAULT 550 NOT NULL,
      ADD COLUMN IF NOT EXISTS cv_essence_updated_at timestamptz;

    CREATE INDEX IF NOT EXISTS candidate_knowledge_files_essence_idx
      ON candidate_knowledge_files (application_id, cv_essence_status);
  END IF;
END $$;

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Columnas de la esencia del CV' AS bloque, '5' AS esperado,
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_files'
           AND column_name IN ('cv_essence', 'cv_essence_status',
                               'cv_essence_model', 'cv_essence_word_limit',
                               'cv_essence_updated_at')) AS obtenido
UNION ALL
SELECT 2, 'Estructura previa del expediente conservada', '1',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'candidate_knowledge_files'
           AND column_name = 'analysis_status')
UNION ALL
SELECT 3, 'RAG de proyectos sin cambios', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'knowledge_files')
ORDER BY orden;
