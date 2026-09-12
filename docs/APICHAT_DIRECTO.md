# ApiChat directo · credenciales administradas en PostgreSQL

Talento AISA envía y recibe mensajes directamente contra la API de ApiChat desde el backend, sin adaptadores intermedios ni variables `APICHAT_*` del servicio en EasyPanel. El envío utiliza los endpoints oficiales y la recepción se obtiene con la regla de sincronización de un segundo mediante `GET /v1/messages`. Administración > Configuración > WhatsApp es la única interfaz autorizada para configurar y rotar las credenciales de la aplicación.

## Migraciones previas al despliegue

Ejecute [0013_apichat_credential_vault.sql](../drizzle/migrations/0013_apichat_credential_vault.sql) y después [0014_cognitive_governance.sql](../drizzle/migrations/0014_cognitive_governance.sql). La primera migración crea el almacén cifrado; la segunda amplía conversaciones y agrega la cuarentena minimizada. Ambas son idempotentes y no contienen credenciales.

```sql
BEGIN;

INSERT INTO integration_settings
  (provider, setting_key, setting_value, is_secret, updated_at)
VALUES
  ('apichat', 'api_mode', 'native', false, now()),
  ('apichat', 'api_endpoint', 'https://api.apichat.io/v1/sendText', false, now()),
  ('apichat', 'connect_to', 'apichat.io', false, now()),
  ('apichat', 'client_id', NULL, true, now()),
  ('apichat', 'token', NULL, true, now()),
  ('apichat', 'account_id', NULL, true, now())
ON CONFLICT (provider, setting_key) DO NOTHING;

COMMIT;
```

El query es para una instalación inicial. `ON CONFLICT DO NOTHING` evita sobrescribir una configuración existente. La recepción no exige ninguna URL adicional: el puente de sincronización consulta directamente el historial oficial del proveedor.

No inserte el Client ID ni el token como texto mediante SQL. Después de ejecutar las migraciones, ingréselos en las tarjetas seguras del módulo administrativo. El servidor los cifra con AES-256-GCM y prefijo `enc:v2:`; cada ciphertext incluye identificador de clave y AAD ligada a proveedor/campo para impedir su intercambio. Los valores `enc:v1:` anteriores permanecen legibles únicamente para rotación compatible. El navegador solo recibe el estado y los últimos cuatro caracteres enmascarados.

## Fuente de cifrado

El cifrado requiere una fuente estable del servidor. Se recomienda `AGENT_SETTINGS_ENCRYPTION_KEY`; durante una rotación, el servidor también intenta las fuentes estables existentes `JWT_SECRET` y `DATABASE_URL` para conservar la lectura del material cifrado anteriormente. No cambie simultáneamente todas las fuentes sin un procedimiento de recifrado.

## Configuración inicial

1. Ingrese a Administración > Configuración > WhatsApp.
2. Conserve **API nativa** y el endpoint oficial `https://api.apichat.io/v1/sendText`.
3. Revise la conexión.
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

No existe una espera operativa de 30 segundos: el envío se inicia desde el backend después del commit. La deduplicación por identificador del proveedor se aplica a la recepción. El envío saliente conserva una clave lógica y estados locales, pero no garantiza entrega exactamente una vez; ante un resultado desconocido debe verificarse la conversación antes de reintentar.

La bandeja se sincroniza con una regla de un segundo: el servidor recorre las conversaciones activas por turnos y rellena desde `GET /v1/messages` los mensajes entrantes y salientes que el webhook no hubiera registrado; el cliente además refresca la lista y el detalle cada segundo.

El estado **Calificado por AISA** (`calificado_aisa`) no envía mensajes. La recepción no depende de ninguna URL de reenvío: el puente `inboxSync` consulta `GET /v1/messages` cada segundo por conversación activa y registra los mensajes entrantes y salientes que falten, con deduplicación por `providerMessageId`. Un teléfono sin postulación se registra en `inbound_message_quarantine` solo como huellas HMAC, sin conservar número ni mensaje.

El puente de sincronización admite tres tipos normalizados del historial oficial: `text`, `link` y `location`. Los medios (audio, PDF, Word) permanecen excluidos por política hasta completar el pipeline seguro.

La bandeja de entrada envía además enlaces (`/v1/sendLink`), ubicaciones (`/v1/sendLocation`), archivos por URL HTTPS (`/v1/sendFile`), notas de voz por URL HTTPS (`/v1/sendPTT`) y puede eliminar mensajes del proveedor (`/v1/deleteMessage`). Cada operación conserva el control humano, la persistencia previa, los estados de entrega, la auditoría y la observabilidad del envío de texto.

Si no existe una conversación activa, el mensaje se omite de la bandeja; la cuarentena minimizada sigue disponible para diagnósticos posteriores sin contenido recuperable.

ApiChat publica, según su OpenAPI nativo, un objeto `messages` cuyos elementos incluyen `id`, `number`, `type`, `from_me` y, para texto, `text`. El puente `inboxSync` consulta ese historial directamente, distingue entradas y salidas con `from_me`, ignora grupos y medios sin pipeline, convierte el teléfono al formato E.164 y conserva el identificador original para deduplicar.

No existe ningún intermediario de reenvío: la frontera pública del proveedor se consulta con los encabezados oficiales `client-id` y `token` desde el backend.

La recepción de audio, PDF, Word y otros medios **no está conectada** en esta versión: existen tablas y cuotas preparatorias, pero faltan descarga autenticada, detección de tipo por contenido, análisis antimalware, bucket, retención y visualización.

## Controles de seguridad

- Solo `adminProcedure` puede leer estados enmascarados, modificar o verificar la integración.
- Las claves permitidas se definen mediante listas cerradas; la ruta genérica de configuración no acepta ApiChat ni secretos.
- Un valor histórico sin el prefijo cifrado se rechaza y debe rotarse desde la interfaz.
- El endpoint nativo exige HTTPS, el dominio oficial y la ruta `/v1/sendText`.
- La bitácora conserva la acción y el nombre de la clave, nunca su valor.
- La sincronización revalida cada mensaje contra `GET /v1/messages` antes de resolver o persistir; esta comprobación no sustituye firma, ventana anti-replay ni rate limiting.
- Ante el límite de tasa del proveedor (HTTP 429), el puente se pausa y retoma con espaciamiento; nunca reintenta de forma agresiva.
- La deduplicación documentada corresponde al ingreso por `providerMessageId`; la salida requiere reconciliación manual cuando su resultado es desconocido.
- Las pruebas usan credenciales ficticias y transporte simulado; no realizan envíos reales.

Antes de retirar `APICHAT_*` de EasyPanel, compruebe un envío saliente, una verificación y una sincronización de recepción con datos ficticios. Confirme que la bandeja rellena entradas y salidas sin duplicados y que el historial no conserva payloads. Conserve respaldo y ventana de reversión; la eliminación de variables se realiza solo después de confirmar que todas las rutas leen PostgreSQL.

Fuentes del contrato: [documentación oficial de ApiChat](https://apichat.io/api-docs) y [OpenAPI/Swagger oficial](https://panel.apichat.io/docs/swagger).
