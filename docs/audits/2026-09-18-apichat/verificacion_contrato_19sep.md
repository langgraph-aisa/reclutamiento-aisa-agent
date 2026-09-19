# Verificación del contrato oficial y cierre de la cadena causal

**Fecha:** 19 de septiembre de 2026.
**Objeto:** autenticar la fuente primaria que gobierna el transporte del adjunto y resolver, con ella y con los datos de la instancia, por qué el PDF no entra al expediente.
**Método:** descarga directa de la especificación oficial y contraste de su huella con la registrada en `manifiesto.json`; lectura de los esquemas del adjunto; cruce con las trazas, los asientos de recepción y el historial del proveedor.

---

## 1. Fuente primaria autenticada

```bash
curl -sS -o aisa-openapi-verify.yaml "https://panel.apichat.io/openapi.yaml?version=1.7"
sha256sum aisa-openapi-verify.yaml
```

| Comprobación | Resultado |
| --- | --- |
| Respuesta | `http=200` |
| Peso | `51022` bytes |
| SHA-256 obtenido | `eb487f5bb20300298fbfe53e39b9d36589e1bf3a76335534c7efb5729c33c68d` |
| SHA-256 registrado el 18 SEP | `eb487f5bb20300298fbfe53e39b9d36589e1bf3a76335534c7efb5729c33c68d` |
| Veredicto | **Idéntico.** El contrato no cambió entre el 18 y el 19 de septiembre |

El documento declara `openapi: 3.0.0`, `info.version: 1.0.0` y servidor base `https://api.apichat.io/v1`. La copia de sesión es temporal y **no se incorpora al repositorio** —es material de terceros—; lo que se conserva es su huella y las líneas citadas, que es lo que permite volver a contrastarla.

## 2. Lo que el contrato declara sobre el adjunto

**`MediaBase`, líneas 828–835** — el campo del medio, y el único obligatorio:

```yaml
MediaBase:
  type: object
  required:
    - url
  properties:
    url:
      type: string
      description: URL for media content or base64-encoded file with mime data.
```

**`ReceiveFile`, 1173–1187** · **`ReceiveAudio`, 1164–1172** · **`ReceiveImage`, 1188–1198** — los tres heredan de `ReceiveMedia` y por tanto de `MediaBase`. Sus ejemplos de `url` son inequívocos:

| Esquema | Ejemplo contractual de `url` |
| --- | --- |
| `ReceiveFile` | `{url}/media/{clientId}/file.pdf` |
| `ReceiveAudio` | `{url}/media/{clientId}/audio.ogg` |
| `ReceiveImage` | `{url}/media/{clientId}/image.png` (con `caption` obligatorio) |

**`MessageDB`, 973 y siguientes** — el registro del historial: `{message, external_id, from_me, sent_date, delivered_date, read_date, …}`, donde `message` es el mismo esquema `Message` del callback. Confirma que el medio viaja **dentro de `message`**, que es exactamente la ruta que el adaptador vigente desciende.

**`events`, 1019–1021 y 1776–1778** — el sobre de eventos («Notification for different events») está documentado como una notificación **distinta** de la de mensajes.

## 3. El hallazgo: el proveedor entrega el descriptor sin la carga

Las trazas de la instancia, ya con la versión 2.0.185 desplegada, registran el cuerpo del mensaje del PDF así:

```text
19/09/2026, 9:00 a. m. · webhook · aceptado-durable · 344 bytes
  messages[0].id       texto 32
  messages[0].name     texto 12
  messages[0].url      contenido:73415797282c5429321573c46ba8b9bb7d1c645ad39d44ca3d2ff5…
  messages[0].type     texto 5
  messages[0].time     number
  messages[0].author   texto 11
```

El razonamiento es aritmético y no admite interpretación:

1. **El cuerpo entero pesa 344 bytes.** Una carga útil de PDF codificada en base64 no cabe en 344 bytes: un PDF de un megabyte ocupa 1,37 MB codificado.
2. **`messages[0].url` mide 27 caracteres.** El instrumento clasifica como contenido toda cadena que empiece por `data:`, y `data:application/pdf;base64` tiene exactamente 27 caracteres.
3. Por tanto **`url` vale `data:application/pdf;base64` — el sobre sin los datos**—, y ningún otro campo del cuerpo supera los 344 bytes.

**Hipótesis refutada:** «la carga viaja en otro campo y no lo leemos». La traza enumera **todos** los campos del cuerpo y ninguno lleva peso. Un campo con la carga mostraría su medida junto a su tipo. Queda refutada por la propia traza, no por ausencia de evidencia.

**Hipótesis vigente y única:** el proveedor, con la notificación en base64 activada, entrega el descriptor del medio sin el contenido codificado — ni en el callback ni en el registro del historial, donde la columna «Message» muestra esa misma cadena de 27 caracteres.

