-- ============================================================================
-- JARVI RH 2.0.147 · Auditoría de recepción ApiChat/WhatsApp (solo lectura)
-- database/006_auditoria_recepcion_inbox.sql
--
-- Propósito: dictaminar POR QUÉ la bandeja no recibe mensajes entrantes.
-- Método: cada bloque reproduce una condición del código fuente y la evalúa
-- contra la base real. Ninguna consulta modifica datos.
--
-- Fuentes primarias referenciadas (líneas de la versión 2.0.147):
--   F1  server/inboxSync.ts L136-139  syncInboxConversation retorna sin procesar
--       cuando settings.mode != 'native' (api_mode en integration_settings).
--   F2  server/inboxSync.ts L141-143  retorna sin procesar cuando el endpoint
--       /messagesHistory está desactivado (endpoint_enabled:/messagesHistory).
--   F3  server/apiChatSettings.ts L87-97 encryptedSecret lanza si el secreto no
--       está cifrado; el puente registra [InboxSync] cada segundo.
--   F4  server/inboxSync.ts L158-161  si la API responde !ok se lanza (HTTP 429
--       pausa 60 s; HTTP 401/403 indican token/cliente rechazado).
--   F5  server/inboxSync.ts L162-165  payload no arreglo -> retorno silencioso.
--   F6  server/inboxSync.ts L82-86   el catálogo solo incluye provider='apichat'
--       y status IN ('pendiente','activo').
--   F7  server/inbox.ts L731+        registro entrante; falla si la asociación
--       teléfono<->conversación no es única o si falta la migración 0022 (42P01).
--
-- Uso: ejecutar en dbgate/EasyPanel contra la base de producción del ambiente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Configuración del proveedor (lo que lee getApiChatRuntimeSettings)
-- Dictamen: api_mode debe ser 'native' (o ausente), api_endpoint con /v1/,
-- y deben existir los secretos cifrados token y client_id (is_secret=true).
-- ---------------------------------------------------------------------------
SELECT setting_key,
       CASE WHEN is_secret
            THEN '*** cifrado(' || left(COALESCE(setting_value,''),6) || '…) ***'
            ELSE setting_value END AS valor,
       is_secret,
       COALESCE(updated_at::text,'sin fecha') AS actualizado
  FROM integration_settings
 WHERE provider='apichat'
 ORDER BY setting_key;

-- ---------------------------------------------------------------------------
-- B. Endpoint de recepción /messagesHistory (condición F2 del código)
-- Dictamen: la fila debe existir con valor 'true'. Si falta o vale 'false',
-- la recepción está apagada en configuración y el puente retorna en silencio.
-- ---------------------------------------------------------------------------
SELECT 'apichat' AS provider,
       'endpoint_enabled:/messagesHistory' AS setting_key,
       COALESCE((SELECT setting_value
                   FROM integration_settings
                  WHERE provider='apichat'
                    AND setting_key='endpoint_enabled:/messagesHistory'),
                'FALTA LA FILA') AS valor,
       CASE WHEN COALESCE((SELECT setting_value
                             FROM integration_settings
                            WHERE provider='apichat'
                              AND setting_key='endpoint_enabled:/messagesHistory'),'false') = 'true'
            THEN 'OK · recepción habilitada'
            ELSE 'ATENCIÓN · F2 activa: la recepción está apagada por configuración' END AS dictamen;

-- ---------------------------------------------------------------------------
-- C. Catálogo de conversaciones que el puente recorre (condición F6)
-- Dictamen: el teléfono del candidato debe aparecer aquí con status
-- pendiente/activo. Si no aparece, el sondeo nunca consulta su historial.
-- ---------------------------------------------------------------------------
SELECT conv.id AS conversacion,
       conv.status,
       conv.automation_state,
       conv.agent_enabled,
       conv.human_takeover,
       c.phone_international AS telefono_guardado,
       COALESCE(conv.last_message_at::text,'nunca') AS ultimo_mensaje
  FROM conversations conv
  JOIN applications a  ON a.id = conv.application_id
  JOIN candidates c    ON c.id = a.candidate_id
 WHERE conv.provider='apichat'
   AND conv.status IN ('pendiente','activo')
 ORDER BY COALESCE(conv.last_message_at,conv.updated_at) DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- D. Últimos mensajes registrados en la bandeja (lo que el usuario ve)
-- Dictamen: el mensaje más reciente del candidato debe aparecer con
-- direction='inbound'. Si el último es solo outbound, la recepción no escribe.
-- ---------------------------------------------------------------------------
SELECT m.id,
       m.conversation_id AS conv,
       m.direction,
       m.message_type,
       left(m.body,45) AS cuerpo,
       m.delivery_status,
       COALESCE(m.provider_message_id,'—') AS provider_id,
       left(m.message_key,22) AS clave,
       COALESCE(m.created_at::text,'—') AS creado
  FROM conversation_messages m
 WHERE m.conversation_id IN (SELECT id FROM conversations WHERE provider='apichat')
 ORDER BY m.created_at DESC, m.id DESC
 LIMIT 40;

