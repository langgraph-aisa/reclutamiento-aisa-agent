#import "report-theme.typ": report-accent, report-theme

#show: report-theme.with(
  title: "Guía técnica de implementación",
  author: "Manus AI",
  rhythm: "report",
  running-header: true,
)

#let navy = rgb("0B2A4A")
#let mint = rgb("B8F0D2")
#let pale = rgb("F3F7F5")
#let amber = rgb("FFF0C7")
#let redp = rgb("FFE1DE")
#let ink = rgb("263746")
#let flow-node(label, fill: pale) = box(width: 3.25cm, inset: 8pt, radius: 7pt, fill: fill, stroke: 0.7pt + navy)[#align(center)[#text(size: 8pt, weight: "bold", fill: navy)[#label]]]
#let small-note(body) = block(fill: pale, inset: 9pt, radius: 6pt, stroke: 0.5pt + luma(190))[#text(size: 8.5pt, fill: ink)[#body]]

// ---------- Portada ----------
#page(margin: (top: 27%, x: 2.2cm), numbering: none, header: none)[
  #set par(first-line-indent: 0em)
  #align(center)[
    #text(size: 27pt, weight: "bold", fill: report-accent)[Guía técnica de implementación]
    #v(0.7em)
    #text(size: 15pt, fill: luma(80))[Talento Claro · Reclutamiento automatizado por plaza]
    #v(1.8em)
    #line(length: 42%, stroke: 1pt + report-accent)
    #v(1.6em)
    #text(size: 11pt, fill: ink)[Aplicación web, PostgreSQL, n8n, OpenAI/ChatGPT y ApiChat]
    #v(2.5em)
    #text(size: 10pt)[Documento para usuarios técnicos]
    #v(0.5em)
    #text(size: 9pt, fill: luma(95))[Versión de referencia: 5a988757 · 27 de agosto de 2026]
  ]
]

#page(numbering: none, header: none)[
  #outline(title: [Contenido], indent: 1.5em)
]
#counter(page).update(1)

= Resumen técnico

Talento Claro gestiona el ciclo de postulación y evaluación por plaza sin depender de hojas de cálculo. La aplicación pública recibe respuestas desde teléfonos móviles; el panel protegido permite mantener plazas, formularios, preguntas, reglas, candidatos, catálogo geográfico e informes; PostgreSQL conserva la información transaccional; y n8n coordina la evaluación, la revisión humana diferida y la mensajería de WhatsApp.

La decisión técnica más importante es separar tres responsabilidades. La aplicación es la fuente de configuración y operación; PostgreSQL es la fuente de verdad; n8n es la capa de orquestación e integración. Esta separación permite modificar reglas sin editar manualmente cada workflow y evita que una hoja externa cambie de estructura sin control.

#table(
  columns: (3.4cm, 5.2cm, 5.2cm),
  inset: 7pt,
  fill: (x, y) => if y == 0 { navy } else if calc.rem(y, 2) == 0 { pale } else { white },
  table.header[*Capa*][*Responsabilidad*][*Punto de configuración*],
  [Frontend público], [Formulario por plaza, validaciones y confirmación], [`/apply/{public_slug}`],
  [Panel interno], [Administración, candidatos, informes y catálogo], [`/admin/*`],
  [API tRPC], [Contratos tipados y autorización por rol], [`/api/trpc`],
  [PostgreSQL], [Datos transaccionales y auditoría], [`DATABASE_URL`],
  [n8n], [Workflows maestros y agentes por plaza], [Credenciales y URLs de producción],
  [ApiChat], [WhatsApp de candidatos y reclutadores], [`APICHAT_*`],
)

#small-note[
  *Criterio de operación.* Las credenciales reales no deben guardarse en JSON, código fuente ni documentación. Se configuran en EasyPanel, n8n o el almacén de secretos correspondiente.
]

= Arquitectura de despliegue

El despliegue objetivo utiliza una VPS de Google administrada con EasyPanel. La aplicación y n8n pueden compartir dominio raíz mediante un proxy inverso, pero deben permanecer como servicios independientes. PostgreSQL debe ser accesible desde ambos servicios mediante red privada o reglas de firewall controladas.

