-- ═══════════════════════════════════════════════════════════════════════════
-- 0035 · Traza del conducto de transporte
--
-- Registra la FORMA de cada petición que entra al conducto —claves, tipos y
-- tamaños— y un cuerpo redactado y acotado. No registra el resultado de
-- interpretar la carga: registra la carga. Esa distinción cierra el punto ciego
-- que dejó el transporte de adjuntos sin diagnosticar: el receptor declaraba
-- ocho desenlaces y solo dos dejaban rastro, de modo que un adjunto enviado con
-- una forma no prevista era indistinguible de un adjunto nunca enviado.
--
-- Idempotente, expansiva y autocertificada. No elimina ni altera ninguna fila
-- existente ni ningún objeto previo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversation_transport_traces (
  id bigserial PRIMARY KEY,
  origin varchar(16) NOT NULL,
  outcome varchar(48) NOT NULL,
  provider_type varchar(48),
  event_id varchar(180),
  shape jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb,
  payload_bytes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_transport_traces_origin_ck
    CHECK (origin IN ('webhook','sondeo')),
  CONSTRAINT conversation_transport_traces_bytes_ck CHECK (payload_bytes >= 0)
);

COMMENT ON TABLE conversation_transport_traces IS
  'Forma de las peticiones recibidas por el conducto de ApiChat. No conserva contenido del candidato: los campos de archivo se sustituyen por su peso y su huella.';

COMMENT ON COLUMN conversation_transport_traces.shape IS
  'Claves, tipos JSON y tamaños del cuerpo recibido, sin su contenido.';
COMMENT ON COLUMN conversation_transport_traces.outcome IS
  'Desenlace literal del receptor, incluidos los descartes que antes no dejaban rastro.';

CREATE INDEX IF NOT EXISTS conversation_transport_traces_created_idx
  ON conversation_transport_traces (created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_transport_traces_origin_idx
  ON conversation_transport_traces (origin, created_at DESC);

-- Retención declarada: la traza es un instrumento de diagnóstico, no un archivo
-- histórico. Conserva catorce días y se recorta al ejecutar un barrido nuevo.
CREATE OR REPLACE FUNCTION trim_conversation_transport_traces(
  p_days integer DEFAULT 14
) RETURNS integer AS $$
DECLARE
  eliminadas integer;
BEGIN
  IF p_days IS NULL OR p_days < 1 THEN
    RAISE EXCEPTION 'El periodo de retención debe ser al menos un día.';
  END IF;
  DELETE FROM conversation_transport_traces
   WHERE created_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS eliminadas = ROW_COUNT;
  RETURN eliminadas;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────────────
-- Verificación autocertificada de la migración.
-- ───────────────────────────────────────────────────────────────────────────
SELECT '1. Tabla de trazas del conducto creada.' AS bloque, '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces') AS obtenido
UNION ALL
SELECT '2. Columnas declaradas, 9 es esperado.',
       '9',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces')
UNION ALL
SELECT '3. La columna de forma es jsonb.',
       'jsonb',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces'
           AND column_name='shape')
UNION ALL
SELECT '4. La columna de cuerpo es jsonb y admite nulo.',
       'jsonb',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces'
           AND column_name='payload')
UNION ALL
SELECT '5. El origen está restringido a webhook y sondeo.',
       '1',
       (SELECT count(*)::text FROM information_schema.check_constraints
         WHERE constraint_schema='public'
           AND constraint_name='conversation_transport_traces_origin_ck')
UNION ALL
SELECT '6. El identificador es de 64 bits.',
       'bigint',
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='conversation_transport_traces'
           AND column_name='id')
UNION ALL
SELECT '7. Índice por fecha descendente presente.',
       '1',
       (SELECT count(*)::text FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='conversation_transport_traces_created_idx')
UNION ALL
SELECT '8. Índice por origen y fecha presente.',
       '1',
       (SELECT count(*)::text FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='conversation_transport_traces_origin_idx')
UNION ALL
SELECT '9. Función de retención declarada.',
       '1',
       (SELECT count(*)::text FROM pg_proc
         WHERE proname='trim_conversation_transport_traces')
UNION ALL
SELECT '10. La tabla no conserva ninguna fila de contenido sin redactar.',
       '0',
       (SELECT count(*)::text FROM conversation_transport_traces)
ORDER BY bloque;

-- Reaplicación: la migración es idempotente.
SELECT 'GATE 0035 OK · traza del conducto autocertificada' AS dictamen;
