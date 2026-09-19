# Análisis epistemológico, ontológico y fenomenológico del transporte de adjuntos

**Objeto:** determinar por qué el PDF que el cliente envía desde su WhatsApp no llega a la
bandeja de entrada del reclutador, y alinear el artefacto a las mejores prácticas
documentadas, después de que la entrega **17 SEP 2026 · JARVI RH 2.0.186** no resolviera el
fenómeno.

**Árbol vigente:** `2.0.186` (`package.json`). **Instancia observada:** despliegue del cliente con
el proveedor ApiChat, cuenta del panel de mensajería.
**Naturaleza:** documento de estudio. Distingue lo **demostrado** de lo **pendiente** y no
certifica el despliegue. No sustituye la auditoría de campo de
[`audits/2026-09-18-apichat/`](audits/2026-09-18-apichat/), que este documento continúa.

---

## 1. Método y fuentes primarias

| Fuente | Naturaleza | Verificación |
| --- | --- | --- |
| `https://panel.apichat.io/openapi.yaml?version=1.7` | Contrato normativo del proveedor | `http=200`, 51 022 bytes, SHA-256 `eb487f5bb20300298fbfe53e39b9d36589e1bf3a76335534c7efb5729c33c68d`; `openapi: 3.0.0`, `info.version: 1.0.0`, base `https://api.apichat.io/v1` |
| Panel del proveedor (captura 19/09/2026) | Declaración de la configuración efectiva | Historial «Last 100»: filas `file`, `image`, `audio` del teléfono `50230939134` con `Message = data:application/pdf;base64`; opción *Notify attachments in base64 format* **activada** |
| `conversation_transport_traces` de la instancia | Observación del cuerpo recibido | Traza del 19/09/2026 9:00 a. m. · `webhook` · `aceptado-durable` · **344 bytes** |
| `apichat_inbound_receipts` de la instancia | Asiento del desenlace | `completed/registrado` (texto), `retry` ×3/×4 y `dead` ×8 con `last_error = Error` (archivos e imágenes) |
| Código del árbol vigente | Implementación | Anclas citadas por archivo y línea en cada hallazgo |

Regla de lectura que gobierna todo el documento: **la afirmación no es evidencia**. El nombre de
archivo, el MIME declarado y la forma del sobre son *testimonio*; la carga decodificada, su peso y
su huella son *evidencia*. Esta frontera, ya declarada por el propio artefacto en
[`ANALISIS_TRANSPORTE_BASE64_VISOR.md`](ANALISIS_TRANSPORTE_BASE64_VISOR.md) §3.1, es la que el
caso pone a prueba.

---

## 2. Fenomenología: qué se observa, antes de toda teoría

El fenómeno, descrito sin interpretación:

1. **En el teléfono del cliente** (captura de la conversación de WhatsApp): el PDF sale, se
   muestra como enviado y el destinatario responde.
2. **En el panel del proveedor**: el historial registra filas `file` para el teléfono del cliente,
   con la columna `Message` que exhibe exactamente `data:application/pdf;base64`, y una dirección
   `from_me` que las marca como **entrantes**. El proveedor entregó.
3. **En la traza del artefacto** (ya con 2.0.185 desplegada): el cuerpo recibido pesa **344 bytes**
   y su descenso enumera `messages[0].id` (32), `messages[0].name` (12), `messages[0].url`
   (**27 caracteres**), `messages[0].type`, `messages[0].time`, `messages[0].author` (11).
4. **Aritmética decisiva:** `data:application/pdf;base64` mide exactamente 27 caracteres, y una
   carga útil de PDF no cabe en 344 bytes —un PDF de un megabyte ocupa 1,37 MB codificado—. Los
   tres datos independientes (panel, traza y cuerda base64) coinciden: **el proveedor entrega el
   descriptor del medio sin la carga**.
5. **En la bandeja del reclutador**: aparece el texto que acompañaba al archivo («Pdf»,
   «Imágenes», «Ok») y **no aparece ningún documento**. El agente conversacional vuelve a pedir el
   CV.
6. **En la cola de recepción**: los asientos del archivo y de las imágenes agotan sus intentos y
   quedan en `dead`, con `last_error = Error`.

