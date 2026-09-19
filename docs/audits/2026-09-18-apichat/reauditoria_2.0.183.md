# Reauditoría del conducto de evidencia documental — JARVI RH 2.0.183

**Objeto:** transporte y consumo de PDF, Word y audio desde WhatsApp/ApiChat hasta la bandeja, el expediente del candidato y el motor de razonamiento de RR. HH.
**Fecha de corte:** 18 de septiembre de 2026.
**Software examinado:** JARVI RH 2.0.183, `main` en `715aee9` (árbol de trabajo limpio respecto de `origin/main`).
**Antecedente inmediato:** [informe.md](informe.md), que auditó 2.0.179 en `b450bdb` y formuló los hallazgos H01–H16.
**Naturaleza:** reauditoría de estado. Verifica cuáles de aquellos hallazgos siguen abiertos, ejecuta las puertas existentes contra PostgreSQL real y caracteriza el comportamiento vigente con las funciones reales. No es certificación del despliegue ni atribución del incidente.

---

## 1. Dictamen

**El veredicto de 2.0.179 ya no describe este código.** Entre `b450bdb` y `715aee9` median cuatro incrementos que reparan la mayor parte de H01–H16:

| Commit | Versión | Alcance |
| --- | --- | --- |
| `8888768` | 2.0.180 | Adaptador contractual con lotes, cola durable de recepción, sondeo unificado, guarda SSRF, base64 sin sobre `data:` |
| `bdf019c` | 2.0.181 | Adjuntar archivo, nota de voz y ubicación desde la bandeja |
| `6849ad5` | 2.0.182 | Manifiesto único del adjunto, diagnóstico del conducto, extracción ligada al proceso, volumen declarado, binarios de OCR/audio en la imagen |
| `10dd96f` | 2.0.183 | Matriz de revisión y sello de revisión humana (ajeno al conducto) |

La prueba de que el diagnóstico anterior envejeció es concluyente y está en el propio expediente: los cinco contraejemplos de `contraejemplos.ts` **ya no se cumplen**. El primero aseveraba que un sobre `messages[]` devolvía `null`; hoy devuelve el mensaje normalizado. Ejecutado el 18 de septiembre de 2026, el archivo aborta con `ERR_ASSERTION`: el comportamiento descrito fue reparado.

**Lo que sí queda demostrado en este árbol:** un PDF, un DOCX o un audio que llegan con una carga resoluble **se reciben, se conservan, aparecen en la bandeja, se descargan con sus bytes exactos y se extraen o transcriben**. La caja negra HTTP/PostgreSQL lo verifica con 17 casos en verde, y las puertas unitarias del conducto con 108. Esa parte del sistema funciona.

**Lo que sigue abierto** es una clase distinta y más fina de defecto: el conducto ya no pierde archivos en silencio, pero **el instrumento creado para vigilarlo tiene un falso verde**, y **la recuperación del archivo rechazado o agotado no existe**. Un PDF rechazado por política —o uno cuyo asiento de recepción se cierra como «registrado» aunque el documento no se haya creado— hace que el informe del conducto declare «sin pendientes, todo completado». La clase de error es hoy la opuesta a la que motivó el módulo: en 2.0.179 el diagnóstico afirmaba ausencia falsa; en 2.0.183 puede afirmar salud falsa.

**Conclusión causal admisible:** el sistema vigente transporta y consume PDF, Word y audio cuando la carga del proveedor es resoluble por su adaptador; y su diagnóstico puede declarar el conducto cerrado mientras un adjunto concreto quedó fuera del expediente.
**Conclusión causal todavía inadmisible:** afirmar cuál de las cinco clases de desenlace produjo la ausencia del PDF del incidente. Eso requiere la traza y los asientos de esa instancia, que no son accesibles desde este entorno.

**Y una advertencia que precede a todo lo anterior, verificada contra PostgreSQL real:** el procedimiento de instalación documentado en el propio repositorio **no crea las tres tablas de las que depende este conducto**. `pnpm db:push` ejecuta `drizzle-kit migrate` contra un diario que termina en `0014_cognitive_governance`; las migraciones `0035`, `0036` y `0037` —traza, cola de recepción y cola de procesamiento documental— **no están registradas** en él. Un despliegue que siga `docs/INSTALLATION.md` o `docs/GUIA_EASYPANEL_VARIABLES.md` al pie de la letra recibe el código de 2.0.183 contra una base sin esas tablas, y el resultado no es una degradación: es la caída de la recepción completa. Véase §6.7.

---

## 2. Límites de conocimiento de esta reauditoría

| Hecho | Consecuencia |
| --- | --- |
| No hay `DATABASE_URL` ni archivos `.env*` en la raíz | No se consultó ninguna base; las consultas se entregan para su ejecución autorizada |
| No hay acceso al panel de ApiChat ni al contenedor desplegado | No se verifica la configuración efectiva del webhook, ni `notify_format`, ni el digest desplegado |
| **No se dispone de las dos capturas en esta sesión** | La reconstrucción de §4 es la que quedó documentada en `informe.md` §2 a partir de las capturas del corte anterior; no se ha visto material nuevo |
| La instancia PostgreSQL local es efímera y con datos sintéticos | Su evidencia es de comportamiento del programa, no de producción |

Se mantiene la escala de niveles del informe original: **C** código, **R** reproducción con la función real, **E** ejecución de caja negra, **K** contrato oficial, **H** hipótesis, **D** diseño.

---

## 3. Evidencia ejecutada en esta reauditoría

Todas las órdenes se ejecutaron desde la raíz del repositorio, el 18 de septiembre de 2026, con Node 24.20.0 y el árbol en `715aee9`.

