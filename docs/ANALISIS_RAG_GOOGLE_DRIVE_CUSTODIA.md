# Análisis de viabilidad técnica: Google Drive como capa de custodia del RAG de proyectos y del RAG del candidato

Fecha de control: 2026-09-22. Alcance: `server/knowledge.ts`, `server/candidateKnowledge.ts`, `server/inboxFiles.ts`, `server/base64Transport.ts`, `server/viewerAccess.ts`, `server/knowledgeRoutes.ts`, `server/candidateConservedRecovery.ts` y la hoja «Mi cuenta». Este documento analiza la viabilidad de sustituir el volumen local `KNOWLEDGE_STORAGE_DIR` por el Google Drive del propietario del proyecto; no constituye certificación ISO/DORA ni validez jurídica.

## 1. Objeto

El artefacto declara el catálogo del RAG en PostgreSQL y conserva los binarios en un volumen local. La cadena de custodia se rompe por la misma razón en las dos superficies —el RAG de proyectos y el RAG personal del candidato—: **el binario y su registro viven en dos sistemas distintos**, y el despliegue puede restaurar la base sin su volumen. El síntoma es el aviso «N de M documentos no están en el volumen de almacenamiento» observado en producción. El objeto es trasladar la custodia del binario a un servicio externo —Google Drive— que ya provee infraestructura, durabilidad y cifrado, de modo que el documento permanezca visible mientras el propietario autorice el acceso, sin que el artefacto posea la infraestructura de almacenamiento.

## 2. Diagnóstico: dónde se rompe la cadena de custodia hoy

### 2.1 Inventario de la capa de almacenamiento

| Función | Archivo | Comportamiento |
| --- | --- | --- |
| `knowledgeStorageDirectory()` | `server/knowledge.ts` | Resuelve `KNOWLEDGE_STORAGE_DIR` (defecto `./data/knowledge-files`). |
| `knowledgeFilePath` / `buildStorageKey` | `server/knowledge.ts` | RAG de proyectos: `<proyecto>/<uuid>.<extensión>`, patrón confinado sin `..`. |
| `buildCandidateStorageKey` | `server/knowledge.ts` | RAG del candidato: `applications/<postulación>/<uuid>.<extensión>`. |
| `writeKnowledgeFile` / `readKnowledgeFile` / `removeKnowledgeFile` / `knowledgeFileStats` | `server/knowledge.ts` | Escritura y lectura del binario contra el sistema de archivos local. |
| `inboxFilesDirectory()` / `writeInboxFile` / `readInboxFile` | `server/inboxFiles.ts` | Bandeja conversacional, en `…/inbox-files`, con escritura atómica (`tmp` + `rename`). |
| `knowledgeStorageHealth` | `server/knowledge.ts` | Compara catálogo y volumen; informa ausentes (el aviso de la pantalla). |

### 2.2 Las cuatro rupturas

1. **Durabilidad.** El volumen es efímero si no se monta persistente en EasyPanel. Una base restaurada sin su volumen deja filas válidas apuntando a binarios ausentes —el caso observado—.
2. **Transporte.** El transporte canónico (`base64Transport.ts`) decodifica el contenido textual del navegador o de ApiChat y exige, para la descarga de una dirección, `https` y destino público. Una dirección sin cifrado o interna se declara `unsafe_destination` y no se descarga; la cadena de custodia no acredita integridad de lo que viaja sin cifrar.
3. **Visor.** El visor (`viewerAccess.ts` + `knowledgeRoutes.ts` + `inboxFiles.ts`) acuña un vale firmado de quince minutos y sirve el binario con `sendRange` desde el sistema de archivos local. Sin binario local, el visor responde 410 con causa.
4. **Atribución.** El RAG del candidato distingue «recibido» de «incorporado» y de «interpretado»; el fallo de almacenamiento se confunde con una ausencia del candidato cuando el binario no está, en lugar de declararse como defecto de infraestructura.

## 3. Viabilidad técnica de Google Drive como backend de custodia

### 3.1 Requisitos frente a capacidades de Drive API v3

| Requisito del artefacto | Capacidad de Drive API v3 | Veredicto |
| --- | --- | --- |
| Escribir binario con clave propia | `files.create` con metadatos y `media` | Viable |
| Leer binario | `files.get` con `alt=media` | Viable |
| Servir con rango (`Range`) para PDF/audio/video | Descarga parcial con `Range` sobre `alt=media` | Viable con verificación (ver §3.4) |
| Integridad (`sha256`) | Se calcula en el artefacto antes de subir; se re-verifica al leer | Viable |
| Aislamiento proyecto/candidato | Carpetas `JARVI RH/<proyecto>/<candidato>/` | Viable |
| Autorización mínima y revocable | Scope `drive.file` + OAuth 2.0 con `access_type=offline` | Viable |
| Visor por vale temporal | Redirección a descarga autenticada o proxy del servidor | Viable (§3.4) |
| Diagnóstico de ausencias | `files.get` con 404 → `storage_missing` | Viable |