Lo fenomenológicamente relevante es el **contraste 5–6**: la bandeja no muestra nada, mientras la
cola muestra una pérdida con nombre. La ausencia percibida por el reclutador es *opaca*; la
ausencia registrada por el sistema es *tipada*. Entre ambas media una frontera que este documento
denomina el **corte de observabilidad**.

---

## 3. Ontología: las cuatro representaciones del adjunto

Un archivo del candidato no es una cosa, sino una cadena de cuatro objetos distintos, con
identidad propia cada uno. La pérdida ocurre cuando dos de ellos se confunden.

| # | Representación | Qué es | Dónde vive | Qué la prueba |
| --- | --- | --- | --- | --- |
| R1 | **Descriptor** | La afirmación del medio: `url` con su tipo declarado | Notificación del proveedor | La forma del cuerpo (traza) |
| R2 | **Carga** | Los bytes codificados, o la dirección de la que se descargan | Cuerpo de la notificación o servidor de medios | `sha256` y peso de los bytes |
| R3 | **Mensaje** | La fila de la conversación con su metadata `media` | `conversation_messages` | `inbox.detail` |
| R4 | **Documento** | La entrada del expediente con su estado de análisis | `candidate_knowledge_files` | El manifiesto único |

El contrato del proveedor, leído en su fuente, sostiene una ontología precisa:

- **`MediaBase` (líneas 828–835)** declara `url` como **obligatorio** y lo describe así: *«URL for
  media content **or** base64-encoded file with mime data»*. Es decir: o una dirección de la que
  se descarga, o una codificación **con datos**.
- **`ReceiveFile` (1173–1187)**, **`ReceiveAudio` (1164–1172)** y **`ReceiveImage` (1188–1198)**
  ofrecen el ejemplo inequívoco de la primera forma: `{url}/media/{clientId}/file.pdf`,
  `…/audio.ogg`, `…/image.png`. **No existe ningún endpoint de descarga de medios** en el
  contrato: o el contenido viene en el cuerpo, o viene una dirección descargable.
- **`MessageDB` (973 y ss.)** define el registro del historial como
  `{message, external_id, from_me, sent_date, delivered_date, read_date, …}` donde `message` es
  **el mismo esquema `Message` del callback**. Webhook y sondeo comparten forma; el adaptador debe
  aceptar ambas.
- **`events` (1019–1021, 1776–1778)** es una notificación **distinta** de la de mensajes.
- **`AccountUpdate` (1312–1356)** notifica cambios de configuración de la cuenta: es la vía por la
  que el artefacto puede **conocer** la configuración efectiva en lugar de presuponerla.

La consecuencia ontológica es taxativa: con la notificación en base64 activada, el proveedor
entrega un `url` que **no es ninguna de las dos formas declaradas** —no es una dirección
descargable y no es una codificación con datos—. El artefacto lo observa con exactitud; lo que
falta es que **declare el hecho con el vocabulario del contrato**.

### 3.1 El colapso del vocabulario

El defecto de fondo no es la pérdida: es que **cuatro estados epistémicos distintos colapsan en una
sola palabra**, y con ella se pierde la capacidad de decidir.

| Estado real | Lo que el asiento decía hasta 2.0.184 | Lo que debe decir |
| --- | --- | --- |
| Llegó un descriptor **sin carga** | `Error` | `payload_absent` — la carga no llegó: se reclama al proveedor o se corrige su configuración |
| Llegó carga que el códec no resuelve | `Error` | `content_unresolved` / `payload_invalid` — se corrige el decodificador |
| Llegó una dirección que la guarda rechaza | `unsafe_destination` | (ya tipado) |
| Llegó una notificación que **no es un mensaje** | `forma-no-reconocida` (contada como rechazo) | `notificacion-sin-mensaje` |
| La asociación teléfono–conversación es ambigua | `Error` | `destinatario-ambiguo` con su causa |

La entrega 2.0.184 parcial y 2.0.186 completó tres de estas filas: `server/base64Transport.ts`
(anchas 383–385, 712–731) introduce `payload_missing` y `payload_invalid`;
`server/apiChatReceipts.ts` (36–46) introduce `receiptFailureReason` y `ReceptionError`. **Ese es,
exactamente, el progreso que la 2.0.186 aportó: nombrar mejor.** No podía aportar la carga, porque
la carga no está en el cuerpo.

