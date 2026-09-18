# Validación académica de la reparación del transporte de adjuntos (ApiChat) — Talento AISA

**Objeto:** evaluar, con métodos verificables y contra el [informe de auditoría](informe.md) (hallazgos H01–H16 y sus criterios de aceptación), la solución implementada por el agente de reparación para el transporte de PDF, Word y audio entre WhatsApp/ApiChat y la bandeja de JARVI RH.

**Fecha de corte:** 18 de septiembre de 2026.
**Alcance de esta validación:** análisis estático, compilación de tipos, suite unitaria y ejecución de las pruebas de caja negra HTTP/PostgreSQL sobre una instancia local aislada (PostgreSQL 16 en contenedor) con datos sintéticos.
**Naturaleza:** validación de la solución en el árbol de trabajo; no constituye certificación del despliegue ni atribución del incidente fotografiado.

---

## 1. Dictamen

La solución **aborda de forma coherente y verificable el recorrido troncal** descrito en H01–H16: introduce un adaptador contractual canónico, recepción durable antes del acuse, un trabajador con reclamo y lease, una identidad común de adjunto, proyección correcta en la bandeja, extracción/transcripción/OCR integrada al análisis y una observabilidad que distingue «no observado» de «cero». La caja negra HTTP/PostgreSQL —inejecutable durante la sesión de reparación— **pasa las 13 pruebas** una vez subsanados los defectos que se detallan abajo.

Sin embargo, la solución **no fue entregada en estado funcional**: tal como quedó, (a) no compilaba (`tsc --noEmit` fallaba), y (b) no registraba ningún mensaje contra una base PostgreSQL real, por una inconsistencia de inferencia de tipos de un parámetro SQL. Ambos son defectos de ejecución, no estilísticos, y contradicen la pretensión de «funcionando al 100 %». Además, la solución dejó **19 pruebas legadas sin migrar** y **6 verificaciones de gobernanza de release con deriva documental**, y el artefacto SQL de despliegue desactualizado.

**Veredicto:** la arquitectura de la reparación es académicamente correcta y se demuestra funcional en caja negra; la entrega, en cambio, estuvo incompleta y con dos regresiones de ejecución que esta validación detectó y reparó. Quedan pendientes la migración de las pruebas legadas, la sincronización documental del release y las evidencias que solo puede aportar el despliegue real (binarios de OCR/audio, configuración efectiva del webhook, correlación histórica del incidente).

---

## 2. Método y niveles de evidencia

Se reutiliza la clasificación del informe original:

| Nivel | Significado |
| --- | --- |
| C — Código | Se demuestra siguiendo instrucciones y esquema versionados |
| R — Reproducción local | Una entrada determinista produce un resultado en la función real |
| E — Ejecución de caja negra | Comportamiento observado por HTTP + PostgreSQL aislados |
| K — Contrato | Consta en el OpenAPI oficial recuperado |
| H — Hipótesis | Explicación compatible, pendiente de correlación histórica |
| D — Diseño | Decisión de ingeniería derivada de los hallazgos |

Se ejecutaron, en este entorno:

1. `tsc --noEmit` (compilación estricta de TypeScript).
2. `vitest run` (suite unitaria completa; los tres archivos que exigen PostgreSQL quedan omitidos sin la variable de entorno).
3. Caja negra con PostgreSQL real: `MEDIA_TEST_DATABASE_URL=postgres://postgres:…@127.0.0.1:55432/postgres_test node … vitest run server/attachments.blackbox.test.ts server/candidateProcessing.postgres.test.ts server/transportObservability.postgres.test.ts`.
4. `node scripts/build-conversation-deployment-sql.mjs --check` (integridad del SQL de despliegue consolidado).

La instancia PostgreSQL fue efímera (contenedor `postgres:16-alpine`), con base cuyo nombre termina en `_test` y datos sintéticos; no se tocó producción ni se usó `DATABASE_URL`.

---

## 3. Defectos de ejecución detectados en la entrega y reparados

### D1 — La solución no compilaba (`tsc --noEmit`)