#figure(
  caption: [Arquitectura lógica de producción],
  supplement: [Diagrama],
  kind: "diagram",
  grid(
    columns: (3.5cm, 0.7cm, 3.5cm, 0.7cm, 3.5cm),
    gutter: 10pt,
    align: center + horizon,
    flow-node([Candidato móvil], fill: mint), [→], flow-node([Aplicación web\nReact + Express]), [→], flow-node([PostgreSQL], fill: amber),
    [ ], [ ], [↕], [ ], [↕],
    flow-node([Facebook / Instagram]), [→], flow-node([n8n maestro], fill: mint), [→], flow-node([Agentes por plaza], fill: mint),
    [ ], [ ], [↕], [ ], [→],
    [ ], [ ], flow-node([OpenAI / ChatGPT]), [→], flow-node([ApiChat / WhatsApp], fill: amber),
  ),
)

#table(
  columns: (3.5cm, 4.3cm, 6cm),
  inset: 7pt,
  fill: (x, y) => if y == 0 { navy } else { white },
  table.header[*Servicio*][*Configuración*][*Verificación técnica*],
  [Aplicación], [`pnpm build` y `pnpm start`], [El puerto lo inyecta EasyPanel mediante `PORT`; no fijarlo en código.],
  [PostgreSQL], [`DATABASE_URL` + SSL si aplica], [Probar conexión desde aplicación y desde n8n.],
  [n8n], [URL pública HTTPS], [Activar workflows y copiar URLs de producción de los nodos Webhook.],
  [Proxy inverso], [Dominio y certificados], [Separar rutas de aplicación y editor/webhooks de n8n.],
)

= Flujo de postulación pública

El enlace publicado en Facebook o Instagram debe identificar una sola plaza. El candidato no debe poder cambiar la plaza editando un número incremental. El `public_slug` combina el código de la plaza con un sufijo aleatorio y se resuelve en PostgreSQL.

#figure(
  caption: [Proceso de postulación y control de duplicados],
  supplement: [Diagrama],
  kind: "diagram",
  grid(
    columns: (3.6cm, 0.6cm, 3.6cm, 0.6cm, 3.6cm), gutter: 9pt, align: center + horizon,
    flow-node([Abrir URL segura], fill: mint), [→], flow-node([Cargar plaza y formulario]), [→], flow-node([Confirmar plaza]),
    [ ], [ ], [↓], [ ], [↓],
    flow-node([Completar preguntas]), [→], flow-node([Enviar formulario]), [→], flow-node([Normalizar teléfono]),
    [ ], [ ], [↘], [ ], [↓],
    [ ], [ ], flow-node([¿Teléfono + plaza existe?], fill: amber), [→], flow-node([Sí: aviso y HTTP 409], fill: redp),
    [ ], [ ], [↓], [ ], [ ],
    [ ], [ ], flow-node([No: transacción PostgreSQL]), [→], flow-node([Evaluar agente]),
  ),
)

#small-note[
  *Regla de persistencia.* El navegador puede conservar temporalmente el estado visual del formulario, pero el servidor no debe crear candidato, aplicación ni respuestas hasta recibir el envío final.
]

== Payload de referencia

```json
{
  "token": "vendedor-guatemala-a1b2c3d4",
  "fullName": "Nombre del candidato",
  "email": "candidato@example.com",
  "phone": "5555-5555",
  "answers": {
    "experiencia_meses": 18,
    "sabe_conducir": "Sí"
  }
}
```

La función SQL `process_public_application` ejecuta la comprobación y la inserción dentro de una transacción. La restricción única de la base protege contra solicitudes concurrentes que lleguen al mismo tiempo.

= Modelo de datos y transacciones

#figure(
  caption: [Relaciones principales del modelo],
  supplement: [Diagrama],
  kind: "diagram",
  grid(
    columns: (3.3cm, 0.6cm, 3.3cm, 0.6cm, 3.3cm, 0.6cm, 3.3cm), gutter: 6pt, align: center + horizon,
    flow-node([job_positions], fill: mint), [→], flow-node([application_forms]), [→], flow-node([form_questions]), [→], flow-node([application_answers]),
    [↓], [ ], [↓], [ ], [ ], [ ], [ ],
    flow-node([candidates], fill: amber), [→], flow-node([applications], fill: mint), [→], flow-node([evaluations]), [→], flow-node([conversations]),
    [ ], [ ], [↓], [ ], [↓], [ ], [↓],
    [ ], [ ], flow-node([audit_log]), [ ], flow-node([internal_alert_recipients]), [ ], flow-node([integration_settings]),
  ),
)

