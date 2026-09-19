# Informe de traspaso entre agentes — auditoría del transporte de adjuntos de ApiChat

**Fecha de corte:** 19 de septiembre de 2026 · **Versión desplegada en el cliente:** JARVI RH 2.0.185 · **Versión en el árbol:** 2.0.185 con un incremento pendiente de release (validado en 608/608 pruebas, sin numerar todavía).
**Destinatario:** un agente de inteligencia artificial o un ingeniero que continúe el trabajo sin acceso a la conversación original.
**Naturaleza:** documento de estado y de método. No certifica el despliegue; registra qué está demostrado, qué está pendiente y con qué fuente.

---

## 1. El fenómeno objeto de estudio

Un candidato envía su currículum en PDF por WhatsApp. El texto de la conversación aparece en la bandeja del artefacto, pero **el PDF —y, según el historial, también las imágenes y un audio— no llegan jamás a la bandeja ni al expediente**. El agente conversacional responde pidiendo el CV de nuevo, y la institución queda con un artefacto que, para el fin que le importa —recibir y evaluar evidencia documental—, está inerte.

El historial del proveedor demuestra que el problema **no es del candidato ni del transporte de WhatsApp**: el 18 de septiembre de 2026, a las 16:54 y 18:32, ApiChat registró dos archivos PDF (`data:application/pdf;base64`), dos imágenes y un audio para el teléfono `50230939134`. El proveedor entregó; el artefacto descartó.

## 2. Identificación de la versión causante, por firma de código

El método para datar una instancia sin acceso a su binario es buscar en sus datos una cadena que sólo una versión escriba. En la tabla `conversation_transport_traces`, el campo `outcome` vale `no-procesado:<tipo>`. Esa cadena:

- se introdujo en el commit `b450bdb` (versión 2.0.179);
- se retiró en `8888768` (versión 2.0.180);
- no existe en el árbol vigente.

La verificación es reproducible:

```bash
grep -rn "no-procesado" server/        # AUSENTE en HEAD
git log -S"no-procesado" -- server/    # b450bdb lo introduce · 8888768 lo retira
```

Las trazas estaban fechadas el mismo día del incidente, luego las escribió el proceso **en ejecución**. Conclusión firme: **la instancia corría 2.0.179**, y por tanto no contenía ninguna de las reparaciones 2.0.180–2.0.185.

## 3. Causa raíz demostrada en el código de 2.0.179

En `server/inboxSync.ts` de 2.0.179, la ruta de sondeo `processFeedRecord` atendía sólo cuatro tipos:

- `text`, `link` y `location` se registraban normalmente;
- `file` exigía `message.url` no vacío y que `decodeRemoteAttachment` devolviera bytes;
- `image`, `audio`, `video` y `document` **no tenían rama** y caían al retorno `processed: false`.

Cada descarte producía exactamente la traza observada: `outcome = no-procesado:<tipo>`. El comentario del propio autor lo declara: *«el feed entrega tipos que este puente no sabe transportar —imagen, audio, video, documento— y hasta ahora los descartaba sin asiento»*.

La trampa de configuración que agravaba el cuadro: con *Notify attachments in base64 format* activado —que era el estado real del cliente— el proveedor entrega el contenido **codificado en el cuerpo**, no como una dirección en `url`. El receptor de 2.0.179 leía únicamente `url`, de modo que **con base64 activado ningún adjunto podía entrar por el sondeo**, mientras el texto sí. Eso explica exactamente el fenómeno: conversación con texto, sin evidencia documental.

## 4. Fuente primaria y su verificación

La fuente primaria del contrato es el OpenAPI oficial que el panel de ApiChat enlaza:

```text
https://panel.apichat.io/openapi.yaml?version=1.7
```

Verificación criptográfica registrada en dos momentos independientes y coincidentes:

| Atributo | Valor |
| --- | --- |
| Bytes | 51 022 |
| SHA-256 | `eb487f5bb20300298fbfe53e39b9d36589e1bf3a76335534c7efb5729c33c68d` |
| Versión declarada | `openapi: 3.0.0` · `info.version: 1.0.0` · base `https://api.apichat.io/v1` |

Reproducción para el agente receptor:

```bash
curl -fsSL "https://panel.apichat.io/openapi.yaml?version=1.7" -o /tmp/apichat.yaml
wc -c /tmp/apichat.yaml
sha256sum /tmp/apichat.yaml
```

Hechos contractuales que gobiernan el caso, con su localizador en el YAML:

1. **`MediaBase`** (líneas ≈829–835): el medio se anuncia en `url`, descrito como *«URL for media content or base64-encoded file with mime data»*. **No existe ningún endpoint de descarga de medios**: el artefacto no puede ir a buscar el archivo al proveedor; o lo recibe en el cuerpo, o no lo recibe.
2. **El callback** (`callbacks.Messages`, ≈1754–1764) entrega `messages[]`; cada elemento es el esquema `Message`.
3. **El historial** (`GET /messages`, ≈554–582; `MessagesDB`, ≈1004–1007) devuelve objetos cuyo campo `message` es **el mismo esquema `Message`**. Por tanto webhook y sondeo comparten forma, y el adaptador debe aceptar ambos.
4. Los parámetros del historial incluyen `number`, `messageId` y `fromMe`; `limit` declara máximo 50.

Consecuencia: el único camino legítimo es resolver el contenido en el propio cuerpo de la notificación —base64 con su tipo o URL de medios—, y no presuponer ningún servicio de descarga que el contrato no declara.

## 5. Hallazgos y su estado

| Id | Hallazgo | Estado |
| --- | --- | --- |
| H01 | El callback `messages[]` se rechazaba por completo | **Reparado en 2.0.180** |
| H02 | El sondeo descartaba imagen, audio, video y documento | **Reparado en 2.0.180** |
| H03 | Acuse HTTP sin persistencia durable | **Reparado en 2.0.180** (cola `apichat_inbound_receipts`) |
| H04/H05 | Identidad común del adjunto y enlace de bandeja | **Reparado en 2.0.180–2.0.182** |
| H06 | Análisis documental sin cola durable | **Reparado en 2.0.182** |
| H07 | PDF/DOCX/audio/OCR sin interpretación integrada | **Reparado en 2.0.182** (binarios en la imagen, OCR gobernado) |
| H09 | SSRF y procedencia del webhook | **Reparado en 2.0.180** |
| H17 | El informe del conducto declara «sin pendientes» con un rechazo de política | **Abierto** |
| H18 | El recibo no conservaba la causa del fallo | **Parcial en 2.0.184; completado por el incremento pendiente** |
| H21 | Sin superficie de reproceso para recibos agotados | **Abierto** |
| H23 | El diario de Drizzle no registra las migraciones 0035–0037; `db:push` no las aplica | **Documentado; camino correcto = `database/005_servicio_conversacional_listo.sql`** |

## 6. Lo que ya está desplegado (2.0.185) y por qué debería funcionar

La instancia del cliente exhibe las cuatro puertas abiertas, verificadas por captura: versión **2.0.185** en el pie; **Secreto del webhook** configurado y con máscara cuyo sufijo coincide con el `?key=` de la dirección registrada en ApiChat; **Dirección pública** configurada; **notificación en base64 activada**. El receptor vigente resuelve el contenido en trece campos declarados y acepta base64 con y sin el sobre `data:`.

La incógnita residual es **en qué campo del esquema `Message` viaja el sobre**. La traza de 2.0.179 no descendía al objeto anidado (`message` aparecía como `objeto` opaco). La traza vigente sí desciende, de modo que la primera notificación nueva responde la pregunta con una consulta.

## 7. El ejercicio decisivo y sus observables

Enviar un PDF real desde el teléfono del candidato y ejecutar, después de un minuto:

```sql
-- 1) el recibo
SELECT provider_message_id, origin, status, outcome, attempts, last_error, received_at
  FROM apichat_inbound_receipts ORDER BY received_at DESC LIMIT 10;

-- 2) la forma del cuerpo, descendida
SELECT t.created_at, t.outcome, t.provider_type,
       campo.key AS ruta, campo.value->>'kind' AS tipo,
       (campo.value->>'bytes')::bigint AS bytes
  FROM conversation_transport_traces t
  CROSS JOIN LATERAL jsonb_each(COALESCE(t.shape,'{}'::jsonb)) AS campo(key,value)
 WHERE t.created_at >= now() - interval '30 minutes'
   AND (campo.key LIKE 'message.%' OR campo.value->>'kind' LIKE 'contenido:%')
 ORDER BY t.created_at DESC, campo.key LIMIT 60;

-- 3) el mensaje y su documento
SELECT m.provider_message_id, m.message_type AS tipo,
       m.metadata->'media'->>'fileName' AS archivo,
       m.metadata->'media'->>'processingOutcome' AS ingreso,
       m.metadata->'media'->>'processingReason' AS motivo,
       k.id AS documento, k.extension, k.analysis_status, k.processing_error_code,
       length(COALESCE(k.extracted_text,'')) AS caracteres
  FROM conversation_messages m
  LEFT JOIN candidate_knowledge_files k
    ON k.id::text = m.metadata->'media'->>'candidateFileId'
 WHERE m.created_at >= now() - interval '30 minutes'
   AND m.metadata->'media' IS NOT NULL
 ORDER BY m.created_at DESC LIMIT 12;
```