**Evidencia:** C/R. `server/inboxSync.ts:37` declaraba `let client: Awaited<ReturnType<Pool["connect"]>>;`. La indexación `Pool["connect"]` de `pg` resuelve la **última** sobrecarga (la variante con callback, que devuelve `void`), por lo que `client` quedaba tipado `void` y se producían 7 errores `TS2322`/`TS2339`. `tsc --noEmit` terminaba con `EXIT=2`.

**Reparación:** importar `PoolClient` y declarar `let client: PoolClient;`. Tras la corrección, `tsc --noEmit` termina con `EXIT=0`.

### D2 — No registraba ningún mensaje contra PostgreSQL real (parámetro SQL con tipo inconsistente)

**Evidencia:** R. `server/inbox.ts` (INSERT en `conversation_messages`) reutilizaba el parámetro `$2` (`direction`) a la vez como valor de una columna `varchar(16)` y dentro de `CASE WHEN $2='outbound' …`, donde PostgreSQL lo deduce como `text`. El motor responde `inconsistent types deduced for parameter $2`. Consecuencia observada en la reproducción: `runApiChatReceiptSweep` devolvía `{ completed: 0, failed: 2 }`, los recibos quedaban en `status='retry', last_error='error'` y la bandeja permanecía vacía **para todo mensaje**, texto o adjunto.

**Reparación:** calcular `sent_at` en JavaScript (`input.direction === "outbound" ? (providerTime ?? now()) : null`) y pasarlo como `$14::timestamptz`, eliminando el `CASE` que reutilizaba `$2`. Tras la corrección, la caja negra registra correctamente texto y archivo.

### D3 — La prueba de aceptación del análisis documental tenía una firma de mock incorrecta

**Evidencia:** R. `server/attachments.blackbox.test.ts` («el PDF real pasa de pendiente a analizado») declaraba el mock como `(input: { text: string })`, pero `analyzeKnowledgeDocument` se invoca `(pool, fileId, text, options)`; el primer argumento era el pool, `input.text` era `undefined` y la aserción fallaba, dejando el documento en estado `error`.

**Reparación:** corregir la firma a `(_pool, _fileId, text)`. Tras la corrección, el caso verifica que el texto extraído contiene «Software engineer» y que el estado pasa a `analizado`.

### D4 — Artefacto de despliegue desactualizado

**Evidencia:** R. `node scripts/build-conversation-deployment-sql.mjs --check` fallaba: `database/005_servicio_conversacional_listo.sql` no incluía las migraciones `0036_apichat_inbound_receipts.sql` y `0037_candidate_processing.sql`.

**Reparación:** regenerar el artefacto (1 602 líneas). Tras la regeneración, el chequeo queda sincronizado.

---

## 4. Resultados de ejecución

| Verificación | Resultado antes de esta validación | Resultado tras las reparaciones D1–D4 |
| --- | --- | --- |
| `tsc --noEmit` | 7 errores (EXIT 2) | **0 errores (EXIT 0)** |
| Caja negra HTTP/PostgreSQL (3 archivos) | 7 fallidas / 6 pasadas | **13/13 pasadas** |
| `deploy:sql --check` | desactualizado (EXIT 1) | **sincronizado (EXIT 0)** |
| Suite unitaria completa | 26 fallidas / 519 pasadas | 25 fallidas / 520 pasadas / 13 omitidas |

La suite unitaria completa conserva 25 fallos, desglosados así:

| Archivo | Fallos | Clasificación |
| --- | --- | --- |
| `server/inboxSync.test.ts` | 12 | Pruebas legadas: referencian `InboxSyncRecorder` e inyectan `recorder`, API eliminada en la nueva `syncInboxOnce` |
| `server/apiChatWebhook.test.ts` | 7 | Pruebas legadas: asumen la semántica y la forma de retorno anteriores de `processApiChatWebhook` |
| `server/releaseGovernance.test.ts` | 6 | Deriva documental del release (ver §5.2) |