#table(
  columns: (4.3cm, 5.5cm, 4.6cm), inset: 7pt,
  fill: (x, y) => if y == 0 { navy } else if calc.rem(y, 2) == 0 { pale } else { white },
  table.header[*Operación*][*Transacción*][*Resultado esperado*],
  [Recepción pública], [Plaza + candidato + aplicación + respuestas], [Aplicación nueva o duplicado idempotente.],
  [Evaluación], [Reglas + evaluación + estado + respuestas deterministas], [Motivo, perfil y estado persistidos.],
  [Cambio humano], [Auditoría + estado + webhook n8n], [Ventana de diez minutos programada.],
  [WhatsApp], [Mensaje + conversación + estado de integración], [Éxito o error registrable sin exponer token.],
)

= Constructor de formularios y agentes

Cada plaza tiene un formulario asociado y un agente de evaluación. La pantalla administrativa conserva título, introducción, preguntas, orden, publicación y reglas. La pregunta es la unidad configurable de decisión.

#table(
  columns: (3.8cm, 4.6cm, 6cm), inset: 7pt,
  fill: (x, y) => if y == 0 { navy } else { white },
  table.header[*Propiedad*][*Ejemplo*][*Uso técnico*],
  [Tipo], [Texto, textarea, select, number, phone], [Control de captura y validación.],
  [Obligatoria], [true], [Impide enviar respuestas incompletas.],
  [Respuestas aceptadas], [Sí, Guatemala], [Comparación determinista para requisitos cerrados.],
  [Descarte directo], [hardFail = true], [Una discordancia cambia el resultado a no calificado.],
  [Rango], [min = 12 o minMonths = 12], [Experiencia y valores cuantitativos.],
  [Dependencia], [dependsOn = tipo_de_vehiculo], [Activa una condición según otra respuesta.],
  [Criterio IA], [Convertir meses y exigir mínimo anual], [Razonamiento de respuestas abiertas.],
)

#figure(
  caption: [Secuencia de evaluación por agente/plaza],
  supplement: [Diagrama],
  kind: "diagram",
  grid(
    columns: (3.5cm, 0.6cm, 3.5cm, 0.6cm, 3.5cm), gutter: 9pt, align: center + horizon,
    flow-node([Webhook del agente], fill: mint), [→], flow-node([Cargar reglas de la plaza]), [→], flow-node([Evaluar reglas deterministas]),
    [ ], [ ], [↓], [ ], [↓],
    flow-node([¿hardFail?], fill: amber), [→], flow-node([OpenAI/ChatGPT + parser]), [→], flow-node([Combinar resultados]),
    [ ], [ ], [↙], [ ], [↓],
    flow-node([No calificado], fill: redp), [←], flow-node([Calificado], fill: mint), [→], flow-node([finalize_application_evaluation]),
  ),
)

La plantilla `02_agente_plaza_template.json` debe duplicarse por plaza. La configuración de reglas se consulta desde PostgreSQL; no se recomienda incrustar criterios de negocio en expresiones estáticas del workflow.

= IA y salida estructurada

El nodo nativo `OpenAI Chat Model` de n8n se conecta al chain LLM y al `Structured Output Parser`. La IA recibe el contexto de la plaza, las reglas deterministas y las respuestas abiertas. Debe devolver JSON válido y no texto libre.

```json
{
  "status": "calificado",
  "reason": "Cumple la experiencia mínima y los requisitos esenciales.",
  "profileSummary": "Perfil comercial con experiencia comprobable en atención.",
  "keyPoints": ["18 meses de experiencia", "Disponibilidad confirmada"],
  "confidence": 0.92,
  "ruleResults": [
    {"question_id": 12, "result": "passed"}
  ]
}
```

La aplicación debe conservar el texto original de las respuestas, la evaluación estructurada, el modelo utilizado y la fecha de evaluación. La confianza es un dato de apoyo para revisión; no reemplaza las reglas de descarte configuradas por el administrador.

= Revisión humana y ventana de diez minutos

