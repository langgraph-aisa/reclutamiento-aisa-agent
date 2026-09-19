# Validación de credencial y de tiempos · instancia AISA #32146

**Fecha:** 18 de septiembre de 2026.
**Evidencia nueva:** (a) tabla `conversation_transport_traces` con la forma de los registros descartados; (b) lista de tablas del esquema `public` de la base `hiring-database-testing`.
**Complementa a:** [plan_post_auditoria.md](plan_post_auditoria.md).

---

## 1. Estado real del esquema: va **por delante** del código

La lista de tablas de su instancia muestra `apichat_inbound_receipts`, `apichat_history_cursors`, `candidate_document_jobs` y `conversation_transport_traces`. El origen de cada una está verificado en el historial del repositorio:

| Migración | Commit que la introduce | Versión |
| --- | --- | --- |
| `0035_transport_traces` | `b450bdb` | **2.0.179** |
| `0036_apichat_inbound_receipts` | `8888768` | **2.0.180** |
| `0037_candidate_processing` | `8888768` | **2.0.180** |

Y el código desplegado es 2.0.179, identificado por la firma `no-procesado` (§1 de `plan_post_auditoria.md`). Conclusión:

> **Alguien aplicó el artefacto consolidado de 2.0.183 sobre una instancia que sigue ejecutando el código de 2.0.179.** El esquema está preparado; falta el binario.

**Consecuencia práctica, y es buena noticia:** el **paso 2 del plan (crear las tablas) ya está hecho**. Los pasos que quedan son tres: la credencial, la URL y el despliegue. Las tablas ociosas no estorban al código viejo: nadie las consulta.

---

## 2. La credencial y la URL — procedimiento

### 2.1 · Generar el secreto

```bash
openssl rand -hex 32
```

Se elige **hexadecimal** por una razón técnica, no estética: `authorized()` compara con `timingSafeEqual`, que exige **longitudes iguales**, y el valor viaja dentro de la URL. Un secreto en base64 puede contener `+`, `/` y `=`, que exigirían codificación porcentual y son fuente de errores al copiarlo entre el panel y la variable. Sesenta y cuatro caracteres hexadecimales son URL-seguros sin transformación y aportan 256 bits de entropía.

### 2.2 · La URL resultante

Sustituya `<SECRETO>` por el valor anterior:

```text
https://hiring-testing-reclutamiento-aisa-agent.ujrimm.easypanel.host/api/apichat/webhook?key=<SECRETO>
```

Para no hacer circular el secreto por un canal escrito, este comando lo genera y compone la URL **en su propio terminal**, sin copiarlo a ningún documento:

```bash
SECRETO=$(openssl rand -hex 32)
printf 'APICHAT_WEBHOOK_SECRET=%s\n%s/api/apichat/webhook?key=%s\n' \
  "$SECRETO" \
  "https://hiring-testing-reclutamiento-aisa-agent.ujrimm.easypanel.host" \
  "$SECRETO"
```

**Advertencia de manejo.** Un secreto que se imprime en una conversación, una captura o un documento queda comprometido y debe rotarse. Por eso aquí se entrega el procedimiento y no un valor: no hay ningún motivo para que yo conozca el secreto de su instancia.

### 2.3 · Qué verifica la ruta, exactamente

| Comprobación | Comportamiento |
| --- | --- |
| `APICHAT_WEBHOOK_SECRET` ausente y `NODE_ENV=production` | **503** en toda llamada |
| Secreto presente, `?key=` ausente o distinto | **401** |
| Longitud distinta entre secreto y valor recibido | **401** (la comparación exige longitudes iguales) |
| Secreto presente y `?key=` idéntico | Procesa y responde 200 |
| Cabecera alternativa | `x-webhook-token` con el mismo valor |

**Nota de secuencia:** la URL vieja, sin `?key=`, era correcta para 2.0.179 porque esa versión no autenticaba la ruta. En cuanto despliegue 2.0.180 o superior, esa misma URL devolverá 401. **Las dos operaciones —definir la variable y corregir la URL— deben ocurrir antes del despliegue.**

### 2.4 · Prueba de la credencial antes de desplegar

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://hiring-testing-reclutamiento-aisa-agent.ujrimm.easypanel.host/api/apichat/webhook?key=<SECRETO>" \
  -H 'content-type: application/json' -d '{"messages":[]}'
