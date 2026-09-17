# Guía de despliegue conversacional separado · JARVI RH 2.0.142

Esta guía describe el **esquema final** del servicio conversacional y los pasos para ejecutarlo en EasyPanel, tanto en modo integrado como en modo separado por capacidad.

## 1. Qué cambia frente a 2.0.141

| Aspecto | 2.0.141 (integrado) | 2.0.142 (separado) |
| --- | --- | --- |
| Procesos | Un servicio con las tres capacidades | Hasta tres servicios: `receive`, `reason`, `send` |
| Cola de salida | `conversation_messages` con estado `queued` | `conversation_outbox` con reclamo `FOR UPDATE SKIP LOCKED` |
| Credenciales | `DATABASE_URL` única | Opcionalmente `DATABASE_URL_RECEIVER`, `DATABASE_URL_ENGINE`, `DATABASE_URL_SENDER` |
| Fronteras | Verificadas por pruebas sobre el código | Verificadas además por capacidad declarada en tiempo de ejecución |
| Compatibilidad | — | Sin la migración `0023` el sistema operativo sigue funcionando en modo integrado |

## 2. Orden de migraciones

**Un solo archivo deja todo listo:** `database/005_servicio_conversacional_listo.sql`. Reúne las migraciones `0022` a `0030`, es idempotente y termina con la verificación autocertificada; se genera con `pnpm deploy:sql` y se validó en PostgreSQL 17 desde cero con `GATE GLOBAL OK`.

Procedimiento: abra el archivo, copie todo su contenido y pégelo en el ejecutor SQL (dbgate o EasyPanel); ejecútelo una vez y lea el dictamen final. Todas las filas deben quedar en `OK` y el `GATE GLOBAL` en `OK`.

Si prefiere aplicarlo por partes, el orden estricto es:

1. `drizzle/migrations/0022_conversational_agent.sql`
2. `drizzle/migrations/0023_conversation_service_split.sql`
3. `drizzle/migrations/0024_conversation_activation.sql`
4. `drizzle/migrations/0025_inbox_read_state.sql`
5. `drizzle/migrations/0026_candidate_knowledge.sql`
6. `drizzle/migrations/0027_candidate_cv_essence.sql`
7. `drizzle/migrations/0028_assessment_cycles.sql`
8. `drizzle/migrations/0029_assessment_cycle_evaluation.sql`
9. `drizzle/migrations/0030_assessment_item_attempts.sql`

Las nueve son idempotentes y ninguna contiene credenciales. La tercera **preactiva** el servicio conversacional en el panel de configuración, de modo que no hace falta agregar ninguna variable de entorno.

## 3. Contraseñas de los roles

La migración crea los roles **sin contraseña**. Asignarlas es responsabilidad del operador y no debe quedar registrado en el repositorio:

```sql
-- Ejecutar una sola vez por ambiente, con una contraseña propia de la organización.
ALTER ROLE jarvi_receptor WITH PASSWORD 'DEFINA_AQUI_LA_CONTRASENA_DEL_RECEPTOR';
ALTER ROLE jarvi_emisor   WITH PASSWORD 'DEFINA_AQUI_LA_CONTRASENA_DEL_EMISOR';
ALTER ROLE jarvi_motor    WITH PASSWORD 'DEFINA_AQUI_LA_CONTRASENA_DEL_MOTOR';
```

Verificación de privilegios mínimos:

```sql
SELECT grantee, table_schema, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee IN ('jarvi_receptor','jarvi_emisor','jarvi_motor')
 ORDER BY grantee, table_name, privilege_type;
```

## 4. Verificación del esquema