### 3.2 Autorización: el propietario conserva la soberanía

- El scope es **`drive.file`**, no `drive` completo: la aplicación solo ve los archivos que crea o que el usuario comparte explícitamente. No es un scope restringido que exija auditoría CASA.
- El consentimiento es explícito y revocable desde `myaccount.google.com/permissions`; la revocación convierte el `refresh_token` en `invalid_grant` de inmediato.
- Los `refresh_token` se guardan **cifrados** en `integration_settings` con la misma maquinaria AES-256-GCM que ya usa el agente (`AGENT_SETTINGS_ENCRYPTION_KEY`), por usuario y por conexión; el navegador recibe estado y máscara, nunca el token.

### 3.3 Modelo de carpetas

```
Mi Drive/
└── JARVI RH/                    ← carpeta raíz de la conexión (la crea el sistema)
    └── Solar Guatemala/         ← carpeta por proyecto (proyecto de conocimiento)
        └── <uuid>.<ext>         ← documentos del RAG del proyecto
        └── candidatos/
            └── <postulación>/   ← carpeta por candidato del proyecto
                └── <uuid>.<ext> ← objetos del RAG personal
```

La correspondencia es biunívoca con las claves actuales: `<proyecto>/<uuid>.<ext>` y `applications/<postulación>/<uuid>.<ext>` se traducen a rutas de Drive sin reescribir la lógica de negocio. El propietario ve en su Drive exactamente la estructura que administra en el panel.

### 3.4 El punto quirúrgico: el visor con rango

El visor actual sirve el binario por `sendRange` desde `fs`. Con Drive hay dos vías:

- **Proxy de servidor.** La ruta `/api/knowledge/files/:id` descarga el contenido desde Drive (con el token del propietario) y lo devuelve al navegador. Para archivos pequeños —la mayoría de los documentos del RAG— basta la descarga completa; para PDF grandes se implementa `Range` re-encauzando el encabezado a `files.get` con `alt=media`. La ventaja: el navegador sigue recibiendo `same-origin` y las cabeceras de seguridad del visor se conservan sin cambio.
- **Enlace directo temporal.** `files.get` devuelve un `webContentLink` solo para archivos compartidos; usarlo exige una compartición temporal que expone el archivo durante la ventana. Se **descarta** por privacidad.

Se adopta el **proxy de servidor**: conserva el vale firmado, el alcance (`knowledge`/`candidate`/`inbox`), la caducidad y la cabecera `X-Content-Type-Options`, y no cambia el contrato del navegador.

### 3.5 Verificación requerida antes de comprometer el diseño

- Descarga parcial con `Range` sobre `alt=media` para PDF/audio/video: confirmar contra la instancia que el rango se respeta; en caso contrario, servir el archivo completo con `Accept-Ranges: none` y descarga única.
- Cuotas y límites de Drive (por usuario, por segundo) frente al volumen del RAG del candidato; la ingesta es diferida (`candidate_document_jobs`) y admite procesamiento por lotes.
- Latencia de la lectura del visor desde Drive frente a la lectura local; se mitiga con `Cache-Control` y, si el umbral lo exige, con una caché de solo lectura en memoria.

## 4. Análisis metodológico: custodia, minimización y continuidad

### 4.1 Cadena de custodia de cuatro eslabones

Con Drive, cada eslabón queda con un responsable y una prueba:

| Eslabón | Prueba |
| --- | --- |
| **Origen** (carga del navegador o webhook de ApiChat) | Sobre de transporte con `sha256` y tipo por contenido (`base64Transport.ts`). |
| **Ingreso** | `files.create` con nombre, MIME y `sha256` en los metadatos; el `fileId` se persiste en el catálogo. |
| **Lectura** | `files.get` con verificación de `sha256` antes de analizar o servir. |
| **Cierre** | Análisis, resumen y esencia asentados en `candidate_knowledge_files`/`knowledge_files`; el binario permanece en Drive. |

La ruptura que hoy separa catálogo y binario se cierra porque **la existencia del binario la garantiza el proveedor externo, no un montaje local**, y la ausencia se declara como `storage_missing` con el `fileId` de Drive, no como una ausencia del candidato.

### 4.2 Privacidad y minimización

- El alcance `drive.file` limita la lectura a lo que el propietario autorizó; la carpeta raíz la elige él en «Mi cuenta».
- Los embeddings y los resúmenes viven en PostgreSQL, no en Drive; Drive conserva solo el binario del documento, que ya es del propietario.
- La revocación detiene la lectura en el acto (`invalid_grant` → conexión marcada «revocada»); la política declara el plazo de retirada de los índices derivados.
- El visor sigue acotado por vale: Drive no se expone al navegador sin la sesión o el vale firmado.

### 4.3 Continuidad (DORA)

- **Resiliencia de almacenamiento**: Drive sustituye al volumen local; la caída del proveedor se detecta y se declara, sin confundirse con pérdida del candidato.
- **Reversibilidad**: un backend local permanece como respaldo de arranque para entornos sin conexión a Drive; la migración no borra el volumen hasta verificar la integridad del catálogo en Drive.
- **Trazabilidad**: cada escritura y cada lectura quedan en `audit_log` con actor, entidad y acción, como hoy.