| Puerta | Comando | Resultado |
| --- | --- | --- |
| Caracterización vigente | `node --import tsx docs/audits/2026-09-18-apichat/reauditoria_2.0.183.ts` | **15/15 caracterizaciones**; 0 solicitudes de red |
| Contraejemplos 2.0.179 | `node --import tsx docs/audits/2026-09-18-apichat/contraejemplos.ts` | **Aborta**: el defecto que aseveraba ya no existe (delta demostrado) |
| Unitaria del conducto | `./node_modules/.bin/vitest run base64Transport attachmentPipeline transportTrace candidateKnowledge documentExtraction inboxSync` | **108/108 en verde**, 6 archivos |
| Puertas heredadas | `./node_modules/.bin/vitest run apiChatWebhook releaseGovernance` | **45/45 en verde**, 2 archivos |
| Caja negra HTTP/PostgreSQL | `MEDIA_TEST_DATABASE_URL=… ./node_modules/.bin/vitest run attachments.blackbox candidateProcessing.postgres transportObservability.postgres` | **17/17 en verde**, 3 archivos |
| Diario de migraciones | `node -e` sobre `drizzle/migrations/meta/_journal.json` | **15 entradas, termina en `0014`**; `0035`, `0036` y `0037` ausentes |
| Esquema declarado | `drizzle-kit push` sobre una base vacía aislada | Crea `apichat_inbound_receipts` y `candidate_document_jobs`; **no** crea `conversation_transport_traces` |
| Consultas forenses | `psql -v ON_ERROR_STOP=1 < consultas_solo_lectura.sql` | **Ejecuta sin error** contra el esquema completo; termina en `ROLLBACK`. Verificado tras aplicar el esquema declarado más la migración `0035` sobre una base aislada, eliminada después |

La base de verificación (`auditoria_sql_check`) se creó en el mismo contenedor de pruebas, se eliminó al terminar y no se tocó `aisa_media_test` ni ninguna instancia productiva. El expediente `consultas_solo_lectura.sql` **ya no es un artefacto no ejecutado**: está verificado contra PostgreSQL 16 real, con el esquema completo, y las consultas Q7–Q10 nuevas devuelven filas vacías —no errores— con sus filtros en `NULL`.

Los 25 fallos que la validación anterior reportó (`inboxSync.test.ts`, `apiChatWebhook.test.ts`, `releaseGovernance.test.ts`) **están migrados en HEAD**: las tres puertas pasan. El expediente de validación describe un árbol intermedio, no el vigente.

La caja negra se ejecutó contra el contenedor `aisa-media-test-pg` (`127.0.0.1:55439`, base `aisa_media_test`), con datos sintéticos. Incluye, entre otros, los casos que importan a este objeto: «confirma sólo después de conservar el lote, sobrevive a detener el consumidor y muestra PDF y texto», «el PDF real pasa de pendiente a analizado», «la bandeja y el motor conversacional leen el mismo manifiesto» y «el diagnóstico del conducto informa el eslabón que falla».

---

## 4. Reconstrucción fenomenológica del caso (heredada, sin material nuevo)

Lo que cada participante observó, según las capturas del corte anterior. Hora visible, sin conversión de zona:

| Hora | Perspectiva del candidato en WhatsApp | Perspectiva del aplicativo |
| --- | --- | --- |
| 13:24 | Imágenes y un texto que las presenta como CV | El texto aparece en la conversación |
| 13:25 | PDF de ≈1 MB y texto adicional | Respuesta automática que declara no encontrar documento |
| 13:26 | Nueva petición de adjuntar PDF | La petición aparece en la bandeja |
| 13:36 | Respuesta que cita el PDF anterior | Aparece el texto de la respuesta |
| 13:37 | El agente vuelve a pedir el CV | Continúa la afirmación de ausencia |

La reconstrucción se conserva con dos advertencias que el informe original ya formulara: una captura de WhatsApp **no acredita** el cuerpo HTTP que ApiChat envió, y la ausencia en un recorte **no acredita** ausencia en todo el historial. El itinerario de las imágenes prueba que el canal estaba abierto y que la resolución de teléfono→conversación funcionaba en ese momento; no prueba nada sobre el mensaje del PDF.

La consecuencia organizacional sí queda establecida y no depende de la causa técnica: **la repetición de solicitudes convierte una incertidumbre del sistema en una atribución al candidato**. Un artefacto que dice «no ha enviado el documento» cuando en realidad no sabe si lo recibió delega en la persona la carga de una falla propia.

---

## 5. Estado de H01–H16 en 2.0.183