```sql
-- Estructura creada por 0023.
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('conversation_outbox');

SELECT schema_name FROM information_schema.schemata
 WHERE schema_name IN ('wa_receiver','wa_sender','wa_engine');

-- Reconciliación operativa por conversación.
SELECT conversation_id, automation_state, agent_turn_count, pending_outbox,
       unknown_outbox, open_cycles, last_turn_validation, last_turn_fingerprint
  FROM conversation_reconciliation
 ORDER BY conversation_id DESC
 LIMIT 20;

-- Despachos sin confirmación que exigen intervención humana.
SELECT conversation_id, id, attempt_count, last_error
  FROM conversation_outbox
 WHERE status IN ('unknown','failed')
 ORDER BY updated_at DESC
 LIMIT 20;
```

## 5. Modo integrado (una sola aplicación)

No requiere variables adicionales. Basta con que exista `DATABASE_URL`:

```text
CONVERSATION_SERVICE_MODE=single
```

El barrido integrado ejecuta razonamiento y envío en el mismo proceso, con las mismas fronteras de código verificadas por `server/boundaries.test.ts`.

## 6. Modo separado (tres servicios)

**No se requiere ninguna variable de entorno nueva.** La activación vive en `Configuración › WhatsApp` y la migración `0024` la deja encendida; la capacidad es intrínseca al punto de entrada, de modo que el servicio `sender.ts` atiende el envío, `engine.ts` el razonamiento y `receiver.ts` la recepción. Cada servicio se despliega como App independiente en EasyPanel con el mismo repositorio, el mismo `DATABASE_URL` que ya usa la aplicación y su comando de arranque.

| Elemento | `jarvi-receptor` | `jarvi-motor` | `jarvi-emisor` |
| --- | --- | --- | --- |
| Comando de arranque | `npx tsx server/services/receiver.ts` | `npx tsx server/services/engine.ts` | `npx tsx server/services/sender.ts` |
| Capacidad que atiende | recepción | razonamiento | envío |
| Variable obligatoria | `DATABASE_URL` | `DATABASE_URL` y `AGENT_SETTINGS_ENCRYPTION_KEY` | `DATABASE_URL` y `AGENT_SETTINGS_ENCRYPTION_KEY` |
| Dominio público | no asignar | no asignar | no asignar |
| Interruptor en el panel | «Capacidad de recepción» | «Capacidad de razonamiento» | «Capacidad de envío» |

`DATABASE_URL` y `AGENT_SETTINGS_ENCRYPTION_KEY` ya existen en el servicio actual: no hay nada nuevo que agregar. Para separar el tráfico, cambie «Despliegue» a **Separado por capacidad** en el panel; con **Integrado en la aplicación** el barrido corre dentro de la aplicación y los servicios dedicados permanecen inactivos.

### Variables opcionales de endurecimiento (avanzado)

Solo si el operador decide aislar privilegios por servicio. No son necesarias para operar:

| Variable | Efecto |
| --- | --- |
| `DATABASE_URL_RECEIVER` | Usa el rol `jarvi_receptor` en lugar de la conexión principal |
| `DATABASE_URL_ENGINE` | Usa el rol `jarvi_motor` |
| `DATABASE_URL_SENDER` | Usa el rol `jarvi_emisor` |
| `CONVERSATION_SERVICE_MODE` | Fuerza el modo declarado (anula el panel; el aviso lo indica) |
| `CONVERSATION_SERVICE_CAPABILITY` | Restringe el proceso a una sola capacidad |

## 6.1 Qué debe llevar cada servicio

```text
# Servicio 1 · recepción
DATABASE_URL=<la misma que usa la aplicación>
# Comando: npx tsx server/services/receiver.ts

# Servicio 2 · razonamiento
DATABASE_URL=<la misma que usa la aplicación>
AGENT_SETTINGS_ENCRYPTION_KEY=<la misma que usa la aplicación>
# Comando: npx tsx server/services/engine.ts

# Servicio 3 · envío
DATABASE_URL=<la misma que usa la aplicación>
AGENT_SETTINGS_ENCRYPTION_KEY=<la misma que usa la aplicación>
# Comando: npx tsx server/services/sender.ts
```

