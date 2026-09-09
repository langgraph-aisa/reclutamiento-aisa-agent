# Envío directo de solicitud de CV por ApiChat

Talento AISA envía una sola solicitud de CV cuando una postulación cambia desde cualquier estado distinto de `calificado` hacia `calificado`. El flujo no utiliza n8n.

## Preparación de PostgreSQL

Ejecutar la migración `drizzle/migrations/0005_direct_apichat.sql` antes de desplegar el código. La columna `message_key` y su índice único garantizan una sola solicitud lógica por postulación. El identificador tiene la forma `cv_request:{applicationId}`.

## Variables de EasyPanel

Las variables pertenecen al servicio de Talento AISA, no al frontend y no al servicio n8n. Nunca deben llevar el prefijo `VITE_`.

### Contrato nativo de apichat.io

```dotenv
APICHAT_API_MODE=native
APICHAT_API_ENDPOINT=https://api.apichat.io/v1/sendText
APICHAT_CLIENT_ID=REEMPLAZAR_EN_EASYPANEL
APICHAT_TOKEN=REEMPLAZAR_EN_EASYPANEL
```

El backend envía los encabezados `client-id` y `token`, y el cuerpo `{ "number": "502...", "text": "..." }`.

### Contrato heredado documentado previamente

Utilizarlo únicamente si el proveedor confirma este contrato:

```dotenv
APICHAT_API_MODE=legacy
APICHAT_API_ENDPOINT=https://ENDPOINT_CONFIRMADO
APICHAT_ACCOUNT_ID=REEMPLAZAR_EN_EASYPANEL
APICHAT_CONNECT_TO=REEMPLAZAR_EN_EASYPANEL
APICHAT_TOKEN=REEMPLAZAR_EN_EASYPANEL
```

El backend envía autorización Bearer y el cuerpo `{ accountId, connectTo, to, message }`.

Después de modificar variables, guardar y volver a desplegar el servicio. No registrar valores secretos en capturas, tickets, pruebas o logs.

## Comportamiento operativo

1. El reclutador cambia el estado a `Calificado`.
2. PostgreSQL guarda el estado, la auditoría y el mensaje pendiente en una transacción.
3. Después del commit, el backend llama a ApiChat con un timeout de 15 segundos.
4. En éxito, guarda el identificador del proveedor y marca `whatsapp_status='enviado'`.
5. En error, conserva `Calificado`, marca `whatsapp_status='error'` y muestra el reintento manual.
6. Si ApiChat acepta la solicitud pero falla la confirmación local, marca el envío como `unknown` / `desconocido`, bloquea el reintento y pide verificar primero la conversación del postulante. Esto evita duplicados inciertos.
7. Guardar de nuevo el mismo estado no crea ni envía otro mensaje.

El reintento manual solo está disponible para postulaciones calificadas. Un mensaje ya marcado como enviado nunca se vuelve a despachar desde ese botón.

## Prueba de aceptación

1. Usar una plaza y teléfono controlados.
2. Cambiar de `En revisión` a `Calificado`.
3. Confirmar que el teléfono recibe el texto con nombre y plaza reales.
4. Confirmar en el detalle que WhatsApp aparece como enviado.
5. Guardar nuevamente `Calificado` y verificar que no llega un duplicado.
6. Probar credenciales inválidas, confirmar que el estado queda guardado y que aparece `Reintentar solicitud de CV`.
7. Restaurar la credencial y ejecutar el reintento una sola vez.

Solicitar el CV no descarga el archivo en Talento AISA. La recepción y almacenamiento de adjuntos requiere un webhook entrante independiente.
