# Diagnóstico por evidencia y plan secuenciado — instancia AISA #32146

**Fecha:** 18 de septiembre de 2026.
**Elementos de evidencia recibidos:** (a) captura del panel de ApiChat, cuenta `#32146 · AISA`; (b) resultado de la consulta a `conversation_transport_traces` en la base de la instancia.
**Base de este documento:** [reproduccion_pdf_bandeja.ts](reproduccion_pdf_bandeja.ts) y [reauditoria_2.0.183.md](reauditoria_2.0.183.md).
**Naturaleza:** diagnóstico de instancia. La conclusión de §1 es una **identificación por firma de código**, no una inferencia.

---

## 1. Identificación de la versión desplegada — conclusión firme

La instancia ejecuta **JARVI RH 2.0.179**. No es una estimación: es la lectura de una firma exclusiva.

El campo `outcome` de sus trazas vale `no-procesado:<tipo>`. Esa cadena se introdujo en `b450bdb` (2.0.179) y **se retiró en `8888768` (2.0.180)**; hoy no existe en el árbol:

```text
grep -rn "no-procesado" server/        →  AUSENTE en HEAD (2.0.183)
git log -S"no-procesado" -- server/    →  b450bdb (introduce) · 8888768 (retira)
```

Las trazas están fechadas **hoy 21:54:55 y 21:55:10**, de modo que las escribió el proceso **en ejecución**, no una versión anterior. Conclusión: **el artefacto en producción no contiene ninguna de las reparaciones de 2.0.180, 2.0.181, 2.0.182 ni 2.0.183** — precisamente el conjunto que habilita la recepción de PDF, Word, audio e imagen.

**Corroboración independiente:** la URL del webhook en el panel no lleva `?key=`. En 2.0.179 la ruta no exigía autenticación (no existía `authorized()`), de modo que la URL era correcta entonces. En 2.0.180+ esa misma URL **sería rechazada**.

---

## 2. Qué dicen sus 16 trazas

Todas son de origen **sondeo** y todas tienen `outcome = no-procesado:<tipo>`. En el código de 2.0.179 esa cadena se escribe en un único lugar (`inboxSync.ts`, rama `else` de `processFeedRecord`), con este comentario del propio autor:

> «El feed entrega tipos que este puente no sabe transportar —imagen, audio, video, documento— y hasta ahora los descartaba **sin asiento**».

Es decir: **cada una de esas 16 filas es un adjunto del candidato que llegó al puente de sondeo y fue descartado sin convertirse en mensaje.** No es una traza de recepción: es el acta de un descarte.

Y explica por qué sus tipos se reparten así:

| `provider_type` en su traza | Qué hacía 2.0.179 con él |
| --- | --- |
| `image` | **No existía rama.** La función sólo atiende `text`, `link`, `location` y `file`. Cayó al retorno final: descartado |
| `audio` | **No existía rama.** Mismo caso: descartado |
| `file` | Sí existía rama, pero exigía `message.url` no vacío; si falta, **descarta en la primera línea** |

---

## 3. Por qué «base64 activado» no contradice el diagnóstico — lo explica

Su aclaración es correcta y **corrige mi hipótesis anterior**: la opción *Notify attachments in base64 format* está activada y lo ha estado siempre. Mi propuesta de activarla era equivocada y la retiro expresamente.

Pero la captura y las trazas encajan de forma exacta, y de un modo que agrava el problema en esa versión:

- Con la notificación en base64, el proveedor entrega el contenido **codificado en el cuerpo del registro**, no como una dirección en `url`.
- El código de 2.0.179 leía **únicamente `message.url`**, y además exigía que fuera un sobre `data:` o una URL `https://`.
- Con base64 activado y sin `url`, la rama `file` descarta en su primera línea: `if (!rawUrl) return { processed: false }`.
- Los tipos `image` y `audio` no tenían rama alguna.

**Consecuencia: en 2.0.179, tener base64 activado hacía que ningún adjunto pudiera entrar por el sondeo.** Los textos sí entraban (existía la rama `text`), que es exactamente lo que muestran sus capturas del incidente: conversación con texto y ninguna evidencia documental. La reparación de 2.0.180 se escribió precisamente para esto —resolver el base64 que llega sin sobre `data:` y atender todos los tipos de medios en el sondeo—.

