# Plan de puesta en vivo y recepción inmediata — PDF, Word, audio e imagen

**Objeto:** llevar el conducto de evidencia documental a recepción efectiva en producción, en el menor número de intervenciones y con reversión garantizada.
**Fecha:** 18 de septiembre de 2026. **Versión objetivo:** JARVI RH 2.0.183 (`715aee9`).
**Base:** [reauditoria_2.0.183.md](reauditoria_2.0.183.md) y [informe.md](informe.md).
**Naturaleza:** plan de ejecución. Cada paso declara su observable de éxito y su criterio de reversión. Nada de este documento se ha ejecutado contra producción.

---

## 0. Tesis del plan

La cadena de recepción **ya funciona y está probada**: la caja negra HTTP + PostgreSQL real de este árbol pasa 17 casos, incluido «confirma sólo después de conservar el lote… y muestra PDF y texto» y «el PDF real pasa de pendiente a analizado». El fallo del cliente, por tanto, **no es de código ni de hardware**: es de *aplicabilidad* del código a la instancia.

De ahí la forma quirúrgica del plan: **no se reescribe nada para poner en vivo**. Se hacen existir las tres tablas de las que depende el conducto —hoy el camino de instalación documentado no las crea (§1)—, se abren las seis puertas de operación que gobiernan la recepción (§2), se prueba el conducto con los cuatro formatos sujetos de estudio (§3) y sólo después se operan las reparaciones de instrumento y recuperación (§4–§6), que mejoran el diagnóstico y la recuperación pero **no condicionan la recepción**.

Regla de oro del plan: **cada incisión se verifica con un observable de base de datos, no con una impresión de la interfaz.**

---

## 1. T0 · Cirugía de mesa — hacer existir el conducto

**Ventana estimada:** 15 minutos. **Reversible:** sí.

### Paso 1.1 · Fijar el estado inicial (2 min)

```sql
-- ¿La instancia puede recibir? Tres tablas deciden.
SELECT to_regclass('public.apichat_inbound_receipts')      AS recibos,
       to_regclass('public.candidate_document_jobs')       AS trabajos,
       to_regclass('public.conversation_transport_traces') AS trazas;

-- ¿Qué versión corre? La versión visible está en el pie del menú, bajo el usuario.
SELECT setting_value FROM integration_settings
 WHERE provider='conversation' AND setting_key IN ('agent_enabled','capability_receive','service_mode');
```

**Interpretación inmediata:**

| `recibos` / `trabajos` / `trazas` | Diagnóstico | Acción |
| --- | --- | --- |
| `NULL` / `NULL` / `NULL` | El conducto no existe. Toda llamada del webhook responde 503 y **no conserva nada** | Paso 1.2 |
| Presente / presente / `NULL` | Alguien reconcilió con `drizzle-kit push` y borró la traza forense | Paso 1.2 (rama B) |
| Presente / presente / presente | El conducto existe | Salte a §2 |

Si la versión desplegada es **anterior a 2.0.180**, este plan no aplica todavía: hay que desplegar 2.0.183 primero (§1.3).

### Paso 1.2 · Aplicar el esquema del conducto (5 min)

**Rama A — preferida.** Aplicar el artefacto consolidado, que es el único camino que el repositorio garantiza completo, en **una sola transacción** y con un rol propietario:

```bash
# En la máquina de despliegue, desde la raíz del repositorio
pnpm deploy:sql                      # regenera database/005_servicio_conversacional_listo.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
     -f database/005_servicio_conversacional_listo.sql
```

**Rama B — quirúrgica y mínima.** Si el consolidado no puede ejecutarse por conflicto con objetos existentes, aplicar **sólo** las tres migraciones del conducto, en orden, en una transacción. Son idempotentes (`CREATE TABLE IF NOT EXISTS`) y **autocertificadas**: cada una termina con su propio bloque de verificación, y `0035` imprime `GATE 0035 OK · traza del conducto autocertificada` cuando el objeto quedó correcto.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f drizzle/migrations/0035_transport_traces.sql \
  -f drizzle/migrations/0036_apichat_inbound_receipts.sql \
  -f drizzle/migrations/0037_candidate_processing.sql