Los cambios manuales de estado se registran con actor, fecha, estado anterior, estado nuevo y comentario. Solo el cambio humano a `Calificado` activa la espera. La continuación posterior debe revalidar el estado en PostgreSQL.

#figure(
  caption: [Control de continuación diferida],
  supplement: [Diagrama],
  kind: "diagram",
  grid(
    columns: (3.5cm, 0.6cm, 3.5cm, 0.6cm, 3.5cm), gutter: 9pt, align: center + horizon,
    flow-node([Cambio humano a Calificado], fill: mint), [→], flow-node([Webhook revisión]), [→], flow-node([Wait: 10 minutos], fill: amber),
    [ ], [ ], [↓], [ ], [↓],
    flow-node([Reconsulta PostgreSQL]), [→], flow-node([¿Sigue Calificado?]), [→], flow-node([Sí: Execute Workflow]),
    [ ], [ ], [↘], [ ], [↓],
    [ ], [ ], flow-node([No: cancelar], fill: redp), [ ], flow-node([WhatsApp / entrevista], fill: mint),
  ),
)

La persistencia de ejecuciones de n8n debe estar habilitada para que `Wait` pueda reanudar la ejecución. El webhook debe ser idempotente y la consulta posterior debe usar `applicationId`, no únicamente el teléfono.

= WhatsApp y ApiChat

El workflow de WhatsApp recibe el ID de aplicación, el teléfono internacional, el mensaje por plaza y la lista de receptores internos. Los mensajes al candidato y las alertas internas se separan para que un error en un destinatario no oculte el estado de la aplicación.

#table(
  columns: (5cm, 4cm, 5.4cm), inset: 7pt,
  fill: (x, y) => if y == 0 { navy } else { white },
  table.header[*Variable*][*Obligatoria*][*Uso*],
  [`APICHAT_WEBHOOK_URL`], [No], [Callbacks o eventos entrantes.],
  [`APICHAT_CONNECT_TO`], [No], [Instancia o conexión de WhatsApp.],
  [`APICHAT_API_ENDPOINT`], [No], [Endpoint HTTP de envío.],
  [`APICHAT_ACCOUNT_ID`], [Sí], [Cuenta ApiChat.],
  [`APICHAT_TOKEN`], [Sí], [Token Bearer secreto.],
)

#small-note[
  *Advertencia.* La URL de edición de n8n con formato `/workflow/...` no es una URL de webhook. Activar el workflow, copiar la URL de producción del nodo Webhook y usar esa URL en la configuración.
]

= Roles y seguridad

El backend aplica autorización en los procedimientos tRPC. El rol administrador mantiene formularios, reglas, integraciones y catálogo. El rol reclutador opera candidatos, plazas e informes, pero no administra campos ni reglas.

#table(
  columns: (4.2cm, 4.4cm, 5.8cm), inset: 7pt,
  fill: (x, y) => if y == 0 { navy } else if calc.rem(y, 2) == 0 { pale } else { white },
  table.header[*Rol*][*Acceso*][*Restricción*],
  [Administrador], [Toda la aplicación], [Puede configurar reglas, integraciones, usuarios y catálogo.],
  [Reclutador], [Candidatos, plazas e informes], [No puede abrir constructor ni configuración.],
  [Candidato], [Formulario público de su plaza], [No tiene acceso al panel ni a otros candidatos.],
)

No registrar tokens en logs. Enmascarar teléfonos cuando los registros se exporten. Usar HTTPS para formularios y webhooks, límites de tamaño de solicitud, respaldo de PostgreSQL y políticas de retención de datos personales.

= Instalación paso a paso

== Preparación de EasyPanel

Crear servicios separados para la aplicación, n8n y PostgreSQL, o conectar PostgreSQL administrado. Configurar dominio HTTPS y red interna. En la aplicación, ejecutar `pnpm install --frozen-lockfile`, `pnpm build` y `pnpm start`. EasyPanel debe proporcionar `PORT`.

== Migraciones

Ejecutar en orden:

```bash
psql "$DATABASE_URL" -f drizzle/migrations/0000_smooth_jasper_sitwell.sql
psql "$DATABASE_URL" -f drizzle/migrations/0001_daffy_wendigo.sql
psql "$DATABASE_URL" -f drizzle/migrations/0002_same_bromley.sql
psql "$DATABASE_URL" -f database/001_functions.sql
psql "$DATABASE_URL" -f database/002_ine_catalog_seed.sql
```

