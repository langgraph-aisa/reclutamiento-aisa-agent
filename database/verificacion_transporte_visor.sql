-- JARVI RH 2.0.155 · Verificación de transporte base64 y visor universal
--
-- Alcance: esta entrega NO modifica el esquema. No requiere migración.
-- Este archivo es de SOLO LECTURA: no crea, altera ni elimina objetos ni datos.
-- Ejecute los bloques en el orden indicado y compare con el resultado esperado.

-- ---------------------------------------------------------------------------
-- V1 · Integridad del catálogo de archivos de conocimiento
-- Esperado: ninguna fila. Cada archivo debe tener extensión y MIME declarados.
-- ---------------------------------------------------------------------------
SELECT f.id,
       f.project_id,
       f.original_name,
       f.extension,
       f.mime_type,
       f.size_bytes,
       f.analysis_status,
       f.uploaded_at
  FROM knowledge_files f
 WHERE f.extension IS NULL
    OR btrim(f.extension) = ''
    OR f.mime_type IS NULL
    OR btrim(f.mime_type) = ''
 ORDER BY f.id DESC;

-- ---------------------------------------------------------------------------
-- V2 · Coherencia entre extensión y MIME (huella de cargas anteriores)
-- Esperado: en producción normal, ninguna fila. Una fila indica un archivo
-- cargado antes de 2.0.155 cuyo tipo declarado no coincide con el almacenado.
-- La subida de 2.0.155 corrige el tipo en el momento de la carga; los archivos
-- históricos se corrigen al volver a cargarlos o con el renombrado controlado.
-- ---------------------------------------------------------------------------
SELECT f.id,
       f.original_name,
       f.extension,
       f.mime_type,
       CASE
         WHEN f.extension IN ('jpg', 'jpeg') AND f.mime_type <> 'image/jpeg' THEN 'imagen-jpeg'
         WHEN f.extension = 'png' AND f.mime_type <> 'image/png' THEN 'imagen-png'
         WHEN f.extension = 'pdf' AND f.mime_type <> 'application/pdf' THEN 'documento-pdf'
         WHEN f.extension = 'docx' AND f.mime_type NOT LIKE '%wordprocessingml%' THEN 'documento-docx'
         WHEN f.extension = 'xlsx' AND f.mime_type NOT LIKE '%spreadsheetml%' THEN 'hoja-xlsx'
         WHEN f.extension = 'csv' AND f.mime_type NOT LIKE 'text/csv%' THEN 'hoja-csv'
       END AS discordancia
  FROM knowledge_files f
 WHERE (f.extension IN ('jpg', 'jpeg') AND f.mime_type <> 'image/jpeg')
    OR (f.extension = 'png' AND f.mime_type <> 'image/png')
    OR (f.extension = 'pdf' AND f.mime_type <> 'application/pdf')
    OR (f.extension = 'docx' AND f.mime_type NOT LIKE '%wordprocessingml%')
    OR (f.extension = 'xlsx' AND f.mime_type NOT LIKE '%spreadsheetml%')
    OR (f.extension = 'csv' AND f.mime_type NOT LIKE 'text/csv%')
 ORDER BY f.id DESC;

-- ---------------------------------------------------------------------------
-- V3 · Cobertura del visor por familia de formato
-- Esperado: una fila por extensión con su total. Confirma que los formatos
-- representables en el visor existen realmente en la base.
-- ---------------------------------------------------------------------------
SELECT f.extension,
       count(*) AS archivos,
       CASE
         WHEN f.extension IN ('jpg', 'jpeg', 'png') THEN 'visor-imagen'
         WHEN f.extension = 'mp4' THEN 'visor-video'
         WHEN f.extension = 'mp3' THEN 'visor-audio'
         WHEN f.extension = 'pdf' THEN 'visor-pdf'
         WHEN f.extension = 'docx' THEN 'visor-word'
         WHEN f.extension = 'csv' THEN 'visor-tabla'
         WHEN f.extension IN ('xls', 'xlsx') THEN 'visor-cuadricula'
         WHEN f.extension = 'txt' THEN 'visor-texto'
         WHEN f.extension = 'doc' THEN 'descarga-asistida'
         ELSE 'sin-vista-previa'
       END AS tratamiento_en_visor
  FROM knowledge_files f
 GROUP BY f.extension
 ORDER BY archivos DESC, f.extension;

-- ---------------------------------------------------------------------------
-- V4 · Adjuntos de la bandeja con referencia de almacenamiento
-- Esperado: los adjuntos registrados conservan clave, nombre y tipo. Una fila
-- con storageKey nulo indica un mensaje de archivo sin contenido persistido.
-- ---------------------------------------------------------------------------
SELECT m.conversation_id,
       m.provider_message_id,
       m.direction,
       m.metadata -> 'media' ->> 'fileName'   AS nombre_archivo,
       m.metadata -> 'media' ->> 'mimeType'   AS tipo_declarado,
       m.metadata -> 'media' ->> 'storageKey' AS clave_almacenamiento,
       m.created_at
  FROM conversation_messages m
 WHERE m.message_type = 'file'
   AND (m.metadata -> 'media' IS NULL
        OR m.metadata -> 'media' ->> 'storageKey' IS NULL)
 ORDER BY m.created_at DESC
 LIMIT 50;

-- ---------------------------------------------------------------------------
-- V5 · Trazabilidad de cargas con verificación de contenido (2.0.155)
-- Esperado: los asientos nuevos declaran extensión final, extensión declarada,
-- MIME detectado, versión del transporte y huella sha256. Los asientos
-- anteriores a 2.0.155 no contienen esas claves y no son un error.
-- ---------------------------------------------------------------------------
SELECT a.id,
       a.actor_user_id,
       a.entity_id                                      AS knowledge_file_id,
       a.after_json ->> 'extension'                     AS extension_final,
       a.after_json ->> 'declaredExtension'             AS extension_declarada,
       a.after_json ->> 'detectedMimeType'              AS mime_detectado,
       a.after_json ->> 'contentTypeMismatch'           AS discordancia,
       a.after_json ->> 'transportVersion'              AS version_transporte,
       left(a.after_json ->> 'sha256', 12)              AS sha256_corto,
       a.created_at
  FROM audit_log a
 WHERE a.entity_type = 'knowledge_file'
   AND a.action = 'file_uploaded'
   AND a.after_json ? 'transportVersion'
 ORDER BY a.id DESC
 LIMIT 25;

-- ---------------------------------------------------------------------------
-- V6 · Confirmación de que el esquema no cambió (2.0.155 no migra)
-- Esperado: el diario solo muestra migraciones hasta `0025`. Si aparece una
-- fila posterior creada por este release, detenga el despliegue y reporte.
-- La consulta localiza el diario por nombre real, de modo que no falla si el
-- esquema usa la variante con o sin guion bajo.
-- ---------------------------------------------------------------------------
WITH diario AS (
  SELECT to_regclass('drizzle.__drizzle_migrations') AS tabla
  UNION ALL
  SELECT to_regclass('drizzle._drizzle_migrations')
)
SELECT d.tabla::text AS diario
  FROM diario d
 WHERE d.tabla IS NOT NULL;

-- Con el nombre confirmado por V6, ejecute el detalle del diario:
--   SELECT id, hash, created_at
--     FROM drizzle.__drizzle_migrations
--    ORDER BY created_at DESC
--    LIMIT 10;
-- Esperado: la última entrada corresponde a `0025`. Ninguna entrada nueva de
-- 2.0.155, porque esta entrega no modifica el esquema.
