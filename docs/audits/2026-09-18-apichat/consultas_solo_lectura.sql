-- Auditoría de adjuntos 2026-09-18. NO EJECUTADA contra producción.
-- Ejecutar con un rol autorizado de lectura y conservar resultados restringidos.
-- No contiene teléfonos, nombres, cuerpos de chat, archivos ni credenciales.
-- Primero verificar inventario (Q1). Si falta una tabla, documentar la ausencia
-- y ejecutar solamente los bloques compatibles en otra transacción de lectura.
-- En Q3/Q4/Q5 sustituir NULL::integer por el ID interno de la postulación.
-- En Q2/Q3 sustituir NULL::text por el ID del mensaje, escapado por el cliente SQL.
-- Mantener límites y usar parámetros del cliente para valores externos.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

-- Q1. Inventario real: permite verificar uploaded_at frente a created_at.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'conversation_transport_traces', 'conversation_messages',
    'candidate_attachments', 'candidate_knowledge_files', 'conversation_events'
  )
ORDER BY table_name, ordinal_position;

-- Q2. Traza del ID investigado; no exporta payload ni shape con valores personales.
-- Un callback que falló antes de extraer ID puede tener event_id NULL y no aparecer.
WITH filtro AS (SELECT NULL::text AS provider_message_id)
SELECT t.id, t.created_at, t.origin, t.outcome, t.provider_type,
       t.event_id, t.payload_bytes,
       jsonb_typeof(t.shape) AS shape_kind,
       jsonb_typeof(t.payload) AS payload_kind
FROM conversation_transport_traces t
CROSS JOIN filtro f
WHERE f.provider_message_id IS NOT NULL
  AND t.event_id = f.provider_message_id
ORDER BY t.created_at, t.id
LIMIT 200;

-- Q2b. Eventos sin ID normalizado en una ventana explícita del incidente.
-- Sustituir ambos NULL por timestamps con zona confirmada; no inferir UTC
-- directamente de las horas visibles en WhatsApp. No exporta valores del cuerpo.
WITH filtro AS (
  SELECT NULL::timestamptz AS desde, NULL::timestamptz AS hasta
)
SELECT t.id, t.created_at, t.origin, t.outcome, t.provider_type,
       t.payload_bytes,
       ARRAY(SELECT jsonb_object_keys(COALESCE(t.shape, '{}'::jsonb))) AS root_keys
FROM conversation_transport_traces t
CROSS JOIN filtro f
WHERE f.desde IS NOT NULL AND f.hasta IS NOT NULL
  AND t.created_at >= f.desde AND t.created_at < f.hasta
  AND t.event_id IS NULL
ORDER BY t.created_at, t.id
LIMIT 200;

-- Q3. Mensaje y presencia de medio. Una columna estructurada NULL no acredita
-- ausencia si la implementación escribió metadata.media.
WITH filtro AS (
  SELECT NULL::integer AS application_id, NULL::text AS provider_message_id
)
SELECT c.application_id, m.conversation_id, m.id, m.provider_message_id,
       m.direction, m.message_type, m.delivery_status, m.created_at, m.sent_at,
       m.storage_key IS NOT NULL AS structured_storage_present,
       m.metadata->'media'->>'storageKey' IS NOT NULL AS json_storage_present,
       m.metadata->'media'->>'fileName' IS NOT NULL AS json_filename_present,
       m.mime_type, m.size_bytes,
       length(COALESCE(m.transcript, '')) AS transcript_characters
FROM conversation_messages m
JOIN conversations c ON c.id = m.conversation_id
CROSS JOIN filtro f
WHERE f.application_id IS NOT NULL AND c.application_id = f.application_id
  AND (f.provider_message_id IS NULL OR m.provider_message_id = f.provider_message_id)
ORDER BY m.created_at, m.id
LIMIT 500;

-- Q4. Expediente documental; uploaded_at es la columna del esquema versionado.
-- El hash identifica bytes, no demuestra por sí solo cuándo ni quién los envió.
WITH filtro AS (SELECT NULL::integer AS application_id)
SELECT k.id, k.application_id, k.source, k.extension, k.mime_type,
       k.size_bytes, k.analysis_status, k.uploaded_at, k.updated_at, k.sha256,
       length(COALESCE(k.deep_analysis, '')) AS analysis_characters,
       length(COALESCE(k.summary_66, '')) AS summary_characters
FROM candidate_knowledge_files k
CROSS JOIN filtro f
WHERE f.application_id IS NOT NULL AND k.application_id = f.application_id
ORDER BY k.uploaded_at, k.id
LIMIT 200;

-- Q5. Contrastar la entidad que alimenta 'Documentos recibidos'.
WITH filtro AS (SELECT NULL::integer AS application_id)
SELECT a.id, a.application_id, a.category, a.status,
       a.detected_mime_type, a.size_bytes, a.created_at,
       length(COALESCE(a.transcription, '')) AS transcription_characters
FROM candidate_attachments a
CROSS JOIN filtro f
WHERE f.application_id IS NOT NULL AND a.application_id = f.application_id
ORDER BY a.created_at, a.id
LIMIT 200;

-- Q6. Restricciones reales para identidad/idempotencia; no cambia el esquema.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('conversation_messages', 'candidate_knowledge_files', 'candidate_attachments')
ORDER BY tablename, indexname;

ROLLBACK;