---

## 4. Epistemología: por qué la 2.0.186 no podía resolverlo, y por qué la prueba lo ocultaba

### 4.1 El límite es de aplicabilidad, no de código

La cadena causal quedó demostrada en dos tramos:

| Tramo | Versión | Causa | Estado |
| --- | --- | --- | --- |
| A | 2.0.179 (instancia del incidente) | El sondeo sólo atendía `text`, `link`, `location` y `file` con `url`; `image`, `audio`, `video`, `document` no tenían rama y se descartaban sin asiento | **Reparado en 2.0.180** |
| B | 2.0.180–2.0.186 (instancia actual) | El proveedor entrega el **descriptor sin la carga**; ningún campo del cuerpo lleva peso | **No es reparable en el código: falta el dato** |

El tramo B es el residuo. La 2.0.186 hizo decidible el reproceso y tipó el motivo
(`payload_missing:permanente`), de modo que el recibo **ya no queda con desenlace vacío**. Pero
nombrar la ausencia no la suple: mientras el proveedor no entregue la carga, **el artefacto no
puede recibirla**. La palanca que falta **no está dentro del artefacto**.

### 4.2 La circularidad de la prueba

Aquí está el hallazgo epistemológico central de esta auditoría:

- La caja negra del propio repositorio construye su fixture en
  `server/attachments.blackbox.test.ts:41` con las claves **`number`, `filename`, `text` y
  `url` = `data:application/pdf;base64,<carga>`** — es decir, con el **vocabulario que el
  adaptador espera** y con una **carga presente**.
- El cuerpo observado en producción exhibe otras claves —`author`, `name`, `time`— y un `url`
  **sin carga**.
- El vocabulario declarado en `server/apiChatContract.ts:23-27` (`contentFields`) **no incluye
  `message` ni `author`**; el cuerpo observado sí los trae.

Consecuencia: **la prueba certificaba la hipótesis del adaptador, no el hecho del proveedor.** El
fixture se derivó del propio código (= testimonio) en lugar de los ejemplos del contrato
(= fuente primaria). Una prueba construida así es coherente consigo misma y **por construcción no
puede descubrir la divergencia de vocabulario**. Es la misma inversión epistémica que el
`ANALISIS_TRANSPORTE_BASE64_VISOR.md` §2.2 (causa T1–T4) identificó para el transporte, ahora
reproducida en la capa de contrato.

**Regla que este caso deja:** *una huella de contenido no acredita bytes, y un fixture propio no
acredita contrato.* Toda prueba de frontera externa debe derivarse de los ejemplos de la fuente
primaria, o declarar expresamente que sólo prueba la coherencia interna.

### 4.3 El corte de observabilidad

Segundo hallazgo, éste de diseño, con ancla exacta en el código:

```text
server/apiChatWebhook.ts · rama de adjunto
  source = message.contentValue ?? message.url
  si NO hay source      → recordFile(processingOutcome:"rejected", reason:"contenido_no_disponible")
                          ⇒ la bandeja ve un adjunto rechazado con motivo
  si hay source y decodifica → sigue el conducto
  si hay source y NO decodifica → decodeRemoteAttachment LANZA
                          ⇒ no se escribe ninguna fila en conversation_messages
                          ⇒ el recibo queda en retry/dead y la bandeja NO muestra nada
```

Es una asimetría epistémica pura: **la ausencia total de contenido deja asiento en la bandeja; el
contenido presente pero irresoluble no deja ninguno.** El reclutador, que sólo mira la bandeja, ve
silencio; el auditor, que mira la cola, ve `dead`. Dos observadores del mismo hecho, dos mundos
distintos — que es la definición operativa de *corte de observabilidad*.

El propio artefacto declaró la invariante opuesta en 2.0.170: «toda pérdida de archivo queda
asentada con su causa». La invariante se cumple en la cola y **no** en la bandeja.

### 4.4 Riesgos residuales que el análisis del código descubre