```

Con el código viejo el resultado es 200 (no autentica); con el nuevo, 200 sólo si la credencial coincide. Un `GET` a la misma ruta devuelve el HTML del aplicativo: **no es una prueba válida**.

---

## 3. Auditoría de la cadena de tiempos

La pregunta es si los tiempos alcanzan para procesar la cola **sea cual sea el tamaño del archivo**. La respuesta corta: **el acuse HTTP no depende del tamaño; el trabajador sí, y ahí hay dos valores que conviene ajustar.**

| Etapa | ¿Depende del tamaño? | Valor declarado | Dónde |
| --- | --- | --- | --- |
| Acuse del webhook | **No** | Sin timeout propio (Express + proxy) | `apiChatWebhook.ts` |
| Cuerpo aceptado | Sí | 50 MB de JSON | `_core/index.ts` |
| Descarga del adjunto (sólo si la carga es URL) | Sí | **20 s** · máx. 30 MB | `base64Transport.ts:701`, `apiChatWebhook.ts:72` |
| Decodificación base64 | Marginal | Local; sin red | `base64Transport.ts` |
| Reclamo de recibo estancado | No | 5 min | `apiChatReceipts.ts:59` |
| Barrido de recibos | Sí | 10 por pasada, **secuencial**, intervalo 1 s sin solape | `apiChatReceipts.ts:50` |
| Extracción / OCR | Sí | comando 90 s · OCR total 180 s · 20 páginas · texto 120 000 caracteres | `documentExtraction.ts:11,112` |
| Trabajo documental | Sí | lease **8 min** · 2 por pasada · máx. 3 intentos | `candidateDocumentWorker.ts:33` |
| Sondeo del historial | Sí | **15 s** por página de 50 registros, con 15 s entre rondas | `inboxSync.ts:62` |
| Reintentos del recibo | No | `min(3600, 5·2^n)` s, agota en 8 intentos ≈ **21 min** | `apiChatReceipts.ts` |

### 3.1 · El hallazgo central: el acuse está desacoplado

El controlador del webhook **no descarga ni interpreta nada**: escribe el lote en `apichat_inbound_receipts`, registra la traza y responde. Por tanto, **el tiempo de respuesta es independiente del peso del archivo**, y con base64 activado —su caso— la carga viaja en el cuerpo y **ninguna descarga ocurre**. El tamaño no puede tumbar el acuse.

### 3.2 · Descarga: 20 s es corto para 30 MB

Hoy `decodeRemoteAttachment` se invoca **sin `timeoutMs`**, de modo que toma el valor por omisión de 20 segundos. Treinta megabytes en veinte segundos exigen **12 Mbps sostenidos** hasta el proveedor. Por debajo de esa velocidad el recibo falla y **se reintenta 8 veces, agotando la misma ventana**:

**Con `timeoutMs` proporcional al límite declarado**, la espera admite enlaces modestos sin dejar de acotar el cuelgue:

| Velocidad sostenida | 30 MB requieren |
| --- | --- |
| 2 Mbps | 120 s |
| 4 Mbps | 60 s |
| 10 Mbps | 24 s |

Recomendación: `timeoutMs: 120_000` —dos minutos— en la invocación del receptor. Con base64 esta ruta no se usa; el ajuste protege el día en que se reciba por URL.

### 3.3 · Barrido secuencial: un archivo lento bloquea la cola

`runApiChatReceiptSweep` recorre hasta diez recibos **con `await` uno tras otro**, y el intervalo de un segundo no se solapa (`if (running) return`). Con descargas de hasta 20 s, una sola pasada puede durar **hasta 200 s** y el ingreso efectivo cae a un archivo cada veinte segundos. Con base64 cada elemento tarda milisegundos y el cuello se traslada al disco y a la IA, no a la red.

Recomendación: permitir un paralelismo acotado —cuatro recibos en vuelo— cuando la carga sea remota. Con base64 no es urgente, pero es la diferencia entre drenar una cola y arrastrarla.

### 3.4 · Amplificación de transferencia en el sondeo — hallazgo nuevo

El puente de sondeo construye sus páginas así: **en cada ronda obtiene la página 0** —los cincuenta registros más recientes— y, además, una página histórica; y repite cada quince segundos.

Con `Notify attachments in base64 format` activado, esos cincuenta registros **incluyen las cargas codificadas**. Es decir: los mismos megabytes se vuelven a transferir del proveedor a la aplicación **cada quince segundos, indefinidamente**. Los mensajes no se duplican —la clave de recibo es idempotente— pero el tráfico se multiplica, y el límite de **15 s** para esa descarga puede abortar la ronda.

No rompe la recepción —el webhook ya la resolvió—, pero es un costo real y creciente con el tamaño. **Medición para confirmarlo, sin suposiciones:**

```bash
curl -s -o /dev/null -w 'bytes=%{size_download} tiempo=%{time_total}s\n' \
  -H "accept: application/json" -H "client-id: 32146" -H "token: <TOKEN>" \
  "https://api.apichat.io/v1/messages?limit=50&page=0"
