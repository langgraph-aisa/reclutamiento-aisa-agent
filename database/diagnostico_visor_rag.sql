-- JARVI RH 2.0.155 · Diagnóstico: el visor del RAG no abre un documento
--
-- Síntoma: el visor muestra «No fue posible abrir el documento» o, en la
-- versión anterior, el objeto crudo {"error":"No fue posible entregar el
-- archivo."}. Las capturas de la bandeja de conocimiento muestran PDF con
-- análisis de IA ya generado que no se pueden abrir.
--
-- Causa que estos bloques confirman: el catálogo de la base de datos y los
-- binarios viven en dos sistemas distintos. Una base restaurada sin su volumen,
-- o un volumen recreado o no montado en el despliegue, deja filas válidas
-- apuntando a archivos que ya no existen en disco.
--
-- Este archivo es de SOLO LECTURA: no crea, altera ni elimina nada.

-- ---------------------------------------------------------------------------
-- D1 · Inventario de documentos registrados
-- Esperado: una fila por documento con su referencia de almacenamiento y su
-- ruta relativa reconstruida. Copie la columna `clave` y compárela con el
-- contenido real del volumen (bloque D4).
-- ---------------------------------------------------------------------------
SELECT f.id,
       f.project_id,
       f.original_name,
       f.extension,
       f.mime_type,
       f.size_bytes,
       f.analysis_status,
       f.storage_key                                   AS clave,
       split_part(f.storage_key, '/', 1)               AS carpeta_proyecto,
       regexp_replace(f.storage_key, '^\d+/', '')      AS archivo_en_volumen,
       f.uploaded_at,
       u.email                                         AS subido_por
  FROM knowledge_files f
  LEFT JOIN users u ON u.id = f.uploaded_by_user_id
 ORDER BY f.project_id, f.uploaded_at DESC;

-- ---------------------------------------------------------------------------
-- D2 · Resumen por proyecto: escala del incidente
-- Esperado: una fila por proyecto. Si el número de documentos no coincide con
-- los archivos presentes en el volumen, el volumen no es persistente.
-- ---------------------------------------------------------------------------
SELECT f.project_id,
       p.name                                   AS proyecto,
       count(*)                                 AS documentos,
       pg_size_pretty(sum(f.size_bytes)::bigint) AS peso_total,
       min(f.uploaded_at)                       AS primer_cargue,
       max(f.uploaded_at)                       AS ultimo_cargue
  FROM knowledge_files f
  LEFT JOIN knowledge_projects p ON p.id = f.project_id
 GROUP BY f.project_id, p.name
 ORDER BY documentos DESC;

-- ---------------------------------------------------------------------------
-- D3 · Referencias de almacenamiento inválidas
-- Esperado: ninguna fila. Una fila aquí indica una clave que no cumple el
-- patrón `proyecto/uuid.extensión` y que la entrega rechaza por seguridad.
-- ---------------------------------------------------------------------------
SELECT f.id,
       f.original_name,
       f.storage_key
  FROM knowledge_files f
 WHERE f.storage_key !~ '^[0-9]+/[a-f0-9-]{12,64}\.[A-Za-z0-9]{1,8}$'
 ORDER BY f.id DESC;

-- ---------------------------------------------------------------------------
-- D4 · Comparable de volumen (ejecute en la terminal del servicio, no en SQL)
--
-- Desde la consola del servicio en EasyPanel:
--
--   echo "KNOWLEDGE_STORAGE_DIR=${KNOWLEDGE_STORAGE_DIR:-<no definida>}"
--   ls -la "${KNOWLEDGE_STORAGE_DIR:-./data/knowledge-files}" | head
--   find "${KNOWLEDGE_STORAGE_DIR:-./data/knowledge-files}" -type f | wc -l
--
-- Compare el último conteo con el total de documentos del bloque D2:
--   · Si el conteo es 0 y D2 tiene filas  -> el volumen no está montado o se
--     recreó: los binarios se perdieron y hay que volver a cargarlos.
--   · Si el conteo coincide con D2        -> el volumen es correcto y el fallo
--     es de permisos de lectura o de una clave inválida (bloque D3).
--   · Si KNOWLEDGE_STORAGE_DIR no está definida, los archivos viven en
--     ./data/knowledge-files dentro del contenedor y se pierden en cada
--     despliegue: defina la variable apuntando a un volumen persistente.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- D5 · Documentos con análisis de IA pero sin archivo verificado
-- Los documentos de la captura tienen `analysis_status = 'analizado'`: el
-- análisis se generó al cargarlos, cuando el binario sí se leyó. Que hoy no se
-- abran confirma que el binario desapareció después, no que el análisis fallara.
-- ---------------------------------------------------------------------------
SELECT f.id,
       f.original_name,
       f.analysis_status,
       f.summary_66 <> '' AS tiene_resumen,
       f.deep_analysis <> '' AS tiene_analisis,
       f.uploaded_at
  FROM knowledge_files f
 WHERE f.analysis_status = 'analizado'
 ORDER BY f.uploaded_at DESC;

-- ---------------------------------------------------------------------------
-- D6 · Trazabilidad de la carga original
-- Confirma que cada documento entró por la vía prevista y con qué huella.
-- Los cargues anteriores a 2.0.155 no incluyen `transportVersion`.
-- ---------------------------------------------------------------------------
SELECT a.entity_id                                   AS knowledge_file_id,
       a.actor_user_id,
       a.after_json ->> 'originalName'               AS nombre,
       a.after_json ->> 'extension'                  AS extension,
       a.after_json ->> 'sizeBytes'                  AS peso,
       a.after_json ->> 'detectedMimeType'           AS mime_detectado,
       a.after_json ->> 'transportVersion'           AS version_transporte,
       left(a.after_json ->> 'sha256', 12)           AS sha256_corto,
       a.created_at
  FROM audit_log a
 WHERE a.entity_type = 'knowledge_file'
   AND a.action = 'file_uploaded'
 ORDER BY a.id DESC
 LIMIT 50;