## 4. Conciliación con los asientos de recepción

Los recibos de la misma marca horaria lo confirman eslabón por eslabón:

| Estado | Desenlace | Intentos | `last_error` | Lectura |
| --- | --- | --- | --- | --- |
| `completed` | `registrado` | 1 | — | El texto «Pdf» que acompañaba al archivo |
| `retry` | — | 3, 4 | **`Error`** | El archivo: el decodificador rechaza el sobre sin datos |
| `retry` | — | 1 | `Error` | Las imágenes, mismo motivo |
| `dead` | — | 8 | `Error` | Agotó los reintentos: la ventana de veintiún minutos |
| `rejected` | `forma-no-reconocida` | 0 | — | El sobre `events[]` |

La cadena queda cerrada sin residuo:

```text
El contrato exige en `url` una URL de medios O un archivo codificado en base64 con datos.
El proveedor envía `data:application/pdf;base64`, que no es ni una cosa ni la otra.
`decodeTransport` responde «El contenido recibido no es una codificación base64 válida».
Esa excepción no es del transporte, así que el asiento sólo conserva `Error`.
Tras ocho intentos el recibo queda en `dead` y el expediente sin documento.
```

## 5. Correcciones ontológicas y epistemológicas

El defecto de fondo es de **vocabulario**: cuatro estados epistémicos distintos colapsan en uno solo, y con ellos se pierde la capacidad de decidir.

| Estado real | Lo que el artefacto dice hoy | Lo que debería decir |
| --- | --- | --- |
| El proveedor entregó un descriptor **sin carga** | `Error` | `payload_absent` — la carga no llegó |
| El proveedor entregó carga que el códec no resuelve | `content_unresolved` | (ya corregido en 2.0.184) |
| El proveedor entregó una URL que la guarda rechaza | `unsafe_destination` | (ya tipado) |
| Llegó una notificación que **no es un mensaje** | `forma-no-reconocida` | `notificacion-sin-mensaje` |

Las dos primeras son la misma pérdida vista desde dos causas distintas; confundirlas impide saber si hay que reclamar al proveedor o corregir el decodificador. Las dos últimas son simétricas: una reduce el ruido de las notificaciones legítimas, la otra evita contar como rechazo lo que nunca fue un mensaje.

**Regla epistémica que este caso deja:** *una huella de contenido no acredita bytes.* El instrumento hizo bien su trabajo —registró que el campo `url` *parecía* contenido— y precisamente por eso el asiento de recepción tiene que declarar lo que ocurrió después. Registrar la forma sin registrar el desenlace deja el diagnóstico a medias.

## 6. Plan de acción

| Orden | Acción | Quién | Evidencia de cierre |
| --- | --- | --- | --- |
| 1 | **Desactivar la notificación en base64** en el panel del proveedor y enviar un PDF | Operación | La traza debe mostrar `messages[0].url` con una dirección `https://…/media/…` — el ejemplo contractual — y el recibo en `completed` |
| 2 | **Nombrar la causa ausente**: tipar el fallo del decodificador con código propio (`payload_absent`) en lugar de `Error` | Artefacto | El asiento declara el código y su naturaleza |
| 3 | **Clasificar el sobre `events[]`** como notificación sin mensaje, no como rechazo | Artefacto | El contador de rechazos deja de contar eventos de estado |
| 4 | **Reclamar al proveedor** con la referencia contractual: `MediaBase.url`, líneas 833–835, frente a un cuerpo de 344 bytes | Auditoría | Respuesta del proveedor o corrección de su modo base64 |
| 5 | **Recuperar los adjuntos del 18 y 19 de septiembre** cuando 1 o 2 cierren | Operación | Expediente con los documentos y su texto extraído |

El paso 1 es el que desbloquea a la empresa y no depende de nosotros: si el proveedor entrega la dirección de medios que su propio contrato documenta, el artefacto ya sabe descargarla con validación de destino, ventana de dos minutos y huella de integridad.

## 7. Fuentes y límites

**Primaria:** `https://panel.apichat.io/openapi.yaml?version=1.7`, recuperada el 19 de septiembre de 2026, 51 022 bytes, SHA-256 `eb487f5b…c68d`, idéntica a la del 18 de septiembre. Es la fuente exclusiva para atribuir capacidades a **su** API.

**Secundarias:** historial de mensajes del panel del proveedor (últimos 100, teléfono `50230939134`); trazas del conducto, asientos de recepción y manifiesto de la instancia `hiring-testing`; expediente de auditoría del 18 de septiembre.

**Límite declarado:** este entorno **no permite consultar foros ni comunidades**. Lo que se puede autenticar es el contrato oficial y el comportamiento observado de la instancia; para una discusión comunitaria habría que aportar las direcciones y se recuperarían una por una, con su huella. No se presenta ninguna afirmación de foro como evidencia.