```

**No use `pnpm db:push` para esto.** El diario de Drizzle termina en `0014_cognitive_governance`; `db:push` no aplica `0035`–`0037`. **No use `drizzle-kit push`**: reconciliaría la base contra `drizzle/schema.ts`, donde `conversation_transport_traces` no está declarada, y **borraría la traza** — el único instrumento que conserva la forma del cuerpo que envía ApiChat.

**Observable de éxito:** la consulta del paso 1.1 devuelve los tres nombres, y la traza responde a una escritura real (se comprobará en §3).

### Paso 1.3 · Desplegar 2.0.183 si la instancia está por debajo (variable)

```bash
docker inspect --format '{{.Image}}' <contenedor>     # digest real
docker run --rm <imagen> sh -c 'for b in antiword pdfinfo pdftoppm tesseract ffmpeg; do command -v $b || echo "FALTA $b"; done'
```

Los cinco binarios deben responder. Si alguno falta, la imagen desplegada no es la de 2.0.183: un PDF escaneado, un DOC heredado o un audio AMR/AAC/OPUS no podrán interpretarse (quedarán recibidos y en `no_aplica`).

### Paso 1.4 · Volumen persistente (obligatorio)

```bash
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} {{.Destination}}{{"\n"}}{{end}}' <contenedor>
```

Debe existir un volumen **con nombre** montado en `/app/data/knowledge-files`. Sin él, cada redespliegue pierde los bytes y el catálogo en PostgreSQL declara archivos que ya no existen: el visor responde `storage_missing` sobre documentos que sí se recibieron y analizaron.

---

## 2. T0 · Abrir las seis puertas de operación

**Ventana estimada:** 10 minutos. La recepción no ocurre si cualquiera de estas seis puertas está cerrada, y ninguna se anuncia sola.

| # | Puerta | Dónde se abre | Cómo se verifica | Si está cerrada |
| --- | --- | --- | --- | --- |
| 1 | **Capacidad de recepción** | `Configuración › WhatsApp` · interruptores general y de recepción | `capability_receive = true` y `agent_enabled = true` en `integration_settings`. En modo separado, el proceso `receptor` **no registra la ruta del webhook** si está apagado | El webhook no responde: el proveedor recibe error de conexión y no se asienta nada |
| 2 | **Modo de servicio coherente** | Variable `CONVERSATION_SERVICE_MODE` | `single` (proceso único, por omisión) o `split` (tres procesos: `receiver`, `engine`, `sender`). En `split`, cada uno se arranca con `node dist/services/receiver.js` etc., y **receptor y motor requieren el mismo volumen** | En `split`, el motor sin volumen responde `storage_missing` sobre documentos recibidos |
| 3 | **Secreto del webhook** | Variable `APICHAT_WEBHOOK_SECRET` + URL registrada en el panel de ApiChat | `POST /api/apichat/webhook?key=<secreto>` responde 200. Sin la variable, en producción responde **503**; con ella y sin `key`, **401** | Toda notificación se rechaza antes de tocar el conducto |
| 4 | **Modo nativo y credenciales** | `Configuración › WhatsApp` | `mode = native`, `client-id` y `token` validados, endpoint `/v1/messages` habilitado (es la fuente del sondeo de respaldo) | Sin `/v1/messages` no hay reconciliación: lo que el webhook pierda, se pierde |
| 5 | **Política de extensiones** | `Configuración › Conocimiento (RAG)` | Véase §2.1: la política debe admitir los cuatro formatos sujetos de estudio | El archivo se recibe, se muestra en la bandeja y **nunca entra al expediente** |
| 6 | **Destinatario** | Base de datos | Existe `applications` + `conversations` con `provider='apichat'` y estado `pendiente`/`activo` para el teléfono del candidato | El recibo reintenta 8 veces (≈21 min) y queda en `dead`, sin superficie de reproceso |

**Advertencia sobre la puerta 5 — la trampa silenciosa.** La migración `0037` amplía la política de fábrica a los formatos de audio **sólo si** el valor almacenado coincide exactamente con la lista anterior. Si la administración personalizó la lista en algún momento, la ampliación no se aplica y el audio de WhatsApp (`ogg`, `opus`, `amr`, `aac`, `m4a`) queda **fuera de política**: se recibe, se ve en la bandeja y no entra al expediente, con motivo `extension_not_allowed` que el informe del conducto **no cuenta** (H17). Es la causa más probable de «el audio no llega» sin ninguna pérdida real de transporte.

### 2.1 · Verificación de la política de extensiones (30 segundos)

```sql
SELECT setting_value AS extensiones_vigentes
  FROM integration_settings
 WHERE provider='knowledge' AND setting_key='allowed_extensions';
