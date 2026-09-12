# ApiChat directo · credenciales administradas en PostgreSQL

Talento AISA envía la solicitud de CV directamente desde el backend; ese trayecto no utiliza n8n ni variables `APICHAT_*` del servicio en EasyPanel. La recepción usa el workflow 04 como adaptador del webhook oficial y entrega un contrato normalizado al backend. Administración > Configuración > WhatsApp es la única interfaz autorizada para configurar y rotar las credenciales de la aplicación.

## Migraciones previas al despliegue

Ejecute [0013_apichat_credential_vault.sql](../drizzle/migrations/0013_apichat_credential_vault.sql) y después [0014_cognitive_governance.sql](../drizzle/migrations/0014_cognitive_governance.sql). La primera migración crea el almacén cifrado; la segunda reserva el secreto del receptor entrante, amplía conversaciones y agrega la cuarentena minimizada. Ambas son idempotentes y no contienen credenciales.

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
  ('apichat', 'account_id', NULL, true, now()),
  ('apichat', 'webhook_secret', NULL, true, now())
ON CONFLICT (provider, setting_key) DO NOTHING;

COMMIT;
```

El query es para una instalación inicial. `ON CONFLICT DO NOTHING` evita sobrescribir una configuración existente. Después de importar y activar el workflow 04, confirme que n8n publica exactamente esa URL de producción; si la instancia usa otro dominio, actualícela desde Configuración > WhatsApp.

No inserte el Client ID, el token ni el secreto del webhook como texto mediante SQL. Después de ejecutar las migraciones, ingréselos en las tarjetas seguras del módulo administrativo. El servidor los cifra con AES-256-GCM y prefijo `enc:v2:`; cada ciphertext incluye identificador de clave y AAD ligada a proveedor/campo para impedir su intercambio. Los valores `enc:v1:` anteriores permanecen legibles únicamente para rotación compatible. El navegador solo recibe el estado y los últimos cuatro caracteres enmascarados.

## Fuente de cifrado

El cifrado requiere una fuente estable del servidor. Se recomienda `AGENT_SETTINGS_ENCRYPTION_KEY`; durante una rotación, el servidor también intenta las fuentes estables existentes `JWT_SECRET` y `DATABASE_URL` para conservar la lectura del material cifrado anteriormente. No cambie simultáneamente todas las fuentes sin un procedimiento de recifrado.

## Configuración inicial

1. Ingrese a Administración > Configuración > WhatsApp.
2. Conserve **API nativa** y el endpoint oficial `https://api.apichat.io/v1/sendText`.
3. Revise la conexión y la URL HTTPS del webhook normalizado.
4. Guarde por separado el Client ID, el token y un secreto Bearer de webhook aleatorio; cada operación queda registrada en `audit_log` sin el valor secreto.
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

El estado **Calificado por AISA** (`calificado_aisa`) no envía mensajes. El receptor entrante `POST /api/webhooks/apichat/incoming` procesa texto normalizado, exige `Authorization: Bearer <secreto>` y revalida identificador, teléfono, dirección y texto mediante `GET /v1/messages` con las credenciales cifradas. Esta consulta ocurre antes de resolver la conversación y persistir. Una discordancia responde `422`; un fallo de red o rechazo del proveedor responde `500`, sin registrar el cuerpo. Después de verificar, el receptor deduplica por `providerMessageId`. Un teléfono sin postulación se registra en `inbound_message_quarantine` solo como huellas HMAC, sin conservar número ni mensaje.

El cuerpo cerrado admitido acepta tres tipos normalizados: `text`, `link` y `location`. El workflow 04 convierte el sobre oficial y entrega cada evento con su identificador, teléfono E.164 y contenido correspondiente; los medios (audio, PDF, Word) permanecen excluidos por política hasta completar el pipeline seguro.

```json
{
  "providerMessageId": "identificador-ficticio-del-proveedor",
  "phoneInternational": "+50255555555",
  "messageType": "text",
  "text": "Mensaje ficticio de una persona candidata"
}
```