| Hallazgo (2.0.179) | Estado en HEAD | Evidencia de la reparación |
| --- | --- | --- |
| H01 · Callback contractual | **Reparado** | `apiChatContract.ts` `normalizeApiChatBatch` recorre `messages[]`, `params` y lotes hasta 100, conservando posiciones inválidas. Contraejemplo C01 obsoleto; A5 lo caracteriza |
| H02 · Sondeo equivalente | **Reparado** | `inboxSync.ts` reutiliza el mismo normalizador y `enqueueApiChatReceipts` con cursor durable; `inboxSync.test.ts` (11) en verde |
| H03 · Acuse durable | **Reparado** | `apiChatReceipts.ts`: commit del lote antes del 200; 503 sin base; worker con lease y reintento exponencial |
| H04 · Identidad común | **Reparado** | `loadAttachmentManifest` como única fuente para bandeja y motor; `candidateFileId` enlaza mensaje y documento |
| H05 · Enlace de bandeja | **Reparado** | `inboxDetail` proyecta `media_storage_key` y `media_file_name`; clave codificada; caja negra verifica bytes idénticos y rangos |
| H06 · Análisis durable | **Reparado** | `candidate_document_jobs` con `SKIP LOCKED`, lease y advisory lock; `onProcessStart` desliga la extracción del interruptor del agente |
| H07 · Audio/OCR/DOC | **Reparado en código** | `analyzeCandidateDocument` integra transcripción; `documentExtraction.ts` despacha DOCX, PDF, DOC y OCR |
| H08 · Observabilidad veraz | **Reparado, con un caso nuevo** | `uploaded_at` corregido; la incógnita se declara. Queda el falso verde de §6.1 |
| H09 · SSRF/procedencia | **Reparado** | `resolveAttachmentDestination`: HTTPS público, lista de hosts, validación de DNS/IP, `redirect: manual` |
| H10 · Dirección/postulación | **Parcial** | `from_me` y grupos resueltos; sigue eligiendo la conversación más reciente del teléfono |
| H11 · Idempotencia | **Reparado** | `receipt_key` única y clave de almacenamiento determinista por mensaje |
| H12 · Límites y tipos | **Parcial** | Descarga a 30 MiB y errores tipados; persiste el matiz de `ftyp`→mp4 frente a M4A |
| H13 · Cadena de custodia | **Parcial** | Traza con huella y redacción; retención de 14 días; sin archivo probatorio completo |
| H14 · CV recibido ≠ evidencia | **Reparado** | `document_class` y la instrucción «recibido no significa interpretado» en el contexto |
| H15 · Persistencia/despliegue | **Reparado en la imagen** | El `Dockerfile` instala `antiword`, `poppler-utils`, `tesseract-ocr` (+`spa`,`eng`), `ffmpeg`, fija `DOCUMENT_OCR_ENABLED=true` y declara `VOLUME ["/app/data/knowledge-files"]`. **Pendiente de acreditar en el despliegue**: que el volumen sea **con nombre y compartido** entre receptor y motor |
| H16 · Acceso/paginación | **Parcial** | Rangos corregidos; la bandeja conserva `LIMIT 500` sin cursor |

Las reparaciones de H01–H07, H09, H11 y H14 están **ejecutadas y verificadas** en este árbol, no declaradas. Las parciales corresponden a límites de diseño, no a defectos de implementación.

---

## 6. Hallazgos vivos en 2.0.183

Prioridad **P1**: puede impedir la función troncal o afirmar un hecho falso sobre la evidencia. **P2**: degrada recuperación, diagnóstico o capacidad. No son puntuaciones CVSS.

### 6.1 · H17 — P1 · El diagnóstico declara «sin pendientes» con un adjunto rechazado

**Evidencia:** R+C. `reauditoria_2.0.183.ts`, caso `D3_falso_verde_por_rechazo_de_politica`. Con `receiptsReceived: 1, receiptsCompleted: 1, receiptsRejected: 0, documentsReceived: 0`, la función real devuelve:

```text
estado:  sin_pendientes
veredicto: "La ventana consultada cierra sin adjuntos pendientes:
            recepción, derivación y evaluación constan completadas."
```

**Mecanismo, por eslabones:**

1. `apiChatWebhook.ts` cierra el recibo como `registered` porque el **mensaje** se escribió, aunque `registerCandidateInboundDocument` haya devuelto `outcome: "rejected"` con motivo `extension_not_allowed` o `size_limit`.
2. `apiChatReceipts.ts` clasifica como terminal: `terminal = registered || duplicado || saliente-ya-registrado` → `status = completed`, `outcome = registrado`.
3. `attachmentPipeline.ts` cuenta recibos por estado y documentos por la tabla del expediente. El rechazo de política **no crea documento** y **no se cuenta como recibo rechazado**.

**Efecto:** un PDF fuera de la política de extensiones —o por encima del peso configurado— no aparece en ningún contador del informe del conducto, que además afirma salud. El motivo sobrevive únicamente en `conversation_messages.metadata.media.processingReason`, visible en el manifiesto de la bandeja. Un operador que consulte el panel de auditoría concluirá que el conducto está sano mientras el expediente del candidato está incompleto.

**Corrección especificada:** añadir al resumen un contador de rechazos de ingreso derivado del mensaje (`metadata->'media'->>'processingOutcome' = 'rejected'`) y un estado `ingreso_rechazado` con precedencia anterior a `sin_pendientes`. El rechazo de política es un desenlace legítimo del sistema, pero no es un cierre saludable: es una decisión administrativa que debe mostrarse como tal, con su motivo y con la posibilidad de habilitar la extensión.

### 6.2 · H18 — P2 · El código de error del transporte y su condición de reintento no llegan al asiento

**Evidencia:** C. `reauditoria_2.0.183.ts`, caso `C1_codigo_de_error_no_sobrevive`. `base64Transport.ts` clasifica cada fallo con un código (`http_error`, `size_limit`, `unsafe_destination`, `network_error`, `empty_content`, `redirect_limit`) **y** con una condición `retryable` calculada con cuidado —un 408, un 429 y todo 5xx son reintentables; un destino no permitido no lo es—. La cola escribe:

```ts
const reason = error instanceof Error ? error.name : "ProcessingError";
```

`error.name` vale `"AttachmentTransportError"` o `"Error"`. Ni el código ni `retryable` se consumen en código productivo: la única lectura de `retryable` en todo el repositorio está en `base64Transport.test.ts`.

**Efecto doble.** (a) El diagnóstico no puede distinguir «la URL expiró» de «el host no está permitido» de «el archivo excede el peso»: el operador ve `last_error = AttachmentTransportError`. (b) Se reintentan ocho veces por igual los fallos permanentes y los transitorios, de modo que un `size_limit` o un `unsafe_destination` consumen la misma ventana de veintiún minutos que un corte de red y retrasan el veredicto y la intervención.