La capacidad de cada proceso es intrínseca al archivo que se ejecuta: no se declara con variables. Si el panel apaga una capacidad, el proceso permanece vivo pero inactivo y lo registra en la bitácora. Si el operador define una conexión dedicada (`DATABASE_URL_RECEIVER`, `DATABASE_URL_ENGINE` o `DATABASE_URL_SENDER`), el servicio la utiliza en lugar de la principal.

## 6.2 Activación en el panel de configuración

`Configuración › WhatsApp › Activación del servicio conversacional` gobierna el servicio sin variables de entorno:

| Interruptor | Estado inicial | Efecto |
| --- | --- | --- |
| Agente JARVI HR | encendido | Genera respuestas y cierra ciclos de información |
| Despacho de la cola | encendido | Entrega por WhatsApp lo autorizado |
| Capacidad de recepción | encendido | Registra lo que la persona escribe |
| Capacidad de razonamiento | encendido | Compone el expediente y verifica la conducta |
| Capacidad de envío | encendido | Despacha al proveedor |
| Despliegue | Integrado | Integrado en la aplicación o separado por capacidad |
| Historial recordado | 12 turnos | Memoria rehidratada en cada turno |
| Límite de palabras | 90 | Extensión máxima de cada respuesta |

Cada cambio se audita en `audit_log` con el asunto `activation_updated`. El botón «Restaurar valores de fábrica» rellena el formulario con los valores preactivados.

## 7. Verificación después del despliegue

1. Enviar un mensaje de prueba desde un WhatsApp autorizado y confirmar que el servicio de recepción lo registra en `conversation_messages` con estado `received`.
2. Confirmar que el servicio de razonamiento crea una fila en `conversation_turns` con huella de contexto y que la conversación pasa a `conversation_stage` distinto de `apertura`.
3. Confirmar que `conversation_outbox` recibe la fila en estado `queued` y que el servicio de envío la pasa a `sent` con `provider_message_id`.
4. Consultar `conversation_reconciliation` y verificar que `pending_outbox` vuelve a cero.
5. Detener el servicio de envío y comprobar que la recepción y el razonamiento continúan; la cola se acumula sin pérdida.
6. Detener el servicio de razonamiento y comprobar que la recepción continúa registrando y el envío entrega lo ya encolado.

## 8. Consulta única de verificación (DB gate)

Una sola consulta comprueba el estado de la base conversacional. Devuelve una fila por control con `OK` o `PENDIENTE`, y una fila final con el dictamen. Se puede ejecutar antes y después de aplicar las migraciones, incluso si ninguna está aplicada.