| Riesgo | Ancla | Efecto observable |
| --- | --- | --- |
| Guarda de identidad ambigua sin tipo | `server/inbox.ts` · `recordNormalizedInboundEventInternal`: si no hay **exactamente una** coincidencia teléfono–conversación lanza `Error` genérico | Con dos conversaciones activas históricas para el mismo teléfono, **todo** mensaje muere como `Error` tras ocho intentos, sin causa legible |
| `payload_absent` no distinguido de `payload_missing` | `server/base64Transport.ts` 712–731 | El operador no sabe si debe reclamar al proveedor o corregir el decodificador |
| Sobre `events[]` contado como rechazo | `server/apiChatContract.ts` 104–118 | El contador de rechazos mezcla notificaciones de estado con pérdidas reales (H17, abierto) |
| Diagnóstico de solo lectura | `server/attachmentPipeline.ts:34` | No hay operación que devuelva un recibo `dead` a la cola: el reproceso exige SQL manual (H21, abierto) |
| Migraciones 0035–0037 fuera del diario de Drizzle | `drizzle/migrations/` termina en `0014` | La instalación documentada no crea el conducto; si falta `apichat_inbound_receipts`, **la instancia no puede recibir nada, sea cual sea su versión** (H23, abierto) |

---

## 5. Contraste con las mejores prácticas documentadas

| Práctica documentada | Fuente | Qué exige | Estado en el artefacto |
| --- | --- | --- | --- |
| El medio se anuncia en `url` como dirección **o** como base64 **con datos** | `MediaBase`, 828–835 | Ninguna otra forma es contractual | El artefacto acepta la forma y **la declara ausente** cuando falta la carga (2.0.186) |
| No presuponer servicio de descarga no declarado | `ReceiveFile` 1173–1187 | La única vía es la dirección del ejemplo o el cuerpo | Cumplido: la descarga usa exactamente el `url` recibido |
| Base64 sin datos no es una carga | RFC 4648 §4 | Una codificación transporta bytes; el alfabeto vacío no los transporta | Cumplido en el decodificador; **pendiente** nombrarlo con la voz del contrato |
| Webhook y sondeo comparten forma (`MessageDB.message`) | `MessageDB` 973 y ss. | Un solo adaptador para ambas vías | Cumplido: `enqueueApiChatReceipts` es el único punto |
| Notificaciones de cuenta y de eventos son cosas distintas de los mensajes | `events` 1019–1021 / 1776–1778 | No contarlas como pérdida | **Pendiente** (H17) |
| Autenticar la fuente antes de citarla | Procedencia y no repudio | Huella y fecha del contrato | Cumplido en la auditoría; **no** en los fixtures de prueba |
| Conservar la evidencia del incidente | NIST SP 800-86 | Preservar forma y desenlace, minimizando contenido | Cumplido: `conversation_transport_traces` con retención declarada y sin contenido del candidato |
| Observabilidad con causa tipada | ISO/IEC 27001:2022 · registro de eventos | Un fallo sin causa legible no es auditable | Parcial: cola tipada, **bandeja opaca** (§4.3) |
| Recuperación sin recolección nueva | NIST SP 800-86 · ISO/IEC 25010:2023 · capacidad de recuperación | Lo recibido y no convertido debe poder reprocesarse | **Pendiente** (H21) |

---

## 6. Soluciones

Cinco soluciones, ordenadas por dependencia. La primera es la única que **devuelve la carga**; las
demás hacen que el artefacto no vuelva a confundir el descriptor con la carga. Cada una declara su
fuente, su alcance y su observable de cierre.

### S1 · Operativa — la palanca que estaba fuera del artefacto

**Fundamento (fuente primaria).** `MediaBase` declara dos formas de `url` y el ejemplo de
`ReceiveFile` es una dirección de medios (`{url}/media/{clientId}/file.pdf`). La notificación en
base64 activada produce una tercera forma que el contrato no declara: **el descriptor sin carga**.
El artefacto ya la clasifica como permanente (`payload_missing`), y ninguna versión futura podrá
recuperar un dato que nunca llegó en el cuerpo.

**Intervención.** Desactivar *Notify attachments in base64 format* en el panel del proveedor y
dejar que `url` vuelva a ser la dirección de medios contractual. La descarga la ejecuta el
artefacto con guarda de destino (`resolveAttachmentDestination`), lista de red pública, límite de
30 MB y ventana de dos minutos —`server/base64Transport.ts`: `downloadAttachment`, con
redirecciones acotadas, `size_limit`, `empty_content`, `http_error` y `network_error` tipados—.