**Corrección especificada:** asentar `code` y `retryable` en el propio asiento —el esquema admite 200 caracteres y ya declara `last_error varchar(200)`— y honrar la condición: agotar de inmediato lo permanente con estado `rejected` y motivo tipado, y reintentar sólo lo transitorio. La consecuencia observable es que el informe del conducto podría decir *por qué* no llegó el archivo, que es exactamente lo que el cliente necesita para decidir.

### 6.3 · H19 — P1 · Un PDF notificado por URL remota no llega a la bandeja

**Evidencia:** R + E. `reproduccion_pdf_bandeja.ts`: cinco envíos del **mismo PDF**, desde el mismo teléfono, hacia la misma conversación, contra PostgreSQL real con el trabajador real. **Dos llegaron a la bandeja; tres no. Sólo uno entró al expediente.**

| Forma en que el proveedor notifica el PDF | Fila en la bandeja | Documento | Recibo |
| --- | --- | --- | --- |
| `url` con `data:` (base64 incrustado) | **Sí** | **Sí** | `completed` · 1 intento |
| `url` con `https://` de destino no público | **No** | No | `dead` · 8 intentos · `last_error = AttachmentTransportError` |
| `url` con `https://` pública que no responde | **No** | No | `dead` · 8 intentos · `last_error = AttachmentTransportError` |
| `url` con `http://` | **No** | No | `dead` · 8 intentos · `last_error = Error` |
| Campo no enumerado con URL HTTPS válida | Sí, como texto rechazado | No | `rejected` · `archivo-sin-contenido` |

**Mecanismo, por eslabones.** `normalizeApiChatMessage` copia `url` **sin validar su esquema**, pero sólo resuelve `contentValue` si la cadena empieza por `data:`, empieza por `https://` o supera 64 caracteres con forma base64. El receptor usa `source = message.contentValue ?? message.url`, de modo que existen **dos desenlaces distintos y no uno**:

- **Con `url` presente pero no resoluble** (`http://`, base64 corto, texto cualquiera): `decodeRemoteAttachment` devuelve `null` sin intentar conexión alguna, el receptor lanza `AttachmentContentUnavailable`, y el recibo **agota ocho intentos en ≈21 minutos y queda en `dead`. El mensaje no se asienta y la bandeja no muestra nada.** La pérdida sólo tiene rastro en `apichat_inbound_receipts`, con `last_error` degradado al nombre de la clase.
- **Sin `url` ni contenido resoluble** (campo no enumerado): el receptor **sí** asienta el mensaje con `processingOutcome = rejected` y motivo `contenido_no_disponible`, y no crea documento. Es el único de los dos casos en que la bandeja declara el motivo.

**Por qué esto explica el síntoma del CV.** Cuando la opción de notificar adjuntos en base64 está apagada, el proveedor notifica una **URL de medios**: firmada, con caducidad y, con frecuencia, en un host que exige credencial o no es alcanzable desde el contenedor. En ese camino el código exige simultáneamente TLS, destino público validado por DNS, ausencia de credenciales en la URL, menos de cuatro redirecciones y respuesta 2xx **antes de que caduque la firma**. Cualquier incumplimiento termina en `dead`, y nada aparece en la bandeja. El informe de 2.0.179 afirmó que «activar base64 no corrige nada»: era prematuro. Es exactamente lo que decide entre el primer renglón de la tabla y los tres siguientes.

**Atenuante demostrado:** la traza conserva la ruta del campo y la huella del contenido (`messages[0].url`, `messages[0].type`, `messages[0].filename`), así que «¿en qué forma notificó ApiChat el PDF?» se responde por consulta, sin depender de las capturas.

**Corrección especificada, en este orden:**

1. **Inmediata y sin código:** notificar los adjuntos **en base64** desde el panel de ApiChat, para que la carga viaje en el cuerpo y no dependa de un recurso remoto. Queda demostrado por el primer renglón de la tabla.
2. **Asentar el motivo tipado** del error de transporte y honrar `retryable` (H18), para que un recibo muerto diga por qué murió.
3. **Reproceso administrativo** (H21): los tres recibos `dead` de la reproducción son irrecuperables con las superficies actuales.
4. **Visibilizar el rechazo** en el informe del conducto y, si finalmente se decide admitir `http://`, hacerlo sólo para hosts de la lista institucional y con asiento explícito: admitirlo en general debilitaría la guarda de H09.

### 6.4 · H20 — P2 · El lote mayor de cien se anula por completo

**Evidencia:** R. Caso A4. `normalizeApiChatBatch` lanza «El lote excede cien mensajes» y la excepción ocurre **antes** de la transacción de la cola: la ruta responde 503 y ninguno de los elementos se conserva. En un lote de 101 mensajes válidos, los 101 se pierden si el proveedor no reintenta.

**Efecto:** el comportamiento es correcto frente al abuso y es coherente con la respuesta 503 —el proveedor debe reintentar—, pero convierte un lote grande en una pérdida total en lugar de una degradación parcial. Con el historial paginado a 50 no debería alcanzarse; con un callback agregado, sí.

**Corrección especificada:** procesar el lote en segmentos, conservando cada segmento antes de continuar, o responder 413 con la parte aceptada declarada. La degradación debe ser proporcional al defecto.

### 6.5 · H21 — P1 · No existe superficie de reproceso

**Evidencia:** C. `apiChatAudit.ts` expone tres funciones y ninguna escribe; el encabezado de `attachmentPipeline.ts` lo declara: «Ambas superficies son **solo lectura**: no reintentan, no cambian estados y no alteran ninguna evaluación». Un recibo en `dead` o `rejected` es terminal por construcción (`terminal = …`) y no hay operación —ni de router, ni de script— que lo devuelva a `pending`.