## 5. Solución propuesta

### 5.1 Abstracción de almacenamiento (sin tocar los métodos vigentes)

Se introduce una interfaz con la semántica exacta de las funciones actuales:

```
StorageBackend = {
  write(key, data): Promise<string>
  read(key): Promise<Buffer>
  remove(key): Promise<void>
  stats(key): Promise<{ size, mtime }>
  stream(key, range?): AsyncIterable<Buffer>   // para sendRange
  health(): Promise<{ registered, present, missing, sample }>
}
```

Dos implementaciones: `LocalStorageBackend` (el código actual, movido sin cambio) y `DriveStorageBackend` (llamadas a Drive API v3). Las funciones públicas `writeKnowledgeFile`, `readKnowledgeFile`, `writeInboxFile`, `readInboxFile` y `knowledgeStorageHealth` se convierten en despachadores al backend activo, de modo que **los más de cuarenta puntos de llamada no cambian** y los métodos de extracción de resumen, análisis y esencia siguen idénticos.

### 5.2 Conexión en «Mi cuenta»

- Botón **«Conectar mi Drive»**: inicia OAuth 2.0 (`drive.file`, `access_type=offline`, `prompt=consent`), recibe el `refresh_token`, lo cifra y lo vincula al usuario.
- Un **select de proyecto propietario**: el usuario elige el proyecto de conocimiento del que es responsable; el sistema crea `JARVI RH/<Proyecto>` y, al llegar cada candidato, `candidatos/<postulación>`.
- Estado visible: conexión «Configurada», proyecto asignado, y un botón «Desconectar» que revoca el token (`POST /oauth2.googleapis.com/revoke`) y elimina las credenciales sin tocar los archivos del Drive.

### 5.3 El ciclo de vida del adjunto termina en el RAG

- Un archivo que cae al RAG —cargado, heredado por webhook de ApiChat o incorporado desde la bandeja— ejecuta el mismo conducto: `persistCandidateDocument`/`persistKnowledgeDocument` escriben en Drive, asientan el `fileId`, encolan el análisis y generan resumen y esencia.
- El enlace HTTP del visor permanece como **auditoría temporal** (vale de quince minutos), y el botón **«Cargar al RAG»** persiste como vía manual: si la incorporación automática falla, descarga el binario desde la dirección declarada y lo sube a Drive con la procedencia asentada.

### 5.4 Migración sin pérdida

1. Lectura del volumen actual; para cada binario presente, cálculo de `sha256` y verificación contra el catálogo.
2. Subida a Drive por proyecto y por candidato, conservando `storage_key` como referencia y añadiendo `drive_file_id`.
3. Verificación de integridad del catálogo completo; solo entonces se conmuta el backend.
4. El volumen local queda como respaldo de arranque, no como fuente de verdad.

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Revocación del acceso por el propietario | Detección `invalid_grant` → estado «revocada» + aviso; los archivos del Drive no se tocan. |
| Cuota o latencia de Drive | Ingesta diferida por cola (`candidate_document_jobs`), `Cache-Control` y respaldo local. |
| Rango no soportado por `alt=media` | Servir completo con `Accept-Ranges: none`; verificación en §3.5. |
| Claves OAuth en el repo | Secretos cifrados en `integration_settings`; el `client_secret` vive en EasyPanel como hasta ahora. |
| Colisión de nombres entre proyecto y postulación | Rutas separadas por carpeta (`proyecto` vs `proyecto/candidatos/<postulación>`), sin ambigüedad. |

## 7. Plan de implementación por fases

1. **`StorageBackend` + backend local** (refactor sin cambio de comportamiento; las puertas actuales siguen en verde).
2. **OAuth y conexión en «Mi cuenta»** (consentimiento, cifrado del token, select de proyecto, desconexión).
3. **`DriveStorageBackend`** (escritura, lectura, estadísticas, `health`, proxy del visor con rango).
4. **Provisionamiento de carpetas** por proyecto y por candidato, y `drive_file_id` en el catálogo.
5. **Migración y verificación** del volumen existente, con conmutación reversible.
6. **Caja negra** `BN-DRIVE-*`: conexión, carpeta por proyecto/candidato, visor desde Drive, revocación, y «Cargar al RAG» manual como respaldo.

## 8. Decisión recomendada

La viabilidad es **afirmativa y acotada**: Drive sustituye al volumen local como capa de custodia sin alterar el transporte canónico, el visor por vale ni los métodos de análisis del RAG. La única pieza que exige verificación empírica es la descarga con rango para PDF/audio/video; de no confirmarse, se sirve completo y el contrato del visor se mantiene. La soberanía queda en el propietario —él autoriza su Drive, elige su proyecto y puede desconectar— y el defecto de «N de M documentos no están en el volumen» deja de ser un modo de fallo estructural, porque el binario ya no depende de un montaje local.