**Observable de cierre (30 minutos después de enviar un PDF real):**

```sql
SELECT t.created_at, t.provider_type,
       campo.key AS ruta, campo.value->>'kind' AS tipo,
       (campo.value->>'bytes')::bigint AS bytes
  FROM conversation_transport_traces t
  CROSS JOIN LATERAL jsonb_each(COALESCE(t.shape,'{}'::jsonb)) AS campo(key,value)
 WHERE t.created_at >= now() - interval '30 minutes'
   AND campo.key LIKE '%url'
 ORDER BY t.created_at DESC;
-- Cierre: `tipo` = `texto` y `bytes` >> 27 (una dirección https), o bien `contenido:<sha256>`
-- con `bytes` del orden de la carga. Y el recibo en `completed / registrado`.
```

**Reversión.** Volver a activar la opción; el artefacto vuelve a declarar `payload_missing`, sin
pérdida de datos ni migración.

**Cautela honesta.** Si la historia del proveedor almacena el descriptor sin carga para las filas
del 18 y 19 de septiembre, esos archivos **no son recuperables retroactivamente**: la recuperación
de lo ya perdido es probable, no cierta, y se comprueba con el paso de S5.

### S2 · Artefacto — reconstrucción acotada de la dirección contractual, como hipótesis refutable

**Fundamento (fuente primaria).** El ejemplo contractual de `ReceiveFile` establece la forma de la
dirección de medios: `{base}/media/{clientId}/{nombre}`. El cuerpo observado trae `clientId`
implícito en la configuración, `name` y el `id` del mensaje. Es una **hipótesis**, no un hecho: la
auditoría de este repositorio ya refutó una hipótesis previa («la carga viaja en otro campo») con
aritmética de bytes, y aquí no procede afirmar sin medir.

**Intervención.** Cuando `url` sea un descriptor `data:<mime>;base64` **sin carga**, y sólo si el
operador ha declarado expresamente una base de medios en `Configuración › WhatsApp`, intentar una
**única** petición a la dirección derivada, sujeta a: lista de hosts permitidos, guarda de red
pública, límite de peso y una sola tentativa —nunca reintentos—. Si falla, se conserva la
clasificación `payload_absent` y no se altera nada más. El intento queda en `audit_log` con su
resultado, sin conservar contenido.

**Observable de cierre.** El asiento declara la tentativa y su desenlace (`media_probe:ok` /
`media_probe:404`). Éxito ⇒ mensaje y documento en la bandeja; fracaso ⇒ prueba legítima de que la
dirección no es reconstruible y **retiro definitivo de la hipótesis**.

**Valor de la solución.** Convierte una conjetura en una medición de costo mínimo, que es el método
que este proyecto ya aplica (`verificacion_contrato_19sep.md` §3).

### S3 · Artefacto — conformidad de vocabulario derivada de la fuente primaria

**Fundamento (fuente primaria).** `MessageDB` declara que el registro del historial contiene
`message` como envoltura **del mismo esquema** que el callback; el cuerpo observado usa `author` y
`name`; `server/apiChatContract.ts:23-27` no incluye `message` ni `author` entre los campos de
contenido. La divergencia entre el vocabulario del adaptador y el vocabulario del proveedor es un
hecho medido, no una suposición.

**Intervención.**

1. Ampliar el vocabulario declarado del adaptador con las claves observadas y las del contrato
   (`message` como envoltura de `MessageDB`, `author`, `name`, `external_id`, `sent_date`), **sin**
   abandonar las actuales: la aceptación de alias es compatibilidad, no laxitud, siempre que cada
   alias quede declarado y probado.
2. Sustituir los fixtures auto-referenciales por **fixtures de conformidad transcritos de los
   ejemplos del contrato** (`ReceiveFile`, `ReceiveAudio`, `ReceiveImage`, `MessageDB`,
   `callbacks.Messages`, `events`) en un archivo nuevo, conservando la caja negra actual para la
   coherencia interna. La huella del contrato (`eb487f…`) queda anotada en el encabezado de la
   prueba, de modo que una divergencia futura del proveedor sea datable.