**Efecto:** una vez agotados los ocho intentos, el archivo del candidato queda irrecuperable **aunque el original siga disponible**. La ventana es de ≈21 minutos: los retrasos son 10, 20, 40, 80, 160, 320 y 640 segundos, con `exhausted = attempts >= 8`. Si la conversación no existe todavía, si el destino no resolvía o si la URL aún no era accesible, no hay segunda oportunidad. «Durable» describe hoy la conservación del asiento, no la recuperación del contenido.

**Corrección especificada:** una operación administrativa de reproceso acotada —un procedimiento de rol `admin` que, sobre un `receipt_key` concreto y con motivo asentado en `audit_log`, devuelva el recibo a `pending` conservando su identidad y su historial de intentos—, más un trabajo programado que reprocese `dead` cuando la causa fue transitoria. Debe ser idempotente por construcción, lo que ya está garantizado por `receipt_key` y por la clave determinista de almacenamiento. Sin esta pieza, la única reparación posible ante un `dead` es la intervención manual sobre la base.

### 6.6 · H22 — P2 · Capacidad declarada frente a capacidad acreditada en el despliegue

**Evidencia:** C. El `Dockerfile` vigente sí instala los decodificadores y activa el OCR, lo que repara el defecto de 2.0.179. Pero la verificación de una capacidad no puede hacerse sobre el archivo que la declara: depende del digest desplegado, del volumen montado y del interruptor efectivo.

**Efecto condicional:** un PDF escaneado sin capa de texto se conserva y queda en `no_aplica` con `ocr_disabled` si el interruptor no está activo; un DOC heredado requiere `antiword`; un audio AMR, AAC, OPUS o 3GP requiere `ffmpeg` para convertirse. En cualquiera de esos casos el archivo **está recibido y no está interpretado**, de modo que el motor no puede usarlo como evidencia curricular. La distinción es de vocabulario, no de matiz: «recibido» e «interpretado» son estados distintos, y el contexto conversacional ya lo declara así.

**Verificación exigible en el despliegue:**

```bash
# Digesto real frente al árbol auditado
docker inspect --format '{{.Image}}' <contenedor>
# Binarios efectivos dentro de la imagen desplegada
docker run --rm <imagen> sh -c 'for b in antiword pdfinfo pdftoppm tesseract ffmpeg; do command -v $b || echo "FALTA $b"; done'
# Volumen compartido entre receptor y motor, en modo dividido
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} {{.Destination}}{{"\n"}}{{end}}' <contenedor-receptor> <contenedor-motor>
# Interruptor efectivo
docker exec <contenedor> printenv DOCUMENT_OCR_ENABLED
```

El panel administrativo ya expone el inventario de códecs (`codecRegistry`), pero **una etiqueta de catálogo no acredita un binario instalado**. Mientras esa verificación no se haga, la capacidad de consumir PDF escaneado, DOC heredado y audio de contenedor exótico permanece declarada y no probada.

### 6.7 · H23 — P1 · El camino de despliegue documentado no crea las tablas del conducto

**Evidencia:** R. Tres comprobaciones ejecutadas sobre el árbol vigente y una base PostgreSQL 16 real y aislada.

1. `drizzle/migrations/meta/_journal.json` contiene **15 entradas y termina en `0014_cognitive_governance`**. Las migraciones `0035_transport_traces`, `0036_apichat_inbound_receipts` y `0037_candidate_processing` **no están registradas en el diario**.
2. `pnpm db:push` es `drizzle-kit generate && drizzle-kit migrate`. `drizzle-kit migrate` aplica **el diario**, no el directorio: por tanto **no aplica** esas tres migraciones. Y `docs/INSTALLATION.md`, `docs/GUIA_EASYPANEL_VARIABLES.md` y `docs/ANALISIS_COGNITIVO_DORA_2.0.130.md` indican precisamente `pnpm db:push` como paso de esquema.
3. `drizzle-kit push` sobre una base vacía, tomando el esquema de `drizzle/schema.ts`, crea `apichat_inbound_receipts` y `candidate_document_jobs` —ambas declaradas en el esquema— y **no crea `conversation_transport_traces`**, que sólo existe como SQL escrito a mano en `drizzle/migrations/0035_transport_traces.sql`.

**Efecto del primer modo de falla (instalación por `db:push`).** Las tres tablas faltan. Entonces:

- `enqueueApiChatReceipts` inserta en `apichat_inbound_receipts`: la tabla no existe, la transacción revierte, el controlador responde **HTTP 503** y **no se conserva nada** —ni texto, ni adjunto, ni traza—. La bandeja queda vacía; el cliente observa un artefacto inerte.
- El trabajador de recibos registra «cola no disponible» cada segundo; el de documentos falla; el informe del conducto declara `observabilidad_no_disponible`.

**Efecto del segundo modo de falla (mantenimiento por `drizzle-kit push` con las tablas ya creadas por el SQL consolidado).** Como `conversation_transport_traces` no está declarada, la reconciliación la considera sobrante y **la elimina**. Se destruye el instrumento forense —el único que conserva la *forma* del cuerpo que envió ApiChat— en el acto administrativo de sincronizar el esquema. Es la violación de la convención que el propio repositorio declara: toda tabla nueva debe declararse en `drizzle/schema.ts`.

**Lo que sí funciona:** `database/005_servicio_conversacional_listo.sql`, generado por `pnpm deploy:sql`, **contiene las tres tablas** (líneas 1220, 1337 y 1385) y se autocertifica. Existe, por tanto, un camino correcto: el consolidado. El defecto es que **conviven dos caminos y el documentado para instalar no es el que funciona**.

**Corrección especificada:** (a) registrar las tres migraciones en el diario de Drizzle —o eliminar la ambigüedad documentando de forma inequívoca que el único camino es el SQL consolidado—; (b) declarar `conversation_transport_traces` en `drizzle/schema.ts` para que una reconciliación no la borre; (c) añadir a la puerta de release una verificación de que las tablas del conducto existen y de que el diario alcanza la última migración. La verificación «el archivo de migración existe» no es equivalente a «la migración se aplica».

