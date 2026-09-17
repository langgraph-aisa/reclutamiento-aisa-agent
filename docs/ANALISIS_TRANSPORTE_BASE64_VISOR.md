# Validación académica y técnica: transporte base64 y visor universal

Fecha: 2026-09-17. Rama objetivo: `main`. Base: JARVI RH 2.0.154.

Este documento responde a dos fenómenos observados en el Administrador de
Proyectos (RAG) y en la bandeja conversacional, valida su viabilidad en el marco
de la ingeniería de software y declara la solución implementada.

---

## 1. Enunciado del fenómeno

1. **El visor no muestra correctamente los documentos del RAG.** Un archivo
   cargado puede no previsualizarse, mostrarse en blanco o degradarse a
   descarga forzada según su formato.
2. **La carga no reconstruye el archivo a partir de base64 de forma
   verificable.** Se pedía que el archivo se transformara al transporte en el
   mismo acto de la carga (selector o arrastre y suelte), que pudiera alimentarse
   de forma remota —por ejemplo desde ApiChat (`apichat.io`), que lo entrega en
   base64— y que, dentro del artefacto, se volviera a guardar «normal» con su
   extensión final.

---

## 2. Diagnóstico: causa raíz

El estudio del código identificó **siete causas independientes**, no una:

### 2.1 En el visor

| # | Causa | Evidencia en el código | Efecto observable |
| --- | --- | --- | --- |
| V1 | Las peticiones del visor (`<iframe>`, `<img>`, `<video>`, `<audio>`) las emite el navegador, no la aplicación: no llevan cabeceras propias y dependen de la cookie. | `knowledgeRoutes.ts` autorizaba solo con `readLocalSession(req)` | Visor en blanco cuando la cookie no viaja |
| V2 | La cookie de sesión usa `SameSite=None`, que los navegadores exigen junto con `Secure` y rechazan en contextos incrustados o sin HTTPS terminado. | `_core/cookies.ts`: `sameSite: "none"`, `secure: isSecureRequest(req)` | Bloqueo silencioso de la cookie → `403` |
| V3 | Solo existían vistas previas para PDF, DOCX y CSV. No había conversión para `xls`, `xlsx` ni `txt`. | `knowledgeRoutes.ts` devolvía `415` para el resto | «Sin vista previa integrada» |
| V4 | `renderDocxHtml` devolvía un fragmento HTML sin `<html>`, sin metadatos y sin estilo; el iframe lo interpretaba con formato perdido. | `knowledge.ts`: `mammoth.convertToHtml` sin envoltorio | Texto sin estructura, imágenes desbordadas |
| V5 | `renderCsvPreview` devolvía **texto plano** con extensión `.csv`, no una tabla. | `knowledge.ts`: `toString("utf8")` y `join("\n")` | Comas en crudo, sin columnas |
| V6 | No se enviaba `X-Content-Type-Options: nosniff`: el navegador podía reinterpretar el tipo y tratar el contenido como descarga en lugar de incrustarlo. | `sendRange` no fijaba cabeceras de visor | Descarga forzada |

### 2.2 En el transporte

| # | Causa | Evidencia en el código | Efecto observable |
| --- | --- | --- | --- |
| T1 | La decodificación base64 estaba **duplicada** en cuatro fronteras (`routers.upload`, `inboxSync`, `apiChatWebhook`, `inbox.sendInboxFile`), cada una con su propio límite, su propia validación y su propio manejo de errores. | Cuatro implementaciones independientes de `Buffer.from(..., "base64")` | Divergencia de comportamiento entre canales |
| T2 | La extensión se aceptaba **tal como la declaraba el emisor**; nunca se contrastaba con el contenido real. | `extensionOf(input.fileName)` sin verificación | Archivo `.jpg` con contenido PDF almacenado como imagen |
| T3 | El MIME se derivaba **solo de la extensión declarada**, no del contenido. | `knowledgeMimeType(extension)` | `Content-Type` incorrecto → visor roto |
| T4 | No existía huella de integridad ni versión de contrato de transporte. | Ausencia de `sha256` en la carga | Imposible detectar corrupción en tránsito |

**Conclusión del diagnóstico:** el fenómeno del visor y el del transporte
comparten una raíz epistemológica: **el sistema trataba la afirmación del emisor
(extensión y MIME declarados) como si fuera un hecho verificado**. Corregir el
visor sin corregir el transporte habría dejado la causa raíz intacta.