```

La política debe contener, como mínimo, los cuatro formatos sujetos de estudio:

| Formato | Extensiones necesarias |
| --- | --- |
| Imagen | `jpg, jpeg, png, webp` |
| PDF | `pdf` |
| Word | `doc, docx` |
| Audio | `ogg, opus, m4a, amr, aac, mp3, wav` |

Si falta alguna, habilitarla desde `Configuración › Conocimiento`. **Esta sola corrección puede ser la reparación completa** del síntoma «los archivos llegan a WhatsApp pero no al expediente».

### 2.2 · Formato de notificación del adjunto — la puerta que decide

**Reproducido y medido:** con el mismo PDF, el mismo teléfono y la misma conversación, **la forma en que el proveedor notifica el adjunto decide si el archivo llega a la bandeja o muere en la cola**. De cinco formas medidas, dos llegaron y tres no (§6.3 de la reauditoría).

| Forma notificada por el proveedor | Resultado medido |
| --- | --- |
| Base64 incrustado en el cuerpo | **Llega a la bandeja y al expediente** |
| URL `https://` remota | Llega sólo si el destino es público, sin credencial, sin redirección y responde antes de que caduque la firma |
| URL `http://` | **No llega: recibo agotado, bandeja vacía** |

**Acción:** en el panel de ApiChat, activar la notificación de adjuntos **en base64**. Es un cambio de configuración, sin despliegue, y convierte el transporte en autocontenido: deja de depender de un recurso remoto firmado y caducable.

**Cómo confirmar cuál está vigente, sin adivinar:**

```sql
-- La traza guarda la FORMA del cuerpo, no su contenido.
SELECT created_at, origin, outcome, provider_type, payload_bytes,
       (shape->'messages[0].url'->>'kind')  AS forma_del_campo_url,
       (shape->'messages[0].url'->>'bytes')::bigint AS peso_declarado
  FROM conversation_transport_traces
 ORDER BY created_at DESC LIMIT 20;
```

`forma_del_campo_url` igual a `contenido:<sha256>` indica una carga transportable; `texto` indica una cadena corta —típicamente una URL—. Si aparece una URL y el recibo correspondiente quedó en `dead`, la causa está identificada.

---

## 3. T0 · Prueba de vida con los cuatro formatos sujetos de estudio

**Ventana estimada:** 15 minutos. Se ejecuta **antes** de dar por vivo el conducto, con el teléfono del propio equipo y una postulación real de prueba.

**Advertencia metodológica:** un `GET` a `/api/apichat/webhook` devuelve el HTML del aplicativo. **Es lo esperado**: la ruta es sólo `POST`. Una prueba con `GET` no prueba nada y su resultado no debe leerse como fallo ni como éxito.

```bash
# 1) PDF con texto
curl -si -X POST "https://<host>/api/apichat/webhook?key=$APICHAT_WEBHOOK_SECRET" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"id":"vida-pdf-1","number":"<teléfono del equipo>","type":"document",
       "filename":"vida.pdf","mime_type":"application/pdf","from_me":false,
       "url":"data:application/pdf;base64,JVBERi0xLjQKJSB2aWRhCg=="}]}'
# 2) Word, 3) audio y 4) imagen: misma forma con type file/audio/image y su MIME real,
#    sustituyendo el contenido por el base64 del archivo de prueba.
```

**Observable de éxito, en este orden exacto:**