**Comprobación inmediata en la instancia del cliente:**

```sql
SELECT to_regclass('public.apichat_inbound_receipts')      AS recibos,
       to_regclass('public.candidate_document_jobs')       AS trabajos,
       to_regclass('public.conversation_transport_traces') AS trazas;
```

Si cualquiera devuelve `NULL` en una instancia que ejecuta 2.0.180 o superior, la causa del incidente **no está en el transporte de medios**: el conducto no puede recibir nada. Y si las tres existen pero `conversation_transport_traces` falta sólo en la instancia, hay que revisar quién ejecutó `drizzle-kit push`.

---

## 7. Árbol de decisión forense: dónde muere un adjunto

El valor operativo de esta reauditoría está en esta tabla. Cada fila es un punto de decisión del código vigente, con el predicado exacto y **el observable que debe consultarse** para saber si el archivo murió ahí. Se recorre en orden: el primer eslabón con evidencia positiva es el que explica el desenlace.

| # | Puerta | Predicado (código vigente) | Observable que lo distingue |
| --- | --- | --- | --- |
| 1 | Autenticación | `authorized()` exige `x-webhook-token` o `?key=` igual a `APICHAT_WEBHOOK_SECRET` | HTTP 401 o 503 en el proxy; **ausencia total** de fila en `conversation_transport_traces` |
| 2 | Forma del cuerpo | `normalizeApiChatBatch` desenvuelve `messages[]`, `params` o mensaje individual | `outcome = forma-no-reconocida` en la traza; `receipt.outcome = forma-no-reconocida` |
| 3 | Lote | ≤100 elementos | 503 sin asiento alguno; ningún recibo de ese lote |
| 4 | Identidad | `id` con forma válida, `number` de 7 a 15 dígitos, sin `@g.us` | `forma-no-reconocida` sin fila de mensaje |
| 5 | Resolución de contenido | `contentValue ?? url` resoluble (`data:`, `https://` o base64 ≥64) | Si falta el origen: mensaje asentado con motivo. Si hay `url` no resoluble: recibo `dead` y **nada** en la bandeja |
| 6 | Destino | `https://` público, host permitido, IP pública | Recibo `retry`/`dead` con `last_error = AttachmentTransportError` |
| 7 | Materia | Descarga, firma por contenido, peso y `sha256` | Recibo `dead` si la URL expiró; manifiesto sin fila de documento |
| 8 | Destinatario | `conversationForPhone` exige conversación `pendiente`/`activo` | Recibo `retry`→`dead` con `last_error = Error`; **nada** en la bandeja |
| 9 | Política del expediente | Extensión habilitada y peso ≤ `maxSizeMb` | Mensaje con `processingOutcome = rejected` y `extension_not_allowed`/`size_limit`; recibo **`completed`** (§6.1) |
| 10 | Persistencia | `writeInboxFile` y `persistCandidateDocument` con `sha256` | `storage_missing` en el expediente; `knowledge.storageHealth` en la administración |
| 11 | Interpretación | `analyzeCandidateDocument` según formato y capacidad instalada | `analysis_status = no_aplica` o `error` con `processing_error_code` |
| 12 | Consumo | El motor lee el manifiesto; el evaluador, los últimos análisis vigentes | El agente declara el estado en vez de negar la recepción |

**Lectura del árbol para el incidente del PDF.** La asimetría observada —imágenes admitidas y PDF no— descarta por construcción las puertas 1, 2, 4 y 8 si ambos mensajes viajaron en el mismo canal y la misma conversación en minutos contiguos. Quedan como candidatas la 5 (forma de carga no resoluble, con la asimetría posible entre `image` y `document`), la 6 y la 7 (destino y materia: la URL del PDF no descargable, expirada o con respuesta distinta) y la 9 (política de extensiones). Las tres son distinguibles con una sola consulta si la traza existe —véanse Q7 a Q10 de `consultas_solo_lectura.sql`.

**Advertencia metodológica.** La puerta 9 es la más peligrosa de todas porque su observable está en el lugar equivocado: el recibo dice `completed`. Quien consulte solo el informe del conducto no la verá. Quien consulte solo la bandeja, sí.

---

## 8. Marco ontológico del transporte correcto

El informe de 2.0.179 estableció las entidades mínimas —evento, mensaje, objeto binario, adjunto, postulación, derivado, evidencia evaluable, decisión— y los estados independientes de recepción, binario, interpretación, clasificación y evaluación. Esa ontología es correcta y este código la realiza en su mayor parte. La reauditoría **añade dos entidades y una propiedad** que faltaban, y que son exactamente las que explican los hallazgos vivos.

| Entidad nueva | Identidad mínima | Propiedad que le corresponde |
| --- | --- | --- |
| **Intento de entrega** | recibo, número de intento, instante, causa tipada, condición de reintento | Un desenlace no es un estado del archivo. El mismo adjunto puede tener ocho intentos fallidos y un noveno exitoso sin cambiar de identidad |
| **Acción de reproceso** | recibo, actor, motivo, instante, desenlace | Un recibo terminal no es un recibo definitivo mientras el hecho que lo motivó pueda cambiar |

**Propiedad añadida a todo estado agregado:** *veracidad de cierre*. Un agregado puede declarar «sin pendientes» **sólo si** todo adjunto de la ventana alcanzó un desenlace interpretable o fue declarado con su motivo. Hoy esa propiedad no se cumple (§6.1), y su incumplimiento es de la misma naturaleza que el que el módulo fue escrito para eliminar: **una afirmación sobre la evidencia que la evidencia no sostiene**.