---

## 3. Validación académica de viabilidad

### 3.1 Marco epistemológico

La solución aplica el principio ya declarado en la documentación del proyecto:
**la evidencia estructurada es primaria y la afirmación es secundaria**. En
términos de ingeniería, la extensión del nombre y el MIME declarado son
*testimonio*, mientras que la firma de contenido (*magic bytes*) es *evidencia*.
La precedencia se invierte: el contenido dicta la extensión final, y el nombre se
reconstruye para que describa el mismo objeto que el MIME y el visor.

Esto convierte una **comprobación de confianza** en una **verificación por
construcción**, coherente con el resto del artefacto (restricciones de base de
datos, poscondiciones de servidor, idempotencia como criterio de verdad
operativa).

### 3.2 Marco ontológico

Se distinguen tres entidades que antes se confundían:

1. **El objeto** (archivo): bytes binarios con extensión final verificada.
2. **El sobre** (transporte): cadena base64 con versión, nombre, MIME, peso y
   `sha256`.
3. **La referencia** (almacenamiento): `storage_key` con patrón validado.

La ontología resultante sostiene la invariante deseada por el usuario: **el
artefacto almacena «normal» y transporta «codificado»**, sin que el formato de
transporte contamine el formato de reposo.

### 3.3 Marco fenomenológico

Para el usuario administrador, el fenómeno cambia así:

- **Antes:** cargar un archivo y descubrir después que no se previsualiza; la
  falla aparecía *después* del hecho y sin explicación.
- **Ahora:** el archivo se clasifica, se renombra si el contenido contradice la
  extensión, se almacena con el MIME correcto y se previsualiza en el mismo
  visor para todos los formatos representables.

Para el candidato o remitente de WhatsApp, el fenómeno es **invisible**: el
adjunto llega, se guarda y se muestra, sin exigirle conocer el mecanismo.

### 3.4 Viabilidad técnica

| Criterio | Dictamen | Fundamento |
| --- | --- | --- |
| Factibilidad | **Viable** | `Buffer` y `node:crypto` de Node.js; `xlsx` y `mammoth` ya eran dependencias del proyecto. |
| Compatibilidad | **Retrocompatible** | El contrato público (`base64`, `fileName`) no cambia; se añaden verificaciones internas. |
| Costo | **Bajo** | Un módulo nuevo (`base64Transport.ts`), un módulo de acceso (`viewerAccess.ts`) y renderizadores adicionales. |
| Riesgo de regresión | **Controlado** | 343 pruebas automatizadas; las cuatro fronteras conservan su firma y su semántica de error. |
| Deuda técnica | **Reducida** | Se elimina la cuádruple duplicación de decodificación. |
| Seguridad | **Mejorada** | Límites verificados antes de decodificar, vales con caducidad, `nosniff`, `Cross-Origin-Resource-Policy`. |

### 3.5 Límites declarados

- La detección por contenido **no es infalible**: los formatos heredados `.doc`
  y `.xls` comparten firma OLE y no se distinguen entre sí; CSV y TXT carecen de
  firma. En esos casos se recurre a la extensión declarada.
- La detección **no sustituye** un análisis antimalware, que sigue pendiente.
- El vale del visor es una **capacidad acotada** (alcance + recurso + caducidad),
  no una elevación de privilegios: sigue exigiendo rol de administración para
  acuñarlo.

---

## 4. Solución implementada

### A) Transporte a RAG en base64 (y desde ApiChat)

**Módulo `server/base64Transport.ts`** — contrato único de transporte:

- `createTransportEnvelope`: construye el sobre (versión, nombre, MIME,
  extensión, peso, `sha256`, base64).
- `decodeTransport`: decodifica y **reconstruye el archivo normal**. Precedencia
  de la extensión final: firma de contenido → extensión declarada → MIME
  declarado → `bin`.
- `decodeRemoteAttachment`: acepta `data:` URI o URL remota (HTTPS, con límite
  de tiempo y de peso) y devuelve el mismo contrato.
- `detectContentSignature`: identifica por *magic bytes* PDF, PNG, JPEG, GIF,
  WebP, MP4, MP3, WAV, OGG, DOCX y XLSX.
- `reconstructTransportFileName`: corrige el nombre visible cuando el contenido
  demuestra un tipo distinto.