3. Añadir a la prueba el caso negativo que hoy falta: **descriptor `data:<mime>;base64` sin carga**
   ⇒ `payload_absent:permanente`, con la fila de bandeja correspondiente (enlaza con S4).

**Observable de cierre.** La suite nueva pasa con los ejemplos del contrato y falla si se restaura
el vocabulario exclusivo del adaptador.

### S4 · Artefacto — simetría de la evidencia en la bandeja

**Fundamento.** La invariante que el artefacto ya declaró en 2.0.170 —«toda pérdida de archivo
queda asentada con su causa»— se cumple en la cola y no en la bandeja (§4.3). Un estado sin
observación no es un estado conocido; y aquí el observador afectado —el reclutador— es justamente
el que no ve nada.

**Intervención.** Envolver la decodificación de la rama de adjunto de modo que **toda** pérdida
—ausencia, carga irresoluble, destino inseguro, peso excedido, tiempo agotado— escriba la misma
clase de asiento: una fila en `conversation_messages` con `processingOutcome = 'rejected'` y el
motivo tipado, además del desenlace del recibo. Se distinguen los dos códigos que hoy colapsan:
`payload_absent` (el proveedor no entregó la carga) y `payload_invalid` (la entregó irresoluble).

**Observable de cierre.** Reproducir el caso real —un `url` igual a `data:application/pdf;base64`
sin carga— y comprobar que `inbox.detail` **muestra el adjunto rechazado con su motivo**, en lugar
de silencio. Es exactamente la prueba que la caja negra actual no tiene.

### S5 · Operación y gobernanza — reproceso, rebobinado y cierre de brechas

**Fundamento.** NIST SP 800-86 (conservación y recuperación de la evidencia) y ISO/IEC 25010:2023
(capacidad de recuperación): lo recibido y no convertido debe poder reprocesarse sin exigir al
candidato una acción nueva.

**Intervención.**

1. **Reproceso administrado** (H21): operación que devuelve a la cola los recibos `dead` de una
   ventana declarada, con presupuesto de intentos y asiento de auditoría. Hoy el diagnóstico es
   sólo lectura (`server/attachmentPipeline.ts:34`) y el reproceso exige SQL manual.
2. **Rebobinado del cursor histórico**: `apichat_history_cursors.page = 0`, `updated_at = 'epoch'`,
   para que el sondeo vuelva a recorrer el historial y resuelva lo que nunca se convirtió en
   mensaje —la deduplicación por `providerMessageId` y la clave determinista de almacenamiento
   hacen que la repetición sea inocua—.
3. **Cierre de H17**: el informe del conducto debe contar los rechazos de ingreso por política
   (`extension_not_allowed`) y las notificaciones que no son mensajes, en lugar de declarar «sin
   pendientes».
4. **Cierre de H23**: registrar 0035–0037 en el diario de Drizzle y declarar
   `conversation_transport_traces` en `drizzle/schema.ts`, para que `db:push` no pueda borrar la
   traza forense ni omitir el conducto.
5. **Tipar la guarda de identidad** (§4.4, primera fila): `destinatario-ambiguo` con su causa, en
   lugar de `Error` genérico con ocho intentos.

**Observables de cierre.**

```sql
-- ¿Cuántas conversaciones activas por teléfono? (la guarda exige exactamente una)
SELECT c.phone_international, count(*) AS activas
  FROM candidates c
  JOIN applications a ON a.candidate_id=c.id
  JOIN conversations conv ON conv.application_id=a.id
 WHERE conv.provider='apichat' AND conv.status IN ('pendiente','activo')
 GROUP BY 1 HAVING count(*) > 1;

-- Cursor del sondeo y recibos agotados con su motivo
SELECT scope,page,updated_at FROM apichat_history_cursors;
SELECT outcome,count(*) FROM apichat_inbound_receipts
 WHERE status='dead' AND received_at >= now() - interval '72 hours' GROUP BY 1;
```

---

## 7. Plan de verificación (una sola sesión, sin adivinar)