**El PDF no se perdió en el proveedor. ApiChat lo entregó. El artefacto lo vio y lo descartó.**

---

## 4. El único dato que falta, y se cierra con una consulta

Falta saber **en qué campo del registro** entrega el proveedor el base64. Con eso se confirma que 2.0.183 lo resuelve antes de desplegar. Ejecute sobre la base de la instancia:

```sql
-- Claves y tipos de los cuerpos descartados, sin contenido del candidato.
SELECT t.created_at,
       t.outcome,
       t.provider_type,
       campo.key                       AS ruta_del_campo,
       campo.value->>'kind'            AS tipo_de_valor,
       (campo.value->>'bytes')::bigint AS bytes
  FROM conversation_transport_traces t
  CROSS JOIN LATERAL jsonb_each(COALESCE(t.shape, '{}'::jsonb)) AS campo(key, value)
 WHERE t.outcome LIKE 'no-procesado%'
 ORDER BY t.created_at DESC, campo.key
 LIMIT 200;
```

**Cómo se lee.** El código de 2.0.183 resuelve contenido en los campos enumerados `url`, `base64`, `dataBase64`, `data_uri`, `dataUri`, `media`, `media_url`, `file_url`, `fileUrl`, `file`, `body`, `content`, `data`, siempre que el valor empiece por `data:`, empiece por `https://` o supere 64 caracteres con forma base64.

| Si la ruta del campo es… | Lectura |
| --- | --- |
| `body`, `content`, `data`, `base64`, `media` | 2.0.183 **lo resuelve**. El despliegue cierra el caso |
| Una ruta distinta (p. ej. `media_base64`, `file_data`, `ptt`) | 2.0.183 no lo reconocería: hay que ampliar el adaptador **con el nombre real**, no por conjetura |

Mi consulta anterior usaba la ruta `messages[0].url`, que corresponde al sobre del **webhook**; sus trazas son del **sondeo**, donde el cuerpo es un registro suelto. De ahí los `NULL`: la consulta buscaba en el sitio equivocado. Ésta los enumera todos.

---

## 5. Plan secuenciado — el orden no es negociable

La secuencia importa porque el código nuevo **exige** una credencial que el antiguo no pedía, y depende de tablas que la instalación documentada no creaba.

| # | Paso | Por qué en este orden | Observable de éxito |
| --- | --- | --- | --- |
| 1 | **Respaldo de la base** y anotar la versión actual | Poder revertir; dejar constancia del estado inicial | Dump verificado |
| 2 | **Aplicar el esquema del conducto** con el SQL consolidado (`database/005_servicio_conversacional_listo.sql`) | Crea `apichat_inbound_receipts`, `candidate_document_jobs` y `conversation_transport_traces`. Sin ellas, el código nuevo no puede recibir nada | `GATE GLOBAL` en `OK`; los tres `to_regclass` devuelven nombre |
| 3 | **Definir `APICHAT_WEBHOOK_SECRET`** en el servicio | El código nuevo responde 503 sin ella | Variable presente en EasyPanel |
| 4 | **Añadir `?key=<ese secreto>` a la URL del webhook** en el panel de ApiChat | **Crítico.** Si se despliega sin esto, el webhook pasa de funcionar a devolver 401 y se pierde la vía de notificación inmediata | URL con `?key=` guardada en el panel |
| 5 | **Desplegar 2.0.183** | Incorpora las reparaciones 2.0.180–2.0.183 | Bitácora con `Server running`; sin avisos de cola no disponible |
| 6 | **Prueba de vida con los cuatro formatos** (§3 del plan de puesta en vivo) | Verificar con el código nuevo, no con el viejo | Cuatro formatos con `analysis_status` real |
| 7 | **Dejar que el sondeo reconcilie el historial** y buscar el mensaje del PDF | El original está en el historial de ApiChat: el puente nuevo pagina desde el cursor e incorpora los adjuntos por la cola de recibos | Fila en `apichat_inbound_receipts` con el ID del mensaje investigado |