Invariantes, con su estado actual:

| # | Invariante | Estado en 2.0.183 |
| --- | --- | --- |
| 1 | Conservación: ningún elemento del lote desaparece por un retorno temprano | **Cumplido** (con la excepción de §6.4 en lotes >100) |
| 2 | Acuse: `ack_aceptado(e) ⇒ evento_durable(e)` | **Cumplido** para el asiento; **no** para la recuperación del contenido (§6.5) |
| 3 | Identidad: webhook y sondeo producen el mismo ID lógico | **Cumplido** (`receipt_key` con cuenta, teléfono e ID) |
| 4 | Integridad: `SHA256(bytes_almacenados) = SHA256(bytes_validados)` | **Cumplido** (verificado en caja negra) |
| 5 | Convergencia: bandeja, expediente y motor leen el mismo manifiesto | **Cumplido** |
| 6 | Veracidad: pendiente, fallo y no soportado no se convierten en ausencia | **Cumplido** en la bandeja y el contexto; **incumplido** en el informe del conducto (§6.1) |
| 7 | Vivacidad condicionada: todo trabajo termina o se deriva con causa | **Parcial**: termina, pero un `dead` no admite derivación ni reproceso (§6.5) |
| 8 | Reproducibilidad: la huella de la evaluación incluye la evidencia usada | **Cumplido** con reservas documentadas en H14 |

La conclusión ontológica es precisa: **el artefacto ya distingue «no llegó» de «llegó y no se pudo interpretar» en las superficies que ve el reclutador, pero todavía no en la superficie que consulta el administrador**. La corrección es de proyección y de recuperación, no de arquitectura.

---

## 9. Corrección especificada

Los cuatro cambios que cierran los hallazgos vivos son acotados y no requieren introducir infraestructura nueva.

| Orden | Cambio | Archivo | Cierra |
| --- | --- | --- | --- |
| 1 | Contar los rechazos de ingreso derivados del mensaje y añadir el estado `ingreso_rechazado` con precedencia previa a `sin_pendientes` | `server/attachmentPipeline.ts` | H17 |
| 2 | Asentar `code` y `retryable` del error de transporte, y honrar `retryable` en la política de reintento | `server/apiChatReceipts.ts`, `server/base64Transport.ts` | H18, H21 (parcial) |
| 3 | Registrar las claves presentes del cuerpo cuando no se resuelve contenido, y enlazar la traza desde el mensaje | `server/apiChatWebhook.ts`, `server/inbox.ts` | H19 |
| 4 | Operación administrativa acotada de reproceso sobre un recibo terminal, con asiento en `audit_log` | `server/apiChatReceipts.ts`, `server/routers.ts`, hoja de auditoría | H21 |
| 5 | Registrar las tres migraciones del conducto en el diario de Drizzle y declarar `conversation_transport_traces` en el esquema; verificar la existencia efectiva de las tablas en la puerta de release | `drizzle/migrations/meta/_journal.json`, `drizzle/schema.ts`, `scripts/verify-release.mjs`, `docs/INSTALLATION.md` | H23 |

Ninguno altera la evaluación, la puntuación ni el expediente: son cambios de observación, clasificación y recuperación. Los cuatro son verificables con casos de caja negra sobre la instancia aislada ya existente, sin tocar producción.

**Dimensionamiento de software y hardware.** No hay en este árbol —ni en el informe anterior— una sola medición que justifique adquirir hardware. Lo acreditado es: imagen Node 22 Alpine con OCR, conversión y decodificadores instalados; PostgreSQL; almacenamiento en volumen. Lo no acreditado es: CPU, memoria, límites del contenedor, IOPS, réplicas y latencias reales. **El cuello de botella identificado es contractual y de proyección, no de capacidad.** Comprar servidores no repara una URL que el adaptador no resuelve ni un recibo que nadie puede reprocesar. El orden correcto es: reparar, instrumentar, medir carga representativa y, sólo entonces, dimensionar.

---

## 10. Protocolo forense para el incidente concreto

Se conserva íntegro el protocolo de `informe.md` §10 —fijar el objeto, preservar fuentes, verificar configuración, reconciliar el ID, clasificar el desenlace, recuperar tras corregir— y se añade lo que la versión vigente hace ahora posible: **la consulta resuelve la puerta, no sólo la hipótesis**. Las consultas Q7–Q10 de `consultas_solo_lectura.sql` se corresponden una a una con el árbol de §7.

Correspondencia entre lectura y afirmación permitida:

| Resultado de la consulta | Afirmación permitida | Afirmación que no permite |
| --- | --- | --- |
| Sin fila en `conversation_transport_traces` en la ventana, con la aplicación en uso | La recepción no fue observada por el instrumento | Que ApiChat no llamó |
| Traza con `outcome = forma-no-reconocida` | Ese cuerpo no fue interpretado por el adaptador | Que todos los cuerpos llegan así |
| Traza con `messages[0].url` presente y huella de contenido | El proveedor **sí** entregó una referencia de contenido | Que los bytes fueran descargables ni que se conservaran |
| Recibo `dead` con `last_error` | El archivo no alcanzó la bandeja; el intento se agotó | Cuál fue la causa tipada (hoy no se asienta: §6.2) |
| Recibo `completed` y mensaje con `processingOutcome = rejected` | Llegó y fue rechazado por política, con su motivo | Que no llegara |
| Mensaje con `storageKey` y `candidateFileId` | El binario se conservó y se vinculó al expediente | Que su texto se haya extraído |
| Documento con `analysis_status = no_aplica` | Está conservado y no interpretado | Que el candidato no envió CV |

**Antes de todo lo anterior — y esto es lo primero que debe verificarse — la versión desplegada y su esquema.** La consulta de §6.7 distingue tres estados y cada uno conduce a un diagnóstico distinto:

| `recibos` / `trabajos` / `trazas` | Estado de la instancia | Lectura |
| --- | --- | --- |
| `NULL` / `NULL` / `NULL` | Anterior a 2.0.180, o instalada con `pnpm db:push` | Si la versión es anterior, el asiento de mensajes estaba roto y la bandeja estaba vacía para **todo** mensaje. Si la versión es 2.0.180 o superior, el webhook responde 503 y no se conserva nada: el conducto no opera |
| Presente / presente / `NULL` | Esquema reconciliado con `drizzle-kit push` | La recepción y el procesamiento operan; **la traza forense fue eliminada** y el incidente ya no se puede resolver por consulta: sólo queda el testimonio de las capturas |
| Presente / presente / presente | Instalación por el SQL consolidado | Es el estado correcto. El árbol de decisión de §7 permite resolver la puerta exacta del incidente con Q7–Q10 |

Si las tres devuelven `NULL` y la versión desplegada es anterior a 2.0.180, la causa del incidente está por encima de cualquier hipótesis de este informe —y el asentamiento de mensajes ya estaba reparado en 2.0.180—; el orden de trabajo es: desplegar 2.0.183 con el SQL consolidado, migrar, y **después** reprocesar el historial del candidato con la traza delante. Mientras la versión desplegada sea anterior a 2.0.180, cualquier conclusión sobre el comportamiento del transporte carece de objeto.

```bash
# La ruta que sí crea las tablas del conducto
pnpm deploy:sql   # regenera database/005_servicio_conversacional_listo.sql
# y aplicar ese archivo con un rol autorizado, en una sola transacción
```

---

## 11. Criterios de aceptación de la corrección

| Prueba contractual o de falla controlada | Resultado exigido |
| --- | --- |
| Adjunto rechazado por extensión fuera de política y otro por peso excedido | El informe del conducto declara `ingreso_rechazado` con motivo; nunca `sin_pendientes` |
| URL con destino no permitido y URL que responde 403 | Asiento con el código tipado y `retryable`; sin ocho reintentos de un fallo permanente |
| Corte de red transitorio | Reintento efectivo y recuperación sin duplicar |
| Cuerpo con la carga en un campo no enumerado | El mensaje asienta las claves presentes y la referencia a la traza |
| Recibo agotado con el original disponible | La operación de reproceso lo devuelve a la cola, con asiento de actor y motivo, sin duplicar mensaje ni documento |
| Lote de 101 mensajes | Degradación parcial declarada, no anulación total |
| PDF textual, PDF escaneado con OCR activo, PDF escaneado con OCR inactivo, DOCX, DOC, MP3 y OGG | Estado real por formato, con la capacidad efectiva de la instalación; ninguno se presenta como ausente |
| Consulta del informe con la fuente de recibos caída | `observabilidad_no_disponible`, jamás cero |

Toda verificación debe ejecutarse sobre la instancia aislada con datos sintéticos. La atribución del incidente requiere, además, los registros del apartado anterior.

---

## 12. Conclusión

El sistema auditado ha dejado de ser el de 2.0.179. El conducto de PDF, Word y audio **transporta, conserva, expone e interpreta** en las condiciones que la caja negra verifica: 17 casos, PostgreSQL real, bytes idénticos por SHA-256. Las puertas unitarias del conducto suman 108 casos en verde y las heredadas 45.

Lo que resta no es un códec ni un ajuste del grafo: es **la veracidad del instrumento, la recuperación del archivo y el camino de despliegue**. Un diagnóstico que puede declarar cierre con un adjunto fuera del expediente, un error tipado que se degrada a su nombre de clase, una forma de carga no resoluble que no dice qué claves llegaron, un recibo terminal sin reproceso y un procedimiento de instalación documentado que no crea las tablas de las que el conducto depende. Cinco correcciones de proyección, clasificación y despliegue, ninguna de arquitectura, cierran el ciclo.

Para el cliente, el orden es inequívoco: **verificar la versión desplegada y su esquema primero** (§6.7); desplegar 2.0.183 con el SQL consolidado —no con `pnpm db:push`— si no lo está; consultar la traza del mensaje del PDF con las consultas de §10; y sólo entonces decidir si la causa fue de forma de carga, de destino o de política. Mientras la versión desplegada sea anterior a 2.0.180, o mientras las tres tablas del conducto no existan, cualquier conclusión sobre el comportamiento del transporte carece de objeto, porque el árbol que produjo la observación no es el árbol que se está auditando.

Esta entrega es una reauditoría y una especificación de corrección. **No modifica la aplicación ni acredita una reparación desplegada.**

---

## Referencias

American Psychological Association. (2020). *Publication manual of the American Psychological Association* (7.ª ed.). https://www.apa.org/pubs/books/publication-manual-7th-edition-paperback

ApiChat. (s. f.). *OpenAPI specification* (versión 1.7). https://panel.apichat.io/openapi.yaml?version=1.7

Josefsson, S. (2006). *The Base16, Base32, and Base64 data encodings* (RFC 4648). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc4648

Kent, K., Chevalier, S., Grance, T., & Dang, H. (2006). *Guide to integrating forensic techniques into incident response* (NIST SP 800-86). National Institute of Standards and Technology. https://csrc.nist.gov/pubs/sp/800/86/final

---

### Nota sobre el estilo de citación

El encargo solicita «APA 8». La American Psychological Association publica la **séptima edición** (2020) como manual vigente; no se ha localizado una octava edición. Este expediente cita en **APA 7**, coherente con el informe antecedente, y evita presentar como norma un número de edición que no existe. Si la institución exige otro estilo, el cambio es de formato y no afecta a ningún hallazgo.
