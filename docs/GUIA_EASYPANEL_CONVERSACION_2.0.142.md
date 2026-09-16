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

Se aplican con el ejecutor SQL de EasyPanel, en este orden estricto:

1. `drizzle/migrations/0022_conversational_agent.sql`
2. `drizzle/migrations/0023_conversation_service_split.sql`

Ambas son idempotentes: repetir su ejecución no duplica objetos ni pierde datos. Ninguna contiene credenciales.

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

Cada servicio se despliega como App independiente en EasyPanel, con el mismo repositorio y distinto comando de arranque.

```text
# Servicio 1 · recepción
CONVERSATION_SERVICE_MODE=split
CONVERSATION_SERVICE_CAPABILITY=receive
DATABASE_URL_RECEIVER=postgres://jarvi_receptor:<clave>@<host>:5432/<base>

# Servicio 2 · razonamiento
CONVERSATION_SERVICE_MODE=split
CONVERSATION_SERVICE_CAPABILITY=reason
DATABASE_URL_ENGINE=postgres://jarvi_motor:<clave>@<host>:5432/<base>

# Servicio 3 · envío
CONVERSATION_SERVICE_MODE=split
CONVERSATION_SERVICE_CAPABILITY=send
DATABASE_URL_SENDER=postgres://jarvi_emisor:<clave>@<host>:5432/<base>
```

Comandos de arranque:

```text
npx tsx server/services/receiver.ts
npx tsx server/services/engine.ts
npx tsx server/services/sender.ts
```

Si una variable dedicada falta, el servicio utiliza `DATABASE_URL`. Si el modo no es `split`, el servicio aislado se niega a arrancar en lugar de operar con las tres capacidades.

## 7. Verificación después del despliegue

1. Enviar un mensaje de prueba desde un WhatsApp autorizado y confirmar que el servicio de recepción lo registra en `conversation_messages` con estado `received`.
2. Confirmar que el servicio de razonamiento crea una fila en `conversation_turns` con huella de contexto y que la conversación pasa a `conversation_stage` distinto de `apertura`.
3. Confirmar que `conversation_outbox` recibe la fila en estado `queued` y que el servicio de envío la pasa a `sent` con `provider_message_id`.
4. Consultar `conversation_reconciliation` y verificar que `pending_outbox` vuelve a cero.
5. Detener el servicio de envío y comprobar que la recepción y el razonamiento continúan; la cola se acumula sin pérdida.
6. Detener el servicio de razonamiento y comprobar que la recepción continúa registrando y el envío entrega lo ya encolado.

## 8. Reversión

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

## 9. Límites declarados

- La separación por capacidad es una frontera de privilegio y de proceso, no una garantía de entrega exactamente una vez: un envío sin confirmación del proveedor se marca como desconocido y exige revisión humana.
- El modo separado exige que las tres capacidades estén activas; si el servicio de razonamiento está detenido, la conversación no avanza aunque la recepción y el envío funcionen.
- Los roles creados no pueden autenticarse mientras el operador no asigne contraseña.
- La migración `0023` no crea respaldos ni políticas de retención; esas decisiones permanecen en la operación.