```sql
WITH controles AS (
  SELECT 1 AS orden, 'Migracion 0022 - tablas del agente' AS control, '6' AS esperado,
         (SELECT count(*)::text FROM (VALUES ('conversation_turns'),('conversation_summaries'),('conversation_cycles'),('conversation_events'),('candidate_knowledge_notes'),('conversation_outbox')) AS t(nombre)
           WHERE to_regclass('public.'||t.nombre) IS NOT NULL) AS obtenido
  UNION ALL
  SELECT 2, 'Migracion 0022 - columnas de conversations', '4',
         (SELECT count(*)::text FROM (VALUES ('conversation_stage'),('last_agent_turn_at'),('last_agent_error'),('agent_turn_count')) AS c(nombre)
           WHERE EXISTS (SELECT 1 FROM information_schema.columns col
                          WHERE col.table_schema='public' AND col.table_name='conversations' AND col.column_name=c.nombre))
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
           WHERE schemaname='public' AND indexname IN ('conversation_events_event_uq','conversation_outbox_message_uq','conversation_summaries_version_uq'))
  UNION ALL
  SELECT 7, 'Cola pendiente de entrega (requiere 0023)', '0',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_outbox') IS NULL THEN 'SELECT 0 AS c'
                ELSE 'SELECT count(*) AS c FROM conversation_outbox WHERE status IN (''queued'',''sending'')' END,
           false, true, '')))[1]::text, '0')
  UNION ALL
  SELECT 8, 'Envios desconocidos con revision pendiente (requiere 0023)', '0',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_outbox') IS NULL THEN 'SELECT 0 AS c'
                ELSE 'SELECT count(*) AS c FROM conversation_outbox WHERE status = ''unknown''' END,
           false, true, '')))[1]::text, '0')
  UNION ALL
  SELECT 9, 'Turnos registrados con huella de contexto (informativo)', 'informativo',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.conversation_turns') IS NULL THEN 'SELECT 0 AS c'
                ELSE 'SELECT count(*) AS c FROM conversation_turns' END,
           false, true, '')))[1]::text, '0')
  UNION ALL
  SELECT 10, 'Migracion 0024 - activacion preactivada en el panel', '8',
         COALESCE((xpath('/row/c/text()', query_to_xml(
           CASE WHEN to_regclass('public.integration_settings') IS NULL THEN 'SELECT 0 AS c'
                ELSE 'SELECT count(*) AS c FROM integration_settings WHERE provider = ''conversation''' END,
           false, true, '')))[1]::text, '0')
)
SELECT orden, control, esperado, obtenido,
       CASE WHEN orden = 9 THEN 'INFORMATIVO'
            WHEN obtenido = esperado THEN 'OK'
            ELSE 'PENDIENTE' END AS estado
  FROM controles
UNION ALL
SELECT 999, 'GATE GLOBAL', 'sin pendientes',
       (SELECT count(*)::text || ' control(es) pendiente(s)' FROM controles
         WHERE (orden <= 8 OR orden = 10) AND obtenido <> esperado),
       CASE WHEN (SELECT count(*) FROM controles
                   WHERE (orden <= 8 OR orden = 10) AND obtenido <> esperado) = 0
            THEN 'OK' ELSE 'PENDIENTE' END
 ORDER BY orden;
```

Lectura del resultado:

- **Filas 1 a 6 y 10 en `OK`** ⇒ esquema conversacional completo y **activación preactivada**. La fila 10 debe mostrar `8` (los ocho interruptores del servicio).
- **Fila 5** ⇒ si aparece en `OK`, los roles existen aunque todavía no tengan contraseña asignada: es lo esperado hasta que el operador las defina.
- **Filas 7 y 8** ⇒ cola pendiente y envíos desconocidos; en régimen estable deben ser `0`.
- **Fila 9** ⇒ informativo: turnos registrados.
- **Fila 999** ⇒ dictamen. `OK` habilita el despliegue; `PENDIENTE` indica que falta aplicar una migración.

## 9. Reversión

```sql
-- Volver al recorrido integrado sin perder evidencia.
DROP VIEW IF EXISTS conversation_reconciliation;
DROP SCHEMA IF EXISTS wa_receiver CASCADE;
DROP SCHEMA IF EXISTS wa_sender CASCADE;
DROP SCHEMA IF EXISTS wa_engine CASCADE;
DROP ROLE IF EXISTS jarvi_receptor;
DROP ROLE IF EXISTS jarvi_emisor;
DROP ROLE IF EXISTS jarvi_motor;
-- La tabla conversation_outbox se conserva: contiene la evidencia de entrega.
```

Con la cola conservada, el modo integrado de 2.0.142 sigue reconociendo los mensajes pendientes. Para volver a 2.0.141 basta con desplegar la versión anterior: los mensajes en `queued` los localiza el recorrido sobre `conversation_messages`.

## 10. Límites declarados

- La separación por capacidad es una frontera de privilegio y de proceso, no una garantía de entrega exactamente una vez: un envío sin confirmación del proveedor se marca como desconocido y exige revisión humana.
- El modo separado exige que las tres capacidades estén activas; si el servicio de razonamiento está detenido, la conversación no avanza aunque la recepción y el envío funcionen.
- Los roles creados no pueden autenticarse mientras el operador no asigne contraseña.
- La migración `0023` no crea respaldos ni políticas de retención; esas decisiones permanecen en la operación.