```

Si el resultado supera unos pocos megabytes o el tiempo roza los quince segundos, procede una de estas tres medidas: reducir `limit`, filtrar el historial con los parámetros que el contrato publica (`number`, `messageId`, `fromMe`) para no traer cargas ya conocidas, o mantener la notificación en base64 **sólo para el webhook** si el proveedor permite separar ambas representaciones.

### 3.5 · Límite del cuerpo frente al lote

`express.json` acepta 50 MB. El base64 de 30 MB ocupa 40 MB, así que **un solo archivo máximo cabe con poco margen**; dos adjuntos de 25 MB en una misma notificación (66 MB) recibirían un **413 del analizador de cuerpo antes de llegar a la cola**, sin asiento de recibo. Recomendación: elevar el límite del cuerpo a 100 MB o declarar explícitamente que la notificación trae un adjunto por mensaje.

### 3.6 · Trabajo documental: el lease de 8 min

El peor caso legítimo es OCR (hasta 180 s) + transcripción + análisis. Si la suma supera los ocho minutos, otro trabajador reclama el trabajo; el bloqueo por asesoría `137` impide el análisis duplicado y devuelve el intento como `processing_busy`, de modo que **no hay corrupción, pero sí demora**. Recomendación: elevar el lease a quince minutos, o renovarlo entre etapas.

### 3.7 · Correcciones aplicadas el 19 de septiembre de 2026

Se aplicaron en el árbol y se verificaron. **Compilación estricta en cero errores; 153 pruebas unitarias y 17 de caja negra HTTP/PostgreSQL en verde.**

| Corrección | Archivo | Efecto |
| --- | --- | --- |
| Ventana de descarga de 20 s a **120 s** | `server/apiChatWebhook.ts` | 30 MB admiten enlaces de 2 Mbps sin agotar los ocho intentos |
| Lease del trabajo documental de 8 a **15 min** | `server/candidateDocumentWorker.ts` | El peor caso —OCR, transcripción y análisis— cabe dentro del reclamo |
| **Motivo tipado en el asiento de recepción** | `server/apiChatReceipts.ts`, `server/apiChatWebhook.ts`, `server/base64Transport.ts` | Un recibo agotado declara su causa y su condición de reintento |

El tercero es el que cambia la capacidad de diagnóstico. Antes, un recibo muerto guardaba `AttachmentTransportError`; ahora guarda la causa y su naturaleza, medido con la reproducción del expediente:

| Caso | `last_error` antes | `last_error` ahora |
| --- | --- | --- |
| Destino no público | `AttachmentTransportError` | `unsafe_destination:permanente` |
| Falla de red o DNS | `AttachmentTransportError` | `network_error:reintentable` |
| Contenido no resoluble | `Error` | `content_unresolved:permanente` |

**Lo que deliberadamente no se cambió, y por qué:**

- **La política de reintentos.** El asiento ya declara si el fallo es permanente, pero se sigue reintentando ocho veces en todos los casos. Acortar el ciclo de lo permanente cambia el comportamiento del conducto durante una puesta en vivo, y la decisión debe tomarse con la cola observable en producción, no antes.
- **El paralelismo del barrido.** Introducir concurrencia en la cola durable el mismo día del despliegue es riesgo sin beneficio: con la carga en base64 no hay descarga y cada elemento tarda milisegundos.
- **El límite de 50 MB del cuerpo.** Cubre un archivo del tamaño máximo. Elevarlo multiplica la memoria del proceso ante un cuerpo hostil; la alternativa correcta es declarar que la notificación trae un adjunto por mensaje.

---

## 3.8 · Nota sobre los nombres de variable de su captura

La captura del entorno muestra variables heredadas de la etapa n8n que **el runtime actual no consulta**: `APICHAT_API_MODE`, `APICHAT_API_ENDPOINT`, `APICHAT_CLIENT_ID`, `APICHAT_TOKEN`, `APICHAT_CONNECT_TO`, `APICHAT_WEBHOOK_URL`, `N8N_MANUAL_STATUS_WEBHOOK_URL`, `N8N_AGENT_EVALUATION_URL`. Las credenciales efectivas de ApiChat viven cifradas en `integration_settings` y se administran desde `Configuración › WhatsApp`.

Dos observaciones con consecuencia práctica:

1. **`APICHAT_CLIENT_ID=32107` no coincide con la cuenta del panel, `#32146`.** Es inerte —el código no lo lee—, pero es una discrepancia que puede inducir a error a quien la consulte. Conviene retirarla o corregirla.
2. **La dirección pública de los archivos salientes se declara con `APICHAT_PUBLIC_BASE_URL`**, no con `APICHAT_WEBHOOK_URL` (`server/inbox.ts:841`). Si se desea que la bandeja anuncie los archivos con el host público en lugar de deducirlo de la petición, el nombre correcto es aquél.