| Orden | Acción | Observable | Cierra |
| --- | --- | --- | --- |
| 1 | Confirmar que las tres tablas del conducto existen | `to_regclass` no nulo para `apichat_inbound_receipts`, `candidate_document_jobs`, `conversation_transport_traces` | H23 |
| 2 | Leer la política de extensiones vigente | `integration_settings` de `knowledge` admite `pdf, jpg, jpeg, png, webp, doc, docx` y los formatos de audio | Puerta 5 |
| 3 | Aplicar **S1** (desactivar base64) y enviar un PDF real desde el teléfono | Traza con `url` de tipo `texto` y peso >> 27; recibo `completed / registrado` | Tramo B |
| 4 | Consultar la traza descendida y los recibos | Causa tipada y no `Error`; documento con `analysis_status` distinto de nulo | §4.1 |
| 5 | Si el `url` sigue siendo descriptor sin carga, aplicar **S2** | `media_probe:ok` o refutación definitiva de la hipótesis | §6 S2 |
| 6 | Ejecutar el rebobinado del cursor | Los archivos del 18–19 de septiembre entran al expediente sin pedir reenvío | S5 |
| 7 | Inyectar el fixture de conformidad del contrato | La suite nueva falla con el vocabulario exclusivo y pasa con el declarado | S3 |

---

## 8. Límites declarados

1. Este análisis se apoya en la traza y los asientos ya registrados en la auditoría previa; **no ha
   ejecutado consultas contra la base de producción**.
2. La atribución de `author` y `name` a un significado concreto (teléfono, nombre de archivo o
   nombre de perfil) **no está demostrada**: la traza publica su tipo y su longitud, no su papel.
   El paso 4 del plan lo resuelve sin ambigüedad.
3. La reconstrucción de la dirección de medios de **S2** es una hipótesis derivada de un ejemplo
   contractual; se propone medirla, no adoptarla.
4. La recuperación de los archivos ya perdidos depende de lo que el proveedor conserve en su
   historia; puede resultar imposible y así debe declararse si se comprueba.
5. Nada de lo aquí expuesto certifica ISO/IEC 25010, ISO/IEC 27001, ISO/IEC 42001 ni DORA: las
   referencias son metodológicas.

---

## 9. Referencias (APA 7)

American Psychological Association. (2020). *Publication manual of the American Psychological
Association* (7.ª ed.).

ApiChat. (s. f.). *OpenAPI specification* (versión 1.7).
https://panel.apichat.io/openapi.yaml?version=1.7

International Electrotechnical Commission. (2023). *Systems and software engineering — Systems and
software Quality Requirements and Evaluation (SQuaRE) — Product quality model* (ISO/IEC 25010:2023).

International Organization for Standardization. (2022). *Information security, cybersecurity and
privacy protection — Information security management systems — Requirements* (ISO/IEC 27001:2022).

Josefsson, S. (2006). *The Base16, Base32, and Base64 data encodings* (RFC 4648). Internet
Engineering Task Force. https://www.rfc-editor.org/rfc/rfc4648

Kent, K., Chevalier, S., Grance, T., & Dang, H. (2006). *Guide to integrating forensic techniques
into incident response* (NIST SP 800-86). National Institute of Standards and Technology.
https://csrc.nist.gov/pubs/sp/800/86/final

---

## 10. Trazabilidad documental

| Documento | Relación |
| --- | --- |
| [`audits/2026-09-18-apichat/INFORME_HANDOFF_IA.md`](audits/2026-09-18-apichat/INFORME_HANDOFF_IA.md) | Identificación de la versión causante por firma de código y estado de hallazgos H01–H23 |
| [`audits/2026-09-18-apichat/verificacion_contrato_19sep.md`](audits/2026-09-18-apichat/verificacion_contrato_19sep.md) | Autenticación del contrato y cierre aritmético del tramo B |
| [`audits/2026-09-18-apichat/plan_puesta_en_vivo.md`](audits/2026-09-18-apichat/plan_puesta_en_vivo.md) | Las seis puertas de operación y la trampa de la política de extensiones |
| [`ANALISIS_TRANSPORTE_BASE64_VISOR.md`](ANALISIS_TRANSPORTE_BASE64_VISOR.md) | Marco epistemológico y ontológico del transporte; causas T1–T4 |
| [`RELEASE_GOVERNANCE.md`](RELEASE_GOVERNANCE.md) | Invariantes declaradas: acuse durable, sondeo sin descarte silencioso, adjunto resuelto en campos declarados |