Promover el usuario inicial mediante SQL controlado y luego iniciar sesión para comprobar la autorización. Las migraciones no deben ejecutarse sobre producción sin respaldo.

== Importación de n8n

Importar los cuatro JSON en este orden: maestro, plantilla de agente, revisión humana y WhatsApp. Duplicar el agente por cada plaza. Asignar las credenciales PostgreSQL y OpenAI/ChatGPT. Sustituir únicamente los marcadores de workflow IDs por referencias reales de la instalación.

== Configuración inicial

Crear una plaza de prueba con formulario no publicado. Agregar teléfono obligatorio, una pregunta `hardFail`, una pregunta con `minMonths = 12` y una respuesta abierta con criterio IA. Publicar cuando el agente haya sido probado.

= Pruebas y diagnóstico

#table(
  columns: (4.2cm, 5.4cm, 4.8cm), inset: 7pt,
  fill: (x, y) => if y == 0 { navy } else { white },
  table.header[*Prueba*][*Acción*][*Resultado esperado*],
  [Aplicación nueva], [Completar y enviar una vez], [Una aplicación y respuestas persistidas.],
  [Duplicado], [Repetir teléfono + plaza], [Aviso de solicitud previa y no hay segunda fila.],
  [Hard fail], [Responder requisito esencial incorrectamente], [`No calificado` y motivo.],
  [IA abierta], [Indicar experiencia en meses], [JSON estructurado y resumen de perfil.],
  [Espera humana], [Cambiar a calificado y esperar diez minutos], [Continúa solo si el estado no cambió.],
  [Cancelación], [Cambiar estado durante la espera], [No se envía WhatsApp.],
  [Permisos], [Entrar como reclutador a configuración], [Acceso denegado.],
  [ApiChat], [Enviar a número de prueba], [Mensaje y estado de conversación registrados.],
)

== Diagnóstico rápido

Si el login produce un error SSL, revisar `DATABASE_URL`, certificado, host, puerto y `sslmode` del proveedor. Si el formulario devuelve `404`, comprobar que la plaza y el formulario estén publicados y que el slug coincida. Si el agente no recibe la aplicación, revisar la URL de producción del webhook y el payload. Si `Wait` no reanuda, habilitar persistencia de ejecuciones en n8n. Si ApiChat falla, comprobar `APICHAT_ACCOUNT_ID`, `APICHAT_TOKEN`, endpoint, conexión y formato de teléfono.

= Archivos de la entrega

#table(
  columns: (6cm, 8.4cm), inset: 7pt,
  fill: (x, y) => if y == 0 { navy } else { white },
  table.header[*Archivo*][*Contenido*],
  [`docs/IMPLEMENTACION.md`], [Guía operativa general.],
  [`drizzle/schema.ts`], [Modelo de datos y tipos Drizzle.],
  [`drizzle/migrations/*.sql`], [Migraciones PostgreSQL.],
  [`database/001_functions.sql`], [Funciones transaccionales de postulación y evaluación.],
  [`database/002_ine_catalog_seed.sql`], [Carga inicial del catálogo geográfico.],
  [`n8n-workflows/*.json`], [Workflows importables de n8n.],
  [`scripts/validate_workflows.py`], [Validador estructural y semántico local.],
  [`reclutamiento-automatizado-entrega.zip`], [Paquete completo de aplicación sin secretos.],
)

= Referencias

[1] [Instituto Nacional de Estadística de Guatemala — catálogo de departamentos y municipios](https://www.ine.gob.gt/sistema/uploads/2016/10/28/0NiM1ouoHaN67SRO2IzXZ5RNI7FeyHpn.xls).

[2] [n8n — exportación e importación de workflows](https://docs.n8n.io/workflows/export-import/).

[3] [n8n — nodo OpenAI](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.openai/).

[4] [n8n — nodo Wait](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/).

#small-note[
  *Estado de la guía.* La documentación describe la versión entregada y los puntos que dependen de credenciales o infraestructura externa. La prueba real de PostgreSQL, OpenAI/ChatGPT y ApiChat debe ejecutarse en la VPS del usuario con valores de prueba controlados.
]