Sus 16 trazas demuestran, además, un hecho positivo: **provienen de `GET /v1/messages`, de modo que las credenciales efectivas del panel son válidas y el proveedor responde.** La configuración de ApiChat no es el problema.

---

## 4. Por qué la traza vieja no muestra el campo del contenido

Sus resultados son claros y la causa está identificada: para cada registro descartado aparecen nueve claves de primer nivel —`delivered_date`, `external_id`, `from_me`, `message`, `played_date`, `read_date`, `receive_error`, `send_error`, `sent_date`— y **`message` figura como `objeto`, sin descendientes.**

Eso confirma el hallazgo H13 de la auditoría de 2.0.179: **aquel instrumento no recorría objetos anidados.** El contenido viaja dentro de `message`, y la traza vieja no lo abrió. De ahí que la ruta del contenido aparezca como una sola fila opaca.

Dos consecuencias útiles:

1. **El sobre del proveedor es `{…, message:{…}, …}`**, y el adaptador de 2.0.183 lo entiende: `normalizeApiChatMessage` lee `container.message ?? container`. No hay incompatibilidad de forma.
2. **Tras desplegar, la traza nueva sí descenderá** y mostrará `message.url`, `message.type`, `message.filename`. Eso convierte la verificación de la reparación en una consulta:

```sql
SELECT created_at, outcome, provider_type,
       campo.key AS ruta, campo.value->>'kind' AS tipo,
       (campo.value->>'bytes')::bigint AS bytes
  FROM conversation_transport_traces t
  CROSS JOIN LATERAL jsonb_each(COALESCE(t.shape,'{}'::jsonb)) AS campo(key,value)
 WHERE campo.key LIKE 'message.%'
 ORDER BY created_at DESC LIMIT 60;
```

Si `message.url` aparece como `contenido:<sha256>`, el contenido fue reconocido y la recepción quedó cerrada.

---

## 5. Plan actualizado — quedan tres pasos

| # | Paso | Estado |
| --- | --- | --- |
| 1 | Respaldo de la base | Pendiente (recomendado) |
| 2 | ~~Aplicar el esquema del conducto~~ | **Hecho**: las tres tablas existen |
| 3 | Definir `APICHAT_WEBHOOK_SECRET` | Pendiente — §2.1 |
| 4 | Añadir `?key=` a la URL del webhook en el panel | Pendiente — §2.2 |
| 5 | Desplegar 2.0.183 | Pendiente |
| 6 | Prueba de vida con los cuatro formatos | Pendiente |
| 7 | Dejar que el sondeo reconcilie el historial | Pendiente |
| 8 | Ajustar `timeoutMs` de descarga y evaluar paralelismo y lease (§3) | Recomendado, no bloqueante |

**Y una precisión de alcance:** la evidencia proviene de la base `hiring-database-testing` del proyecto `hiring-testing`. Es un entorno de pruebas. Si el artefacto del cliente final vive en otro proyecto, **este diagnóstico debe repetirse allí**: la firma `no-procesado`, la lista de tablas y la URL del webhook son tres comprobaciones de un minuto y determinan si el mismo cuadro se reproduce.

---

## Referencias

American Psychological Association. (2020). *Publication manual of the American Psychological Association* (7.ª ed.). https://www.apa.org/pubs/books/publication-manual-7th-edition-paperback

ApiChat. (s. f.). *OpenAPI specification* (versión 1.7). https://panel.apichat.io/openapi.yaml?version=1.7