**Sobre el paso 7 — recuperación sin pedir reenvío.** El cursor del historial (`apichat_history_cursors`) es nuevo y arranca en cero al aplicar la migración, de modo que el puente recorrerá el historial reciente del proveedor. Si el mensaje del PDF sigue dentro de la ventana conservada por ApiChat, **se recupera solo**. Vigile:

```sql
-- ¿Apareció el mensaje investigado?
SELECT receipt_key, provider_message_id, origin, status, outcome, attempts, last_error
  FROM apichat_inbound_receipts
 WHERE received_at >= now() - interval '1 day'
 ORDER BY received_at DESC LIMIT 50;

-- ¿Avanzó el cursor del historial?
SELECT scope, page, updated_at FROM apichat_history_cursors;
```

Si el mensaje ya no está en la ventana del proveedor, entonces sí hay que pedir el reenvío —**después** del paso 6, nunca antes.

**Advertencia de secuencia, resumida:** desplegar antes de los pasos 2–4 deja la instancia **peor que ahora**: sin tablas y sin credencial, el webhook responde 503 y el sondeo nuevo tampoco puede conservar. Los pasos 2, 3 y 4 son previos al despliegue, y el 4 es el que más se olvida.

---

## 6. Observaciones secundarias de la captura

| Observación | Lectura |
| --- | --- |
| `Notify Format` vacío | Correcto: el cuerpo llega sin envoltura y el adaptador de 2.0.183 lo entiende. No inventar un formato sin necesidad |
| `Use Chatapi language` y `Use APIGraph language` apagados | Irrelevante para esta ruta |
| `Notify from me messages` apagado | Los mensajes propios se recuperan por el sondeo, que clasifica la dirección con `from_me` |
| Teléfono conectado, `Send 200 Messages/day` | La cuenta opera. **Verifique ese límite diario**: si aplica a los envíos, la solicitud automática de CV y los turnos del agente podrían agotarlo en plazos de alta actividad |
| Webhook registrado sobre el host de EasyPanel | Correcto. Recuerde que un `GET` a esa ruta devuelve el HTML del aplicativo: no es una prueba válida |

---

## 7. Correcciones que esta evidencia introduce en mis entregas anteriores

| Afirmación previa | Estado | Corrección |
| --- | --- | --- |
| «La reparación inmediata es activar la notificación en base64» | **Retirada** | Ya estaba activada. El diagnóstico correcto es la **versión desplegada**: 2.0.179 no podía leer base64 ni atender imagen ni audio |
| «La traza permite saber en qué campo llegó la carga» | **Matizada** | Cierto, pero la consulta que propuse usaba la ruta del sobre del webhook. Para el sondeo hay que enumerar las claves (§4) |
| «H23, las tablas del conducto podrían faltar» | **Reforzada** | Su instancia es anterior a esa migración: las tablas **no existen** todavía. Deben crearse antes de desplegar |
| «No comprar servidores» | **Confirmada con nueva evidencia** | 16 adjuntos descartados y CPU ociosa: el cuello de botella es de versión, no de capacidad |

---

## 8. Cierre

El fenómeno queda explicado sin residuo hipotético: **el candidato envió su CV; ApiChat lo entregó; el artefacto lo recibió en el puente de sondeo y lo descartó porque esa versión del código no sabía transportar el base64 ni los tipos de medios.** Sus 16 trazas son el registro de esos descartes y, a la vez, la identificación exacta de la versión que los produjo.

Lo que sigue no es diagnóstico, es ejecución: pasos 2 a 5 de §5, en ese orden, y el mensaje del candidato se recupera por el propio historial del proveedor.

---

## Referencias

American Psychological Association. (2020). *Publication manual of the American Psychological Association* (7.ª ed.). https://www.apa.org/pubs/books/publication-manual-7th-edition-paperback

ApiChat. (s. f.). *OpenAPI specification* (versión 1.7). https://panel.apichat.io/openapi.yaml?version=1.7

Kent, K., Chevalier, S., Grance, T., & Dang, H. (2006). *Guide to integrating forensic techniques into incident response* (NIST SP 800-86). National Institute of Standards and Technology. https://csrc.nist.gov/pubs/sp/800/86/final