```sql
-- A. El recibo se conservó antes del acuse y llegó a término
SELECT provider_message_id, origin, status, outcome, attempts, last_error
  FROM apichat_inbound_receipts ORDER BY received_at DESC LIMIT 4;

-- B. El mensaje se asentó con su medio, su documento y su estado de interpretación
SELECT m.provider_message_id, m.message_type,
       m.metadata->'media'->>'fileName'              AS archivo,
       m.metadata->'media'->>'processingOutcome'     AS ingreso,
       m.metadata->'media'->>'processingReason'      AS motivo,
       k.id AS documento, k.analysis_status, k.processing_error_code
  FROM conversation_messages m
  LEFT JOIN candidate_knowledge_files k ON k.id::text = m.metadata->'media'->>'candidateFileId'
 WHERE m.provider_message_id LIKE 'vida-%' ORDER BY m.created_at;

-- C. La traza conserva la forma del cuerpo
SELECT id, origin, outcome, provider_type, payload_bytes, created_at
  FROM conversation_transport_traces ORDER BY created_at DESC LIMIT 4;

-- D. El diagnóstico declara el eslabón real y no una ausencia
--    (superficie: Auditoría del canal de ApiChat → sección CONDUCTO DEL ADJUNTO)
```

**Criterio de aceptación de la prueba de vida:**

| Resultado esperado | Significado |
| --- | --- |
| `status='completed'`, `outcome='registrado'` en los cuatro | El conducto recibió y asentó |
| `processingOutcome='accepted'` y `k.id` no nulo en los cuatro | El expediente incorporó los cuatro formatos |
| `analysis_status='analizado'` en PDF con texto, DOCX, audio y captura legible | El motor podrá usar la evidencia |
| `analysis_status='no_aplica'` en un PDF escaneado | Correcto: conservado y sin OCR; **no** es ausencia |
| `outcome <> 'forma-no-reconocida'` | El adaptador entendió el sobre del proveedor |

Si algún formato falla, la causa queda **localizada por la propia consulta** (motivo de ingreso, código de error del documento, desenlace del recibo), sin necesidad de hipótesis.

---

## 4. T1 · Las cinco reparaciones de instrumento y recuperación

**Ventana estimada:** una jornada de trabajo. **No condicionan la recepción**: la puesta en vivo de §1–§3 puede ocurrir el mismo día y estas reparaciones después. Se ordenan por relación beneficio/riesgo.

| Orden | Reparación | Archivo | Cierra | Riesgo |
| --- | --- | --- | --- | --- |
| R1 | Registrar `0035`–`0037` en el diario de Drizzle y **declarar `conversation_transport_traces` en `drizzle/schema.ts`** | `drizzle/migrations/meta/_journal.json`, `drizzle/schema.ts` | H23 | Bajo |
| R2 | Contar los rechazos de ingreso derivados del mensaje y añadir el estado `ingreso_rechazado` con precedencia anterior a `sin_pendientes` | `server/attachmentPipeline.ts` | H17 | Bajo |
| R3 | Asentar `code` y `retryable` del error de transporte en `last_error`, y honrar `retryable` en la política de reintento | `server/apiChatReceipts.ts`, `server/base64Transport.ts` | H18 | Medio: cambia la política de reintentos |
| R4 | Registrar las claves presentes del cuerpo (`contentFieldsPresent`) cuando el contenido no se resuelve, con referencia a la traza | `server/apiChatWebhook.ts`, `server/inbox.ts` | H19 | Bajo |
| R5 | Procedimiento administrativo acotado de reproceso sobre un recibo `dead`/`rejected`, con asiento en `audit_log` | `server/apiChatReceipts.ts`, `server/routers.ts`, hoja de auditoría | H21 | Medio: escribe sobre la cola; debe ser idempotente |

**R1 es la más urgente de las cinco** y no por elegancia: mientras `conversation_transport_traces` no esté declarada, cualquier operador que ejecute `drizzle-kit push` —el reflejo habitual para sincronizar un esquema— **destruye la evidencia forense** acumulada. Y la resolución del incidente del PDF depende de esa evidencia.

**Criterio de aceptación conjunto:** las cuatro reparaciones de lectura se verifican con casos de caja negra sobre la instancia aislada ya existente (`MEDIA_TEST_DATABASE_URL`), sin tocar producción. R5 exige, además, un caso que demuestre que dos reprocesos del mismo recibo no duplican mensaje ni documento.

**Ceremonia de entrega del repositorio (no omitir):** cada incremento de código del artefacto se audita por conteo literal de archivos y por contenido documental. Antes de cerrar una entrega:

```bash
pnpm check && pnpm test && pnpm text:verify && pnpm release:verify && pnpm deploy:sql
```

---