Estos 25 fallos **no son regresiones de ejecución del recorrido** —el recorrido está demostrado por la caja negra—, sino **pruebas y contratos documentales no migrados** junto con la refactorización.

---

## 5. Estado por hallazgo (H01–H16)

| Hallazgo | Estado | Evidencia principal |
| --- | --- | --- |
| H01 · Callback contractual | **Reparado** | `apiChatContract.ts` (`normalizeApiChatBatch` recorre `messages[]`, conserva posiciones inválidas). Caja negra: lote mixto → `queued:1, rejected:1` sin descartar los válidos |
| H02 · Sondeo equivalente | **Reparado (parcial)** | `inboxSync.ts` pagina con cursor durable `apichat_history_cursors` y reutiliza el mismo normalizador y `enqueueApiChatReceipts`. Caja negra: cruce webhook/historial no duplica. Pendiente: confirmar orden/ventana/retensión del historial con el proveedor |
| H03 · Acuse durable | **Reparado** | `apiChatReceipts.ts`: COMMIT del lote antes del HTTP 200; 503 si la base no está; worker con lease y reintento exponencial. Caja negra: base caída → 503; consumidor detenido → 0 mensajes; fallo transitorio conserva la carga y recupera sin duplicar |
| H04 · Identidad común | **Reparado** | `apiChatReceiptKey`, `candidateFileId` enlaza mensaje↔documento; bandeja, `conversationContext` y `agentEvaluator` leen el mismo expediente (`candidate_knowledge_files` + manifiesto unificado). Caja negra: 1 mensaje/1 documento/1 trabajo pese a 6 replays |
| H05 · Enlace de bandeja | **Reparado** | `inboxDetail` proyecta `media_storage_key`/`media_file_name`; `Inbox.tsx` y `CandidateConversationPanel.tsx` usan `encodeURIComponent`. Caja negra: descarga bytes idénticos (SHA-256), `Range: bytes=-8` → 206, sin cookie → 403 |
| H06 · Análisis durable | **Reparado** | `candidate_document_jobs` con `FOR UPDATE SKIP LOCKED`, lease de 8 min y advisory lock 137; `candidateDocumentWorker` integrado en `engine` y en el servicio único. Caja negra: pendiente → analizado |
| H07 · Audio/OCR/DOC | **Reparado (parcial)** | `analyzeCandidateDocument` integra `transcribeAudio` (+ `normalizeLegacyAudio` con ffmpeg), DOC con `antiword`, OCR con `pdftoppm`+`tesseract` tras `DOCUMENT_OCR_ENABLED`. Pendiente: binarios no instalados en `Dockerfile` y capacidad efectiva solo declarada, no probada en despliegue |
| H08 · Observabilidad veraz | **Reparado** | `recentAttachmentReceipts` consulta `uploaded_at`; `summarizeTransportTrace` emite `no-disponible`/`sin-trazas`/`sin-adjuntos`/`con-adjuntos` sin inferir culpabilidad. Validado por `transportTrace.test.ts` (12) y `transportObservability.postgres.test.ts` (3) |
| H09 · SSRF/procedencia | **Reparado** | `resolveAttachmentDestination` exige HTTPS público, lista `APICHAT_MEDIA_ALLOWED_HOSTS`, validación DNS/IP anti-redes-locales y `redirect: manual`. Validado por `base64Transport.test.ts` (57) |
| H10 · Dirección/postulación | **Reparado (parcial)** | `classifyFeedDirection` preserva `from_me`; `normalizeApiChatMessage` descarta IDs de grupo y nunca convierte un grupo en teléfono. Pendiente: resolución explícita de múltiples postulaciones de un mismo teléfono (sigue eligiendo la conversación más reciente) |
| H11 · Idempotencia | **Reparado** | `receipt_key` UNIQUE con `ON CONFLICT DO NOTHING`; clave de almacenamiento determinista `in-<conv>/<hash>`. Caja negra: 6 replays concurrentes → 1 mensaje/1 documento/1 trabajo |
| H12 · Límites/tipos | **Reparado (parcial)** | `maxBytes: 30 MiB` en descarga, `AttachmentTransportError` tipado, clasificación por extensión. Permanece el matiz `ftyp`→mp4 vs M4A como riesgo menor |
| H13 · Cadena de custodia | **Parcial** | Trazas con hash y redacción de secretos; retención de 14 días. No se construyó custodia probatoria completa (recomendación, no bloqueo funcional) |
| H14 · CV recibido ≠ evidencia | **Reparado** | `document_class` (`cv`/`other`/`unclassified`); instrucción «recibido no significa interpretado»; `agentEvaluator` declara «contenido aún no interpretado; no infiera ausencia». Validado por `conversationContext.test.ts` y `agentEvaluator.test.ts` |
| H15 · Persistencia/despliegue | **Parcial** | `Dockerfile` revisado; sigue sin instalar antiword/tesseract/ffmpeg/poppler y sin evidencia de volumen persistente compartido. Requiere verificación en despliegue |
| H16 · Acceso/paginación | **Reparado (parcial)** | Rango `bytes=-N` corregido y validado (206) en caja negra; la bandeja conserva `LIMIT 500` sin cursor |

