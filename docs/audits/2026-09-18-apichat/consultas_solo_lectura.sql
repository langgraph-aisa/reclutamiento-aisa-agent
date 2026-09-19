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

-- Q1. Inventario real: permite verificar uploaded_at frente a created_at y,
-- sobre todo, si la instancia desplegada es posterior a 2.0.180. Las tablas
-- apichat_inbound_receipts, candidate_document_jobs y conversation_transport_traces
-- no existen antes de ese incremento (migraciones 0035 a 0037): si faltan, el
-- árbol desplegado es funcionalmente incompatible con la reauditoría 2.0.183.
SELECT to_regclass('public.apichat_inbound_receipts')      AS recibos,
       to_regclass('public.candidate_document_jobs')       AS trabajos,
       to_regclass('public.conversation_transport_traces') AS trazas;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'conversation_transport_traces', 'conversation_messages',
    'candidate_attachments', 'candidate_knowledge_files', 'conversation_events',
    'apichat_inbound_receipts', 'candidate_document_jobs', 'apichat_history_cursors'
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
  AND tablename IN (
    'conversation_messages', 'candidate_knowledge_files', 'candidate_attachments',
    'apichat_inbound_receipts', 'candidate_document_jobs'
  )
ORDER BY tablename, indexname;

-- Q7. Puertas 1 a 8 y 9 del árbol: asiento de recepción del mensaje investigado.
-- Substituir NULL::text por el ID del mensaje del proveedor o dejar la ventana.
-- Un status 'dead' significa que el archivo no alcanzó la bandeja; los deltas de
-- next_attempt_at reconstruyen los 8 intentos (≈21 minutos en total).
-- Un status 'completed' con un mensaje que declare processingOutcome='rejected'
-- corresponde a la puerta 9: llegó y fue rechazado por política.
WITH filtro AS (
  SELECT NULL::text AS provider_message_id,
         NULL::timestamptz AS desde,
         NULL::timestamptz AS hasta
)
SELECT r.receipt_key, r.provider_message_id, r.origin, r.status, r.outcome,
       r.attempts, r.last_error, r.received_at, r.next_attempt_at, r.completed_at,
       (r.payload IS NOT NULL) AS carga_aun_conservada
FROM apichat_inbound_receipts r
CROSS JOIN filtro f
WHERE (f.provider_message_id IS NOT NULL AND r.provider_message_id = f.provider_message_id)
   OR (f.desde IS NOT NULL AND f.hasta IS NOT NULL
       AND r.received_at >= f.desde AND r.received_at < f.hasta)
ORDER BY r.received_at, r.receipt_key
LIMIT 200;

-- Q8. Puerta 5 del árbol, resuelta por la traza: qué campo llevaba la carga y
-- con qué peso. Devuelve rutas, tipos y pesos; NO devuelve valores de contenido
-- ni datos personales. La huella `contenido:<sha256>` acredita que el proveedor
-- entregó una referencia de contenido, no que los bytes fueran descargables.
-- Si aparece una ruta con carga y el asiento de Q7 terminó en 'rejected' con
-- motivo contenido_no_disponible, la causa es el adaptador, no el proveedor.
WITH filtro AS (
  SELECT NULL::text AS event_id,
         NULL::timestamptz AS desde,
         NULL::timestamptz AS hasta
)
SELECT t.id, t.created_at, t.origin, t.outcome, t.provider_type, t.payload_bytes,
       campo.key AS ruta_campo,
       campo.value->>'kind' AS tipo,
       (campo.value->>'bytes')::bigint AS bytes,
       campo.value->>'value' AS valor_declarado
FROM conversation_transport_traces t
CROSS JOIN filtro f
CROSS JOIN LATERAL jsonb_each(COALESCE(t.shape, '{}'::jsonb)) AS campo(key, value)
WHERE (
  (f.event_id IS NOT NULL AND t.event_id = f.event_id)
  OR (f.desde IS NOT NULL AND f.hasta IS NOT NULL
      AND t.created_at >= f.desde AND t.created_at < f.hasta)
)
AND (
  campo.value->>'kind' LIKE 'contenido:%'
  OR campo.key IN ('type', 'url', 'base64', 'dataBase64', 'data_uri', 'media',
                   'media_url', 'file_url', 'file', 'document', 'filename',
                   'mime_type')
  OR campo.key LIKE '%url%' OR campo.key LIKE '%base64%' OR campo.key LIKE '%media%'
)
ORDER BY t.created_at, campo.key
LIMIT 400;

-- Q9. Manifiesto de adjuntos de la postulación, la misma unión que leen la
-- bandeja y el motor conversacional. Aquí SÍ aparece la puerta 9: la segunda
-- mitad de la unión conserva el mensaje cuyo documento nunca se creó, con su
-- processingReason. Es la superficie que desmiente un «sin_pendientes».
WITH filtro AS (SELECT NULL::integer AS application_id)
SELECT original_name, category, status, transcription, error_code, truncated,
       origen, received_at
FROM (
  SELECT k.original_name, k.document_class AS category, k.analysis_status AS status,
         CASE WHEN k.extraction_method LIKE 'transcription:%' THEN k.extracted_text END AS transcription,
         k.processing_error_code AS error_code, k.extraction_truncated AS truncated,
         'expediente'::text AS origen, k.uploaded_at AS received_at
    FROM candidate_knowledge_files k
   CROSS JOIN filtro f
   WHERE f.application_id IS NOT NULL AND k.application_id = f.application_id
  UNION ALL
  SELECT COALESCE(m.metadata->'media'->>'fileName', m.body), 'unclassified',
         CASE WHEN m.metadata->'media'->>'processingOutcome' = 'rejected'
              THEN 'rejected' ELSE 'received' END,
         m.transcript, m.metadata->'media'->>'processingReason', false,
         'mensaje'::text, m.created_at
    FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
   CROSS JOIN filtro f
   WHERE f.application_id IS NOT NULL AND c.application_id = f.application_id
     AND m.direction = 'inbound' AND m.metadata->'media' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM candidate_knowledge_files k2
                      WHERE k2.application_id = f.application_id
                        AND k2.id::text = m.metadata->'media'->>'candidateFileId')
) manifiesto
ORDER BY received_at DESC
LIMIT 100;

-- Q10. Puertas 10 a 12: derivación documental. `analysis_status = no_aplica`
-- significa conservado y no interpretado; el motivo está en processing_error_code
-- (ocr_disabled, unsupported_format, no_extractable_text, decoder_unavailable).
-- Un state='failed' con last_error_code permanente agotó sus intentos.
WITH filtro AS (SELECT NULL::integer AS application_id)
SELECT j.file_id, j.state, j.attempts, j.last_error_code, j.available_at, j.lease_until,
       k.original_name, k.extension, k.size_bytes, k.analysis_status,
       k.processing_error_code, k.extraction_method, k.extraction_truncated,
       (k.extracted_text IS NOT NULL) AS tiene_texto,
       length(COALESCE(k.extracted_text, '')) AS caracteres_de_texto,
       k.uploaded_at
FROM candidate_document_jobs j
JOIN candidate_knowledge_files k ON k.id = j.file_id
CROSS JOIN filtro f
WHERE f.application_id IS NOT NULL AND k.application_id = f.application_id
ORDER BY k.uploaded_at DESC, j.file_id
LIMIT 100;

ROLLBACK;
