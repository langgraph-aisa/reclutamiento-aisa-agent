# ApiChat directo · credenciales administradas en PostgreSQL

Talento AISA envía la solicitud de CV directamente desde el backend. El flujo activo no utiliza n8n ni variables `APICHAT_*` del servicio en EasyPanel. Administración > Configuración > WhatsApp es la única interfaz autorizada para configurar y rotar estas credenciales.

## Migración previa al despliegue

Ejecute [0013_apichat_credential_vault.sql](../drizzle/migrations/0013_apichat_credential_vault.sql) antes de iniciar JARVI RH 2.0.129. El query es idempotente: configura los valores públicos de la API nativa y crea vacías las filas reservadas para secretos.

```sql
BEGIN;

INSERT INTO integration_settings
  (provider, setting_key, setting_value, is_secret, updated_at)
VALUES
  ('apichat', 'api_mode', 'native', false, now()),
  ('apichat', 'api_endpoint', 'https://api.apichat.io/v1/sendText', false, now()),
  ('apichat', 'connect_to', 'apichat.io', false, now()),
  ('apichat', 'webhook_url', 'https://aisa-testing-n8n-testing.4ugrim.easypanel.host/webhook/apichat/incoming', false, now()),
  ('apichat', 'client_id', NULL, true, now()),
  ('apichat', 'token', NULL, true, now()),
  ('apichat', 'account_id', NULL, true, now())
ON CONFLICT (provider, setting_key) DO NOTHING;

COMMIT;
```

No inserte el Client ID ni el token como texto mediante SQL. Después de ejecutar la migración, ingréselos en las tarjetas seguras del módulo administrativo. El servidor los cifra con AES-256-GCM y prefijo `enc:v1:` antes de escribirlos. El navegador solo recibe el estado y los últimos cuatro caracteres enmascarados.

## Fuente de cifrado

El cifrado requiere una fuente estable del servidor. Se recomienda `AGENT_SETTINGS_ENCRYPTION_KEY`; durante una rotación, el servidor también intenta las fuentes estables existentes `JWT_SECRET` y `DATABASE_URL` para conservar la lectura del material cifrado anteriormente. No cambie simultáneamente todas las fuentes sin un procedimiento de recifrado.

## Configuración inicial

1. Ingrese a Administración > Configuración > WhatsApp.
2. Conserve **API nativa** y el endpoint oficial `https://api.apichat.io/v1/sendText`.
3. Revise la conexión y la URL del webhook.
4. Guarde por separado el Client ID y el token; cada operación queda registrada en `audit_log` sin el valor secreto.
5. Active **Verificar**. El servidor consulta `GET https://api.apichat.io/v1/status` con los encabezados oficiales `client-id` y `token`; no envía mensajes y no devuelve códigos QR al navegador.
6. Cuando la verificación resulte satisfactoria, elimine las antiguas variables `APICHAT_*` del servicio de aplicación en EasyPanel y vuelva a desplegar.

El modo heredado conserva las cajas de ID de cuenta y conexión únicamente para compatibilidad controlada. La verificación integrada corresponde al contrato nativo.

## Comportamiento operativo

1. El reclutador selecciona **Solicitar CV por WhatsApp**.
2. PostgreSQL guarda el estado, la auditoría y el mensaje pendiente en una transacción.
3. Después del commit, `getApiChatRuntimeSettings` lee y descifra la configuración desde `integration_settings`.
4. El backend llama a ApiChat con un tiempo límite de 15 segundos.
5. En éxito, guarda el identificador del proveedor y marca `whatsapp_status='enviado'`.
6. En error, conserva el estado interno, marca el envío como fallido y habilita el reintento manual.
7. Si el proveedor pudo aceptar el mensaje pero falla la confirmación local, el estado queda como desconocido para impedir un duplicado automático.

El estado **Calificado por AISA** (`calificado_aisa`) no envía mensajes. La recepción y almacenamiento de adjuntos requiere un webhook entrante independiente.

## Controles de seguridad

- Solo `adminProcedure` puede leer estados enmascarados, modificar o verificar la integración.
- Las claves permitidas se definen mediante listas cerradas; la ruta genérica de configuración no acepta ApiChat ni secretos.
- Un valor histórico sin el prefijo cifrado se rechaza y debe rotarse desde la interfaz.
- El endpoint nativo exige HTTPS, el dominio oficial y la ruta `/v1/sendText`.
- La bitácora conserva la acción y el nombre de la clave, nunca su valor.
- Las pruebas usan credenciales ficticias y transporte simulado; no realizan envíos reales.

Fuentes del contrato: [documentación oficial de ApiChat](https://apichat.io/api-docs) y [Swagger oficial](https://panel.apichat.io/docs/swagger).