---

## 6. Incompletitudes remanentes

### 6.1 Pruebas legadas no migradas (19 casos) — **resuelto**

`inboxSync.test.ts` (12) y `apiChatWebhook.test.ts` (7) probaban la API anterior: el tipo exportado `InboxSyncRecorder`, la inyección `recorder` y la forma de retorno previa de `processApiChatWebhook`. Ambos archivos fueron reescritos contra el contrato nuevo: `normalizeApiChatBatch`/`normalizeApiChatWebhookPayload` (normalizador), `classifyFeedDirection` (dirección), `syncInboxOnce` con `enqueueApiChatReceipts` simulado, paginación y cursor, y `processApiChatWebhook` con dirección preservada y lotes mixtos. Resultado: 24 pruebas verdes.

### 6.2 Deriva documental del release (6 verificaciones) — **resuelto**

- `knowledge.ts` renombró `extractPdfText`/`extractDocxText` → `extractDocumentText`; el contrato de prueba se actualizó.
- `README.md` incorporó el historial `### 17SEP2026 · JARVI RH 2.0.180` y comprimió las entradas 2.0.130/2.0.131 para respetar el techo del registro.
- `RELEASE_GOVERNANCE.md` incorporó `Alcance candidato 2.0.180`.
- El conteo de cadenas de tratamiento formal pasó de 132 a 139 (más cobertura); el contrato se actualizó y se corrigió el único hallazgo de imperativo informal (`entrega(s) detenida(s)` → `envío(s) detenido(s)`).
- El texto de `inboxFiles.ts` (`Se requiere rol de reclutador o administrador.`) quedó reflejado en el contrato de prueba.

Con esto, `releaseGovernance.test.ts` queda en 31/31 y las puertas `pnpm test`, `pnpm check` y `release:verify` en verde.

---

## 7. Criterios de aceptación: verificación directa

| Criterio del informe original | Resultado observado |
| --- | --- |
| Callback oficial con uno y varios medios; elemento inválido | ✅ Lote mixto conserva los válidos (`queued:1, rejected:1`) |
| Mismo mensaje por webhook y por historial | ✅ Sin duplicado (recepción cruzada → `duplicates:1`) |
| PDF textual, DOCX, DOC y audios declarados | ✅ PDF textual y estado real por formato; PDF sin texto → `no_extractable_text`/OCR según flag; DOC/audio dependen de binarios no instalados |
| Base no disponible antes de aceptación | ✅ HTTP 503, sin acuse positivo |
| Caída tras escribir bytes / durante extracción | ✅ Carga conservada y recuperación sin duplicar (fallo transitorio) |
| Consulta histórica paginada y >200 conversaciones | ⚠️ Paginación con cursor implementada; la resolución por identidad estable funciona, pero la asociación de múltiples postulaciones por teléfono sigue pendiente (H10) |
| Envío desde teléfono empresarial | ✅ Dirección preservada; `from_me:true` → saliente, no evidencia del candidato |
| Reclutador abre adjunto; usuario ajeno | ✅ 200 con cookie; 403 sin ella |
| Análisis tarda más que un turno | ✅ Acuse inmediato con estado `pendiente`; finalización por worker |
| Falla SQL / colección anidada / sobre grande | ✅ Observabilidad con estados explícitos; sin culpabilidad inferida |
| Reinicio/despliegue/réplica | ⚠️ Clave de almacenamiento determinista y lease permiten recuperación; no probado contra múltiples réplicas reales |
| Contexto con cambios documentales | ✅ Manifiesto con `document_class` y estado; huella incluye expediente |