## 5. T1 · Recuperación del expediente del candidato del incidente

**Objetivo:** que el candidato no tenga que reenviar nada que el sistema pueda recuperar, y que su evaluación posterior no quede incompleta por una falla de transporte.

| Paso | Acción | Regla |
| --- | --- | --- |
| 5.1 | Obtener el ID del mensaje del PDF y la postulación interna | La cita posterior y la miniatura **no** sustituyen al mensaje original |
| 5.2 | Ejecutar `consultas_solo_lectura.sql` Q7–Q10 con esos parámetros | Sólo lectura; conservar el resultado con acceso restringido |
| 5.3 | Clasificar el desenlace con el árbol de decisión de §7 de la reauditoría | La primera puerta con evidencia positiva explica las posteriores |
| 5.4 | Si el original existe en ApiChat (historial conservado), reprocesarlo con su **identidad original** | Nunca inventar fila con fecha o ID atribuidos al candidato |
| 5.5 | Si el vínculo documental es inferido, declararlo como tal | Un hash demuestra correspondencia de bytes, no origen ni momento |
| 5.6 | Si el original se perdió, comunicar el estado real al candidato y solicitar el envío **con el conducto ya verificado** | Pedir un reenvío antes de §3 repite la falla y la atribuye a la persona |

**Corrección de conducta, no de código:** mientras un archivo esté `pendiente`, `no_aplica` o `error`, el agente conversacional debe declarar el estado —el contexto ya lo instruye— y **no** afirmar que el candidato no envió. Esa instrucción existe desde 2.0.182; su cumplimiento debe verificarse en la prueba de §3, no darse por hecho.

---

## 6. T2 · Vigilancia: ocho indicadores con umbral

**Ventana estimada:** una semana de observación. Cada indicador tiene una consulta y un umbral; sin umbral, un número no es un indicador.

| # | Indicador | Consulta | Umbral de alerta |
| --- | --- | --- | --- |
| 1 | Latencia de acuse | `received_at` menos marca del proxy | > 5 s |
| 2 | Cola de recepción abierta | `count(*) WHERE status IN ('pending','processing','retry')` | > 0 sostenido 5 min |
| 3 | Recibos agotados | `count(*) WHERE status='dead'` | **> 0 ⇒ investigar el mismo día** |
| 4 | Rechazos de ingreso al expediente | `metadata->'media'->>'processingOutcome'='rejected'` agrupado por motivo | > 0 ⇒ revisar política (puerta 5) |
| 5 | Documentos conservados sin texto | `analysis_status='no_aplica'` agrupado por `processing_error_code` | `decoder_unavailable` > 0 ⇒ falta un binario |
| 6 | Documentos con error técnico | `analysis_status='error'` agrupado por código | > 0 ⇒ revisar |
| 7 | Reproducciones evitadas | recibos con `attempts > 1` y desenlace terminal | Tendencia creciente ⇒ inestabilidad del proveedor o del destino |
| 8 | Conducto cerrado con rechazos | `ingreso_rechazado` (una vez aplicada R2) | Cualquier valor ⇒ el informe no debe decir «sin pendientes» |

**Dos advertencias de lectura, aprendidas en esta auditoría:**

- **Cero trazas no significa que el proveedor no llamó.** Significa que la recepción no fue observada. La consulta fallida se declara `observabilidad_no_disponible` y no debe leerse como ausencia.
- **«Recibido» no significa «interpretado ni identificado como CV».** Son estados distintos y el tablero debe mostrarlos separados.

---

## 7. Criterios de cierre y de reversión

### Cierre de la puesta en vivo (T0)

Se considera viva cuando, y sólo cuando:

1. Los tres objetos del conducto existen en la base productiva.
2. Los cuatro formatos sujetos de estudio superan la prueba de §3 con `analysis_status` real por formato.
3. **El archivo de prueba recorre la misma forma que usa el proveedor en producción.** Una prueba con base64 incrustado acredita el conducto, no el camino real: si el proveedor notifica URL, hay que probar con URL o activar base64 en el panel (§2.2).
4. Un archivo de prueba recorre: recibo → mensaje → documento → extracción → contexto del motor, con identificadores correlacionados.
5. El agente, ante un archivo `pendiente`, declara el estado en lugar de negar la recepción.
6. `SELECT count(*) FROM apichat_inbound_receipts WHERE status='dead'` es cero para los envíos de la prueba.