-- ---------------------------------------------------------------------------
-- E. Duplicados en la bandeja (corregidos en 2.0.147; evidencia de datos)
-- Dictamen: filas con el MISMO provider_message_id en la misma conversación
-- son duplicados previos a la reconciliación. Se listan para saneamiento.
-- ---------------------------------------------------------------------------
SELECT conversation_id, provider_message_id, count(*) AS copias,
       min(id) AS primer_id, max(id) AS ultimo_id
  FROM conversation_messages
 WHERE provider_message_id IS NOT NULL
 GROUP BY conversation_id, provider_message_id
HAVING count(*) > 1
 ORDER BY conversation_id, provider_message_id;

-- ---------------------------------------------------------------------------
-- F. Teléfonos con varias conversaciones apichat activas (condición F7 previa)
-- Dictamen: con la versión desplegada 2.0.140 un teléfono con 2+ conversaciones
-- activas hacía fallar el registro entrante en silencio. La 2.0.146 lo corrige.
-- ---------------------------------------------------------------------------
SELECT c.phone_international AS telefono,
       count(*) AS conversaciones_activas
  FROM conversations conv
  JOIN applications a ON a.id = conv.application_id
  JOIN candidates c   ON c.id = a.candidate_id
 WHERE conv.provider='apichat'
   AND conv.status IN ('pendiente','activo')
 GROUP BY c.phone_international
HAVING count(*) > 1
 ORDER BY conversaciones_activas DESC;

-- ---------------------------------------------------------------------------
-- G. Telefonía guardada (el sondeo llama /v1/messages?number=<solo dígitos>)
-- Dictamen: inspeccionar dígitos y longitud; un número mal guardado impide que
-- el proveedor devuelva el historial (F4/F5) aunque la fila exista.
-- ---------------------------------------------------------------------------
SELECT c.phone_international AS telefono_guardado,
       regexp_replace(c.phone_international,'\D','','g') AS solo_digitos,
       length(regexp_replace(c.phone_international,'\D','','g')) AS digitos,
       c.updated_at::text AS actualizado
  FROM candidates c
 WHERE c.phone_international IS NOT NULL
 ORDER BY c.updated_at DESC NULLS LAST
 LIMIT 25;

-- ---------------------------------------------------------------------------
-- H. Esquema conversacional (la lluvia de errores del ConversationWorker)
-- Dictamen: true en las tres primeras indica migraciones aplicadas. Si alguna
-- es false, falta ejecutar database/005_servicio_conversacional_listo.sql.
-- ---------------------------------------------------------------------------
SELECT to_regclass('public.conversation_turns') IS NOT NULL AS turnos,
       to_regclass('public.conversation_outbox') IS NOT NULL AS cola,
       to_regclass('public.conversation_reconciliation') IS NOT NULL AS reconciliacion,
       (SELECT count(*) FROM integration_settings WHERE provider='conversation') AS interruptores;

-- ---------------------------------------------------------------------------
-- I. DICTAMEN DE RECEPCIÓN (banderas calculadas sobre las condiciones del código)
-- 1 = falla activa. Todas en 0 = la recepción tiene vía libre en la base.
-- ---------------------------------------------------------------------------
SELECT
  CASE WHEN COALESCE((SELECT setting_value FROM integration_settings
                       WHERE provider='apichat' AND setting_key='api_mode'),'native') <> 'native'
       THEN 1 ELSE 0 END AS f1_modo_no_nativo,
  CASE WHEN COALESCE((SELECT setting_value FROM integration_settings
                       WHERE provider='apichat'
                         AND setting_key='endpoint_enabled:/messagesHistory'),'false') <> 'true'
       THEN 1 ELSE 0 END AS f2_historial_apagado,
  CASE WHEN NOT EXISTS (SELECT 1 FROM integration_settings
                         WHERE provider='apichat' AND setting_key='token'
                           AND is_secret=true AND setting_value IS NOT NULL)
          OR NOT EXISTS (SELECT 1 FROM integration_settings
                         WHERE provider='apichat' AND setting_key='client_id'
                           AND is_secret=true AND setting_value IS NOT NULL)
       THEN 1 ELSE 0 END AS f3_secretos_faltantes,
  CASE WHEN (SELECT count(*) FROM conversations
              WHERE provider='apichat' AND status IN ('pendiente','activo')) = 0
       THEN 1 ELSE 0 END AS f6_sin_conversaciones,
  CASE WHEN to_regclass('public.conversation_turns') IS NULL
       THEN 1 ELSE 0 END AS f7_migraciones_faltantes;