---

## 8. Conclusiones

1. **La solución es arquitectónicamente correcta** para el objeto auditado: restaura la cadena «mensaje → evento durable → objeto → adjunto → derivado → contexto/decisión» con identidad e idempotencia, y lo demuestra en caja negra con bytes, estados y permisos reales.
2. **La entrega no era ejecutable tal cual**: no compilaba y, aun compilando, no habría registrado ningún mensaje en PostgreSQL. La afirmación de «100 %» era, por tanto, infundada al cierre de la sesión de reparación.
3. **Esta validación subsanó** los dos defectos de ejecución (D1, D2), la firma del mock de aceptación (D3), el artefacto de despliegue (D4), las 19 pruebas legadas, las 6 verificaciones de release y declaró las tablas nuevas en `drizzle/schema.ts`. Con ello, la caja negra pasa 13/13 y la suite unitaria queda en 544/544 (13 omitidas por exigir PostgreSQL).
4. **Estado final verificado en este entorno:** `tsc --noEmit` sin errores; suite unitaria 544 pasadas / 0 fallidas; caja negra HTTP/PostgreSQL 13/13; `deploy:sql --check` sincronizado; tratamiento formal y copia pública verificados en 139 archivos sin hallazgos; **build de producción completo** (vite + esbuild) sin errores; `release:verify` en verde; y **el know-how del método no aparece en el paquete cliente compilado** (0 coincidencias de `EVALUATION_BLOCKS`, `SCORE_BANDS`, `SALARY_GOVERNANCE_POLICY`, `DEFAULT_AGENT_INSTRUCTIONS`, `identificacion_ajuste`, `dictamen_ia`). Las evidencias que solo el despliegue puede aportar (configuración efectiva del webhook `notify_format`/base64, volumen persistente, binarios en el host y correlación histórica del PDF del incidente) siguen siendo condición de cierre productivo, no de esta validación.
5. **La causa histórica del PDF fotografiado sigue sin atribuirse**: nada de lo anterior identifica de forma inequívoca cuál de las capas lo eliminó; se requiere el protocolo forense del informe original (exportación del proveedor, proxy, trazas y filas correlacionadas por ID).

### Cierre

La reparación quedó consolidada y publicada en `main` (commit `8888768`, «feat: repara el transporte de adjuntos de ApiChat JARVI RH 2.0.180»). No se desplegó en producción.

## Referencias

American Psychological Association. (2020). *Publication manual of the American Psychological Association* (7.ª ed.). https://www.apa.org/pubs/books/publication-manual-7th-edition-paperback

ApiChat. (s. f.). *Whatsapp API—Swagger* [Especificación OpenAPI 3.0.0; recurso consultado `version=1.7`]. Recuperado el 18 de septiembre de 2026, de https://panel.apichat.io/openapi.yaml?version=1.7

Josefsson, S. (2006). *The Base16, Base32, and Base64 data encodings* (RFC 4648). RFC Editor. https://www.rfc-editor.org/rfc/rfc4648

Kent, K., Chevalier, S., Grance, T., & Dang, H. (2006). *Guide to integrating forensic techniques into incident response* (NIST Special Publication 800-86). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-86

*Reclutamiento AISA agent: JARVI RH 2.0.180* [Código fuente en el árbol de trabajo]. (2026). Repositorio local sometido a validación; huellas de la revisión auditada identificadas en `manifiesto.json`.