### Reversión

| Incisión | Reversión |
| --- | --- |
| Migraciones del conducto | Los objetos son **aditivos**: no alteran ni eliminan filas. La reversión es detener el despliegue, no deshacer el esquema. **No** ejecute `drizzle-kit push` para «volver atrás»: borraría la traza |
| Despliegue de imagen | Restaurar la imagen anterior por digest. Los archivos ya recibidos permanecen en el volumen |
| Interruptores del panel | Volver el estado previo de `capability_receive` / `agent_enabled`. El proceso permanece vivo e inactivo, y lo declara en la bitácora |
| Reparaciones R2–R5 | Revertir el commit del incremento. Ninguna toca datos existentes |

### Lo que no debe hacerse

| Anti-práctica | Por qué |
| --- | --- |
| Comprar servidores o ampliar el plan | No existe una sola medición que lo justifique. El cuello de botella es de aplicabilidad y de proyección, no de capacidad |
| Ejecutar `drizzle-kit push` | Elimina la traza forense (la tabla no está declarada en el esquema) |
| Ejecutar `pnpm db:push` para «migrar todo» | El diario termina en `0014`: no aplica el conducto y crea la falsa impresión de haber migrado |
| Dejar la notificación del proveedor en URL remota | Demostrado: con URL el PDF sólo llega si el destino es público, TLS, sin credencial, sin redirección y responde antes de que caduque la firma. Tres de cinco formas medidas terminan en `dead` con la bandeja vacía. La notificación en base64 es la mitigación inmediata, y no debilita ninguna guarda |
| Pedir al candidato que reenvíe antes de §3 | Repite la falla y la atribuye a la persona |
| Relajar la guarda de destinos HTTPS públicos | Introduce riesgo de SSRF a cambio de nada: la causa del incidente se resuelve por traza, no bajando el control |
| Declarar cerrado el caso sin la traza | Un recibo `completed` con `processingOutcome='rejected'` prueba que llegó y fue rechazado, no que se interpretó |

---

## 8. Cronograma y responsabilidades

| Fase | Duración | Ejecuta | Verifica |
| --- | --- | --- | --- |
| T0 · §1 esquema y volumen | 15 min | Operación de plataforma | Auditoría (consultas) |
| T0 · §2 puertas y política | 10 min | Administración del artefacto | Auditoría |
| T0 · §3 prueba de vida | 15 min | Administración + ingeniería | Auditoría (observables de base) |
| T1 · §4 reparaciones R1–R5 | 1 jornada | Ingeniería | Caja negra con PostgreSQL real |
| T1 · §5 recuperación del caso | 2 h | Ingeniería + RR. HH. | Auditoría |
| T2 · §6 vigilancia | 1 semana | Operación | Auditoría |

**Total hasta recepción viva: menos de una hora de ventana.** Las reparaciones R1–R5 y la recuperación del caso son posteriores y no bloquean la recepción.

---

## 9. Enunciado del resultado esperado

Al cerrar T0, el artefacto del cliente recibe **audio, PDF, Word e imagen** por el webhook de ApiChat y los conserva con su procedencia, su huella y su estado. Al cerrar T1, además **sabe por qué** un archivo no llegó o no se interpretó, y **puede recuperarlo** sin intervención manual sobre la base. Al cerrar T2, la operación puede observar esa cadena sin depender de la inspección del código.

La evaluación del candidato deja de depender de una hipótesis: podrá explicar qué evidencia recibió, cuál utilizó y qué limitación técnica existía. Ese es el cierre funcional del encargo.

---

## Referencias

American Psychological Association. (2020). *Publication manual of the American Psychological Association* (7.ª ed.). https://www.apa.org/pubs/books/publication-manual-7th-edition-paperback

ApiChat. (s. f.). *OpenAPI specification* (versión 1.7). https://panel.apichat.io/openapi.yaml?version=1.7

Kent, K., Chevalier, S., Grance, T., & Dang, H. (2006). *Guide to integrating forensic techniques into incident response* (NIST SP 800-86). National Institute of Standards and Technology. https://csrc.nist.gov/pubs/sp/800/86/final