La bandeja de entrada envía además enlaces (`/v1/sendLink`), ubicaciones (`/v1/sendLocation`), archivos por URL HTTPS (`/v1/sendFile`), notas de voz por URL HTTPS (`/v1/sendPTT`) y puede eliminar mensajes del proveedor (`/v1/deleteMessage`). Cada operación conserva el control humano, la persistencia previa, los estados de entrega, la auditoría y la observabilidad del envío de texto.

Si no existe una conversación activa, el receptor responde `202` y conserva solo las huellas de cuarentena. Si encuentra más de una, responde `409`: la ambigüedad no se trata como recepción exitosa, pero el contenido tampoco es recuperable desde la cuarentena minimizada. La operación debe corregir la duplicidad antes del reintento.

ApiChat publica, según su OpenAPI nativo, un objeto `messages` cuyos elementos incluyen `id`, `number`, `type`, `from_me` y, para texto, `text`. `04_whatsapp_apichat.json` expone `POST /webhook/apichat/incoming`, sincroniza mensajes entrantes y salientes (`direction`), ignora grupos y medios sin pipeline, convierte el teléfono al formato E.164 y conserva el identificador original. Luego entrega el contrato anterior al backend mediante una credencial Header Auth llamada «Cabecera interna Talento AISA».

Después de importar el workflow, configure esa credencial con encabezado `Authorization` y valor `Bearer <mismo secreto guardado en la UI>`, active el workflow y registre su URL de producción en ApiChat. No introduzca el Bearer ni las credenciales ApiChat dentro del JSON versionado. El artefacto usa respuesta posterior al último nodo y desactiva la conservación de ejecuciones correctas, erróneas, manuales y de progreso en n8n; por ello el acuse sigue la respuesta del backend. El proxy de n8n debe aplicar HTTPS, límite de cuerpo y rate limiting; la frontera pública del proveedor no incluye por sí misma el Bearer interno.

La recepción de audio, PDF, Word y otros medios **no está conectada** en esta versión: existen tablas y cuotas preparatorias, pero faltan descarga autenticada, detección de tipo por contenido, análisis antimalware, bucket, retención y visualización.

## Controles de seguridad

- Solo `adminProcedure` puede leer estados enmascarados, modificar o verificar la integración.
- Las claves permitidas se definen mediante listas cerradas; la ruta genérica de configuración no acepta ApiChat ni secretos.
- Un valor histórico sin el prefijo cifrado se rechaza y debe rotarse desde la interfaz.
- El endpoint nativo exige HTTPS, el dominio oficial y la ruta `/v1/sendText`.
- La bitácora conserva la acción y el nombre de la clave, nunca su valor.
- Un Bearer ausente o incorrecto falla cerrado; los errores no imprimen el cuerpo entrante.
- La recepción revalida el texto contra `GET /v1/messages` antes de resolver o persistir; esta comprobación no sustituye firma, ventana anti-replay ni rate limiting.
- La deduplicación documentada corresponde al ingreso por `providerMessageId`; la salida requiere reconciliación manual cuando su resultado es desconocido.
- Las pruebas usan credenciales ficticias y transporte simulado; no realizan envíos reales.

Antes de retirar `APICHAT_*` de EasyPanel, compruebe un envío saliente, una verificación y una recepción normalizada con datos ficticios. En la recepción, confirme los resultados `201/200`, `202`, `409`, `422` y `500` aplicables, el acuse posterior a la respuesta del backend y la ausencia de payloads en el historial de n8n. Conserve respaldo y ventana de reversión; la eliminación de variables se realiza solo después de confirmar que todas las rutas leen PostgreSQL.

Fuentes del contrato: [documentación oficial de ApiChat](https://apichat.io/api-docs) y [OpenAPI/Swagger oficial](https://panel.apichat.io/docs/swagger).