- Mapeo MIME→extensión **explícito** (no derivado), porque `image/jpeg` es
  ambiguo entre `jpg` y `jpeg` y un mapa derivado produciría extensiones
  distintas para cargas equivalentes.

**Integración en las cuatro fronteras:**

| Frontera | Antes | Ahora |
| --- | --- | --- |
| Carga del RAG (`routers.upload`) | Extensión declarada, sin verificación | `decodeTransport` con `allowMismatch: false`, nombre reconstruido, `sha256` auditado |
| Recepción ApiChat (`inboxSync`) | Decodificación propia | `decodeRemoteAttachment` (data URI o URL) |
| Webhook ApiChat (`apiChatWebhook`) | Decodificación propia | `decodeRemoteAttachment` |
| Envío de bandeja (`inbox.sendInboxFile`) | Decodificación propia | `decodeTransport` + nombre reconstruido |

La auditoría de carga ahora registra: extensión final, extensión declarada,
MIME verificado, MIME detectado, indicador de discordancia, versión del
transporte y `sha256`.

### B) Visor que reproduce cualquier archivo representable

1. **Acceso por vale firmado** (`server/viewerAccess.ts`): HMAC-SHA256 sobre
   `alcance:recurso:caducidad`, con vigencia de 15 minutos, verificación en
   tiempo constante y separación de alcances (`knowledge` / `inbox`). La sesión
   sigue siendo la vía primaria; el vale cubre las peticiones del navegador.
2. **Renderizadores completos** (`server/knowledge.ts`):
   - `renderDocxHtml`: documento HTML completo con tema, tablas e imágenes
     embebidas en base64.
   - `renderCsvPreview`: tabla HTML con detección de delimitador (`;`, `,`,
     tabulación, `|`) y comillas escapadas.
   - `renderSpreadsheetHtml`: primera hoja de `.xlsx`/`.xls` convertida a tabla.
   - `renderPlainTextPreview`: texto plano escapado.
3. **Cabeceras del visor**: `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`.
4. **Cliente** (`MstEir.tsx`): el visor solicita el vale vía tRPC y lo anexa a
   las direcciones; cubre imagen, video, audio, PDF, DOCX, CSV, XLSX, XLS y TXT.

### C) Verificación automatizada

| Prueba | Cobertura |
| --- | --- |
| `server/base64Transport.test.ts` (26) | Round-trip, data URI, saltos de línea, precedencia del contenido, política de extensiones, límites de peso, *magic bytes*, ambigüedad MIME, recepción remota |
| `server/viewerAccess.test.ts` (7) | Alcance exacto, separación de alcances, vencimiento, firma manipulada, caducidad forjada, entradas malformadas |
| Regresión | **343 de 343** pruebas |
| Gobernanza | `pnpm release:verify` y `pnpm test:black-box` (21 de 21) aprobados |
| Build | Aprobado |

---

## 5. Trazabilidad con los marcos declarados

| Referencia | Evidencia aportada por esta solución |
| --- | --- |
| ISO/IEC 25010:2023 | Adecuación funcional (visor universal), fiabilidad (verificación por contenido), seguridad (vales y cabeceras), mantenibilidad (una sola implementación de transporte). |
| ISO/IEC 27001:2022 | Control de acceso acotado por recurso y tiempo; minimización; integridad mediante `sha256`. |
| ISO/IEC/IEEE 29119-1:2022 | Cajas negras sobre contratos públicos (decodificación, vales, límites). |
| ISO/IEC 42001:2023 | Trazabilidad y transparencia: la auditoría declara qué se verificó y qué se detectó. |
| DORA | Capacidades habilitadoras: pruebas y build reproducible que sostienen el cambio. No constituye medición de las cinco métricas. |

Estas referencias son metodológicas y **no constituyen certificación**.

---

## 6. Límites y trabajo pendiente

1. **Análisis antimalware** del contenido decodificado antes de persistirlo.
2. **Detección fina de `.doc` y `.xls`** (firma OLE compartida) y de CSV/TXT
   (sin firma): requieren inspección interna del contenedor.
3. **`.doc` heredado** permanece sin vista previa integrada y se ofrece en
   descarga, con indicación de convertir a `.docx`.
4. **Reproductores de video y audio** dependen del códec del navegador, no del
   artefacto.
5. **Cola durable de medios**: la recepción persiste el archivo, pero la
   transcripción y el análisis de audio en producción siguen pendientes según la
   documentación vigente.