Interpretación: recibo `completed` y `outcome = registrado`, traza con `message.<campo>` de tipo `contenido:<sha256>`, y documento `pdf` con `analysis_status` distinto de nulo, cierran el caso. Un rechazo con motivo `extension_not_allowed` remite a la política de extensiones (`integration_settings` de `knowledge`); `content_unresolved` o `payload_missing` remite al nombre de campo que la traza del paso 2 revela.

Recuperación sin pedir reenvío: el puente de sondeo vigente pagina el historial desde el cursor en cero, y los dos PDF, las imágenes y el audio del 18/09 **nunca fueron deduplicados** porque jamás se convirtieron en mensaje. Es probable que reingresen solos al expediente.

## 8. Incremento pendiente, ya validado (608/608) y sin numerar

Queda en el árbol de trabajo, sin confirmar, un incremento que cierra la clasificación de fallos. Contenido:

- **`server/base64Transport.ts`**: nuevos códigos `payload_missing` y `payload_invalid`. Un sobre `data:` sin la coma ni la codificación —que es literalmente `data:application/pdf;base64`, la forma que el contrato describe y que el panel del proveedor muestra— se clasifica `payload_missing:permanente` en lugar de degradarse al nombre de una excepción.
- **`server/apiChatReceipts.ts`**: la clase `ReceptionError` y el clasificador `receiptFailureReason`; `sin-conversacion` se convierte en `sin_destinatario` con ventana corta de reintento (tres intentos, no veintiún minutos); un fallo declarado permanente pasa directo a `dead`; el campo `outcome` deja de quedar vacío —cura la fila «sin desenlace» que el panel mostraba—; un fallo de PostgreSQL se asienta como `base_de_datos:<SQLSTATE>`.
- **`server/apiChatReceipts.test.ts`**: nueve pruebas nuevas que fijan la clasificación.

## 9. Lo que queda deliberadamente abierto

- **H17**: el resumen del conducto no cuenta los rechazos de ingreso por política; puede decir «sin pendientes» con un adjunto fuera del expediente.
- **H21**: no hay operación administrativa que devuelva un recibo `dead` a la cola.
- **Política de reintentos**: el incremento pendiente acorta lo permanente, pero no hay paralelismo en el barrido ni reconsideración del límite de 50 MB del cuerpo ante un lote.
- **`data/` no está en `.gitignore`** y la aplicación escribe allí los binarios de los candidatos.
- **H23**: la corrección de fondo (registrar 0035–0037 en el diario de Drizzle y declarar `conversation_transport_traces` en `drizzle/schema.ts`) sigue pendiente.

## 10. Método para el agente receptor

1. **Autenticar la fuente primaria** con el hash de §4 antes de citar el contrato.
2. **Datar por firma de código** con `git log -S "<literal>"` cuando una instancia escriba valores que el árbol vigente no produce.
3. **Puertas**: `pnpm check`, `pnpm test`, `pnpm text:verify`, `pnpm release:verify`, `pnpm deploy:sql --check`, y la caja negra con `MEDIA_TEST_DATABASE_URL` apuntando a una base local `_test`.
4. **Ceremonia de release**: `pnpm release:bump` reescribe la versión fuera del bloque `<!-- release-history -->`; hay que añadir a mano la entrada del historial con el rótulo exacto que la puerta exige (la fecha **no** se actualiza: se repite la del rótulo anterior), el `### Alcance candidato <v>` de la gobernanza y la tabla nueva de caja negra con su par `BN-REG-01/02`. El registro histórico tiene techo 2600 palabras y hoy está en 2596: **cada incremento exige comprimir entradas no ancladas**.
5. **Estado por firma de datos**: si `to_regclass('public.apichat_inbound_receipts')` es `NULL`, la instancia no puede recibir nada, sea cual sea su versión.
6. **Memoria del repositorio**: `memories/repo/conventions.md` conserva trampas de TypeScript/PostgreSQL, la secuencia crítica de despliegue y las lecciones de esta auditoría.

## Referencias (APA 7; no existe una octava edición)

American Psychological Association. (2020). *Publication manual of the American Psychological Association* (7.ª ed.). https://www.apa.org/pubs/books/publication-manual-7th-edition-paperback

ApiChat. (s. f.). *OpenAPI specification* (versión 1.7). https://panel.apichat.io/openapi.yaml?version=1.7

Josefsson, S. (2006). *The Base16, Base32, and Base64 data encodings* (RFC 4648). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc4648

Kent, K., Chevalier, S., Grance, T., & Dang, H. (2006). *Guide to integrating forensic techniques into incident response* (NIST SP 800-86). National Institute of Standards and Technology. https://csrc.nist.gov/pubs/sp/800/86/final
