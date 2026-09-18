-- Verificación autocertificada del servicio conversacional JARVI RH.
-- Consulta única: devuelve un control por fila y un dictamen final.
-- Se ejecuta al final del script de despliegue; también puede ejecutarse sola
-- en cualquier momento, incluso antes de aplicar las migraciones.
--
-- Honestidad del resultado: la cola se informa como «sin-tabla» mientras la
-- migración de la cola no esté aplicada, de modo que el gate nunca declara
-- listo un esquema incompleto.

WITH controles AS (
  SELECT 1 AS orden, 'Migracion 0022 - tablas del agente' AS control, '6' AS esperado,
         (SELECT count(*)::text
            FROM (VALUES ('conversation_turns'),('conversation_summaries'),
                         ('conversation_cycles'),('conversation_events'),
                         ('candidate_knowledge_notes'),('conversation_outbox')) AS t(nombre)
           WHERE to_regclass('public.'||t.nombre) IS NOT NULL) AS obtenido
  UNION ALL
  SELECT 2, 'Migracion 0022 - columnas de conversations', '4',
         (SELECT count(*)::text
            FROM (VALUES ('conversation_stage'),('last_agent_turn_at'),
                         ('last_agent_error'),('agent_turn_count')) AS c(nombre)
           WHERE EXISTS (SELECT 1 FROM information_schema.columns col
                          WHERE col.table_schema='public'
                            AND col.table_name='conversations'
                            AND col.column_name=c.nombre))
  UNION ALL
  SELECT 3, 'Migracion 0023 - esquemas por capacidad', '3',
         (SELECT count(*)::text FROM information_schema.schemata
           WHERE schema_name IN ('wa_receiver','wa_sender','wa_engine'))
  UNION ALL
  SELECT 4, 'Migracion 0023 - vistas de capacidad y reconciliacion', '6',
         (SELECT count(*)::text FROM information_schema.views
           WHERE (table_schema='wa_receiver' AND table_name='inbound_conversations')
              OR (table_schema='wa_sender' AND table_name='pending_outbox')
              OR (table_schema='wa_engine' AND table_name IN ('conversation_context','open_cycles','personal_knowledge'))
              OR (table_schema='public' AND table_name='conversation_reconciliation'))
  UNION ALL
  SELECT 5, 'Migracion 0023 - roles de capacidad', '3',
         (SELECT count(*)::text FROM pg_roles
           WHERE rolname IN ('jarvi_receptor','jarvi_emisor','jarvi_motor'))
  UNION ALL
  SELECT 6, 'Indices de idempotencia y de cola', '3',
         (SELECT count(*)::text FROM pg_indexes
           WHERE schemaname='public'
             AND indexname IN ('conversation_events_event_uq',
                               'conversation_outbox_message_uq',
                               'conversation_summaries_version_uq'))
  UNION ALL
  SELECT 7, 'Cola pendiente de entrega', '0',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_outbox') IS NULL
                THEN 'SELECT ''sin-tabla'' AS c'
                ELSE 'SELECT count(*)::text AS c FROM conversation_outbox WHERE status IN (''queued'',''sending'')' END,
           false, true, '')))[1]::text, 'sin-tabla')
  UNION ALL
  SELECT 8, 'Envios desconocidos con revision pendiente', '0',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_outbox') IS NULL
                THEN 'SELECT ''sin-tabla'' AS c'
                ELSE 'SELECT count(*)::text AS c FROM conversation_outbox WHERE status = ''unknown''' END,
           false, true, '')))[1]::text, 'sin-tabla')
  UNION ALL
  SELECT 9, 'Turnos registrados con huella de contexto (informativo)', 'informativo',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_turns') IS NULL
                THEN 'SELECT 0 AS c'
                ELSE 'SELECT count(*)::text AS c FROM conversation_turns' END,
           false, true, '')))[1]::text, '0')
  UNION ALL
  SELECT 10, 'Migracion 0024 - activacion preactivada en el panel', '8',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.integration_settings') IS NULL
                THEN 'SELECT 0 AS c'
                ELSE 'SELECT count(*)::text AS c FROM integration_settings WHERE provider = ''conversation''' END,
           false, true, '')))[1]::text, '0')
  UNION ALL
  SELECT 11, 'Activacion del agente encendida', 'true',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.integration_settings') IS NULL
                THEN 'SELECT ''sin-panel'' AS c'
                ELSE 'SELECT setting_value AS c FROM integration_settings WHERE provider = ''conversation'' AND setting_key = ''agent_enabled''' END,
           false, true, '')))[1]::text, 'sin-panel')
  UNION ALL
  SELECT 12, 'Migracion 0025 - lectura de la bandeja por operador', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'conversation_read_state')
  UNION ALL
  SELECT 13, 'Migracion 0026 - expediente documental del candidato', '2',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN ('candidate_knowledge_folders',
                                'candidate_knowledge_files'))
  UNION ALL
  SELECT 14, 'Migracion 0027 - columnas de la esencia del CV', '5',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'candidate_knowledge_files'
             AND column_name IN ('cv_essence', 'cv_essence_status',
                                 'cv_essence_model', 'cv_essence_word_limit',
                                 'cv_essence_updated_at'))
  UNION ALL
  SELECT 15, 'Migracion 0028 - ciclo de pruebas de la postulacion', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'assessment_cycles')
  UNION ALL
  SELECT 16, 'Migracion 0029 - cierre evaluado del ciclo', '2',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'assessment_cycles'
             AND column_name IN ('evaluated_at', 'evaluation_score'))
  UNION ALL
  SELECT 17, 'Migracion 0030 - intentos por item del instrumento', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'assessment_item_attempts')
  UNION ALL
  SELECT 18, 'Migracion 0030 - identidad unica del intento', '1',
         (SELECT count(*)::text FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'assessment_item_attempts_identity_uq')
  UNION ALL
  SELECT 19, 'Migracion 0031 - desafio del ciclo automatico', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'evaluation_automation_challenges')
  UNION ALL
  SELECT 20, 'Migracion 0031 - indice de la cuenta de intentos', '1',
         (SELECT count(*)::text FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'audit_log_entity_action_idx')
  UNION ALL
  SELECT 21, 'Migracion 0032 - registro de codecs activado', '25',
         (SELECT count(*)::text FROM integration_settings
           WHERE provider = 'codecs' AND setting_value = 'true')
  UNION ALL
  SELECT 22, 'Migracion 0033 - permisos por usuario', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'user_permissions')
  UNION ALL
  SELECT 23, 'Migracion 0033 - desafio de confirmacion', '1',
         (SELECT count(*)::text FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'security_challenges')
)
SELECT orden, control, esperado, obtenido,
       CASE WHEN orden = 9 THEN 'INFORMATIVO'
            WHEN obtenido = esperado THEN 'OK'
            ELSE 'PENDIENTE' END AS estado
  FROM controles
UNION ALL
SELECT 999, 'GATE GLOBAL', 'sin pendientes',
       (SELECT count(*)::text || ' control(es) pendiente(s)' FROM controles
         WHERE orden <> 9 AND obtenido <> esperado),
       CASE WHEN (SELECT count(*) FROM controles
                   WHERE orden <> 9 AND obtenido <> esperado) = 0
            THEN 'OK' ELSE 'PENDIENTE' END
 ORDER BY orden;
