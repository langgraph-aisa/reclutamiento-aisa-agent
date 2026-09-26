# Análisis de la custodia del RAG en Dropbox

Fecha de control: 2026-09-25. Alcance: `server/dropboxConnection.ts`,
`server/dropboxStorage.ts`, `server/dropboxProject.ts`, `server/knowledge.ts`,
`server/inboxFiles.ts`, `server/apiChatWebhook.ts`, `server/candidateKnowledge.ts`,
la migración `drizzle/migrations/0044_dropbox_custody.sql` y las hojas «Mi cuenta»,
«Configuración» y «Almacenamiento por proyecto».

Este documento describe la sustitución de Google Drive por Dropbox como **única
fuente de custodia** de los binarios del RAG de proyectos y del RAG personal de
cada candidato. No constituye certificación ISO/DORA ni validez jurídica.

## 1. Motivo

Google Drive obligaba a la institución a administrar una credencial de
plataforma en Google Cloud y a mantener su proyecto, su pantalla de
consentimiento y su cuota. Dropbox cubre la misma necesidad con un registro más
simple, con el mismo modelo de «carpeta de la aplicación» y con permisos
mínimos explícitos, de modo que la operación depende de un único proveedor y no
de dos.

La decisión de fondo no cambia: **el binario vive en la cuenta de la persona que
respalda el proyecto**, no en el volumen del servidor. La institución actúa como
puente —escribe, lee y entrega— y la persona conserva el control: si revoca el
acceso desde su cuenta, conserva sus archivos organizados.

## 2. Modelo de acceso

| Pieza | Dónde vive | Quién la administra |
| --- | --- | --- |
| App key y app secret | `integration_settings` con proveedor `dropbox`, el secreto cifrado | Configuración · administrador |
| `refresh_token` por persona | `integration_settings` con clave `refresh:<usuario>`, cifrado | «Mi cuenta» · la propia persona |
| Cuenta que respalda el proyecto | `knowledge_projects.dropbox_connection_user_id` | Hoja «Almacenamiento por proyecto» |
| Modo de custodia | `knowledge_projects.storage_mode` (`local` o `dropbox`) | Hoja «Almacenamiento por proyecto» |

La aplicación se registra con **acceso «App folder»**: Dropbox solo expone la
carpeta `Aplicaciones/JARVI RH` de la cuenta, de modo que la institución nunca
alcanza el resto del contenido personal. Los permisos solicitados son
`files.content.read`, `files.content.write` y `files.metadata.read`.

El flujo OAuth usa `token_access_type=offline`, que es lo que devuelve el
`refresh_token` de larga duración; el estado entre inicio y retorno se firma con
`JWT_SECRET` y caduca a los diez minutos. La credencial de plataforma **no se
declara configurada por el formato del texto cifrado, sino por descifrarla**: una
rotación de `AGENT_SETTINGS_ENCRYPTION_KEY` deja un secreto ilegible y el panel
lo declara «indescifrable» con su causa.

## 3. Jerarquía visible y decisiones de diseño

El resolutor de rutas compone la jerarquía que la persona ve en su equipo:

```
Aplicaciones/JARVI RH/
└── <Proyecto>/
    ├── <archivo del RAG institucional>
    └── <Plaza>/
        └── <Candidato>/
            ├── <archivo del RAG personal>
            └── Bandeja/
                ├── in-<conversación>/
                └── out-<conversación>/
```

- **Los nombres visibles se sanean** —se retira la barra, los caracteres de
  control y los puntos suspensivos— pero **se conservan los acentos y los
  espacios**, porque el criterio es la navegación de la persona.
- **El nombre del archivo es el del catálogo** —el que la persona escribió al
  cargarlo— con un ordinal determinista para los homónimos (`Informe (2).pdf`,
  en el orden de carga). Hasta 2.0.240 el archivo llevaba la clave de
  almacenamiento (`<uuid>.<ext>`) y el nombre original solo vivía en la
  aplicación; el argumento era que dos documentos distintos pueden compartir
  nombre original y sobrescribirse en silencio bajo `mode: overwrite`. El
  ordinal resuelve ese riesgo sin renunciar a la correspondencia —lo que se ve
  en Dropbox es lo que se ve en el RAG— y la ruta anterior se conserva como
  respaldo de lectura (`legacyPathResolver`), de modo que los documentos ya
  custodiados siguen abriéndose.
- **La bandeja conversacional conserva además su copia local**, porque la ruta
  `/api/inbox/files/:key` entrega por lectura posicional del volumen; la custodia
  visible para la persona es el documento del RAG personal, que sí se escribe en
  Dropbox.
- **La migración es explícita**: activar Dropbox sin migrar no hace desaparecer
  los documentos ya cargados —la lectura degrada al volumen local—, y el botón
  «Migrar» copia los binarios antes de conmutar el modo.

## 4. El webhook de ApiChat

`processApiChatMessage` resuelve el adjunto, lo escribe en la bandeja y, para
los mensajes entrantes, lo incorpora al RAG personal con
`registerCandidateInboundDocument`. Esa incorporación pasa por
`writeKnowledgeFile`, que resuelve el backend de la clave
`applications/<postulación>/<uuid>.<ext>`: si el proyecto de la postulación está
activado en Dropbox, el documento se escribe en
`<Proyecto>/<Plaza>/<Candidato>/` y su análisis de currículum se encola igual que
antes. No hay una segunda ruta ni un paso manual.

## 5. Vestigios retirados

- Se retiran `server/driveConnection.ts`, `server/driveStorage.ts` y
  `server/driveProject.ts` con sus pruebas.
- El router `storage` y las claves `config.dropboxOAuthConfiguration`,
  `config.dropboxOAuthDiagnostics` y `config.saveDropboxOAuthSecret` sustituyen a
  las anteriores; «Mi cuenta» y «Configuración» dejan de nombrar el proveedor
  retirado.
- La migración `0044_dropbox_custody.sql` elimina las credenciales
  `google_drive` de `integration_settings`, renombra la columna a
  `dropbox_connection_user_id` —y su restricción de llave foránea—, conmuta a
  `dropbox` los proyectos que custodiaban en Drive y amplía la restricción del
  modo de almacenamiento.
- El artefacto `database/005_servicio_conversacional_listo.sql` incorpora la
  migración y sigue siendo idempotente.

## 6. Riesgos y límites declarados

- **Cuota de la cuenta**: la custodia consume el espacio de la persona. El
  modelo lo asume de forma explícita: es el precio de la privacidad y de no
  administrar almacenamiento ajeno.
- **Revocación**: si la persona revoca el acceso, la entrega falla con la causa
  nombrada `dropbox_unauthenticated` y el visor pide reconectar la cuenta; el
  registro continúa y los archivos permanecen en su Dropbox.
- **Latencia**: la jerarquía se crea una vez por instancia y se memoriza, de modo
  que un lote no repite la creación de carpetas.
- **Migración aplicada**: la `0044` es idempotente y no se revierte
  automáticamente; volver a Google Drive exigiría una entrega nueva.
