# Talento AISA · instalación on-premise

## Alcance

Este proyecto contiene una aplicación web responsive para postulaciones y operación de reclutamiento, una base PostgreSQL transaccional, un catálogo inicial de departamentos y municipios de Guatemala y cuatro workflows JSON para n8n. Las credenciales permanecen fuera del repositorio.

> La configuración de la base de datos del entorno administrado de desarrollo no se utiliza para PostgreSQL. La migración se entrega para ejecutarse en la instancia PostgreSQL que se configure en EasyPanel.

## Componentes

| Componente                        | Responsabilidad                                                                       | Credencial pendiente                                 |
| --------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Aplicación React + Express + tRPC | Formulario público, panel, configuración e informes                                   | `DATABASE_URL`, autenticación del proveedor elegido  |
| PostgreSQL                        | Plazas, formularios, respuestas, candidatos, evaluaciones, conversaciones y auditoría | Usuario, contraseña, host, puerto, SSL               |
| n8n on-premise                    | Adaptador entrante ApiChat; los demás flujos son referencias importables              | Header Auth interno para el workflow 04               |
| ApiChat                           | Solicitud directa de CV por WhatsApp                                                  | Credenciales cifradas desde Configuración > WhatsApp |
| OpenAI                            | Razonamiento y servicios aislados de transcripción/TTS; no hay endpoint productivo de medios | Claves cifradas desde Agente de IA LangGraph |

## PostgreSQL

1. Crear una base PostgreSQL en EasyPanel y activar SSL si la red lo requiere.
2. Definir `DATABASE_URL` en la aplicación y ejecutar `pnpm db:push`; Drizzle aplica el journal hasta `0014_cognitive_governance.sql`.
3. Ejecutar `database/002_ine_catalog_seed.sql` si el catálogo geográfico aún no está cargado. Las zonas se mantienen administrables porque su fuente y granularidad operativa pueden variar.
4. Promover el primer usuario administrador por medio de SQL controlado, por ejemplo: `UPDATE users SET role='admin' WHERE email='correo-del-administrador';`.

Las funciones `process_public_application` y `finalize_application_evaluation` permanecen como soporte de los workflows históricos 01 y 02. No forman parte de la ruta vigente de postulación y evaluación del backend; no deben presentarse como dependencias del runtime actual.

## Variables de entorno

### Aplicación

`DATABASE_URL` es obligatorio para operación real. `JWT_SECRET`, las variables de OAuth del template y los valores `VITE_*` se gestionan desde la configuración segura del proyecto.

### n8n y evaluación

El runtime de evaluación no consulta `N8N_AGENT_EVALUATION_URL`, `N8N_MANUAL_STATUS_WEBHOOK_URL` ni `OPENAI_MODEL`. La evaluación se ejecuta en el backend y el envío ApiChat ocurre después de confirmar la operación local. El workflow 04 es la única excepción funcional: adapta mensajes entrantes desde la URL de n8n hacia el receptor autenticado del backend.

### ApiChat

ApiChat no utiliza variables de entorno en JARVI RH 2.0.130. Ejecute las migraciones y configure endpoint, conexión, webhook, Client ID, token y secreto del receptor desde Administración > Configuración > WhatsApp. Los secretos se cifran en el servidor antes de almacenarse en `integration_settings`; no se devuelven al navegador.

No copie la URL del editor de n8n (`/workflow/...`) como webhook. El nodo Webhook muestra su URL de producción después de activar el workflow 04; esa URL es la que debe guardar en Configuración > WhatsApp y registrar en ApiChat.

## Importación de n8n

Solo el workflow 04 interviene opcionalmente en el runtime vigente y lo hace como adaptador entrante. Los workflows 01 a 03 son referencias históricas para experimentación aislada:

1. `01_flujo_maestro_postulaciones.json` documenta el flujo maestro anterior; no recibe las postulaciones del runtime actual.
2. `02_agente_plaza_template.json` documenta una plantilla anterior; no sustituye al evaluador del backend.
3. `03_revision_humana_30s.json` conserva la referencia histórica de una espera que no existe en la operación vigente.
4. `04_whatsapp_apichat.json` recibe el sobre oficial `messages`, conserva únicamente texto entrante individual y lo normaliza para el backend. Configure «Cabecera interna Talento AISA» con `Authorization: Bearer <secreto>`, actívelo y confirme `/webhook/apichat/incoming`.

Para el único adaptador operativo, asigne solamente la credencial Header Auth interna al nodo «Entregar a Talento AISA». El marcador `PENDIENTE_WEBHOOK_HEADER` debe reemplazarse dentro de n8n sin guardar el secreto en el JSON. Las credenciales PostgreSQL/OpenAI y los demás marcadores pertenecen exclusivamente a los workflows históricos y no son requisitos del runtime.

El envío runtime de solicitud de CV no depende de credenciales n8n y se ejecuta directamente desde el backend después del commit, sin espera de 30 segundos. La recepción sí requiere el adaptador 04 activado cuando ApiChat está configurado con la URL de n8n. El receptor revalida cada texto mediante `GET /v1/messages` antes de resolver y persistir; una discordancia responde `422` y un fallo de verificación responde `500`. El workflow responde después del último nodo y desactiva la retención de ejecuciones en n8n.

## Publicación de la aplicación

La aplicación puede montarse en EasyPanel como servicio Node con el comando `pnpm build` y `pnpm start`. No hardcodear el puerto: EasyPanel debe inyectar `PORT`. El formulario público usa `/apply/{public_slug}` y el panel protegido usa `/admin`. Se recomienda servir HTTPS y colocar la aplicación y n8n bajo un proxy inverso con límites de solicitud adecuados.

## Pruebas de aceptación

Enviar una postulación completa y comprobar que solo se crea al pulsar `Enviar formulario`. Repetir el envío con el mismo teléfono y plaza para verificar el aviso de duplicado. Crear una regla `hardFail`, probar una respuesta incorrecta y confirmar `no_calificado`. Probar una respuesta abierta con experiencia expresada en meses y verificar que la IA devuelve JSON estructurado. Seleccionar **Solicitar CV por WhatsApp** (estado interno `calificado`) y comprobar el envío directo posterior al commit y el estado local de entrega; un resultado desconocido exige conciliación manual antes del reintento. En una recepción ficticia separada, verificar la deduplicación entrante por `providerMessageId`, la consulta al proveedor, el acuse posterior y la no retención en n8n.

## Validación de workflows y límites de la plantilla

Los workflows 01 a 03 se conservan como referencias importables. El workflow 04 es exclusivamente el adaptador entrante; el envío activo permanece en `server/cvRequest.ts`, `server/apiChatSettings.ts` y `server/apichat.ts`. Las pruebas automatizadas usan transportes simulados y no prueban el proveedor ni un endpoint productivo de medios.

Los valores `PENDIENTE` se mantienen deliberadamente en los artefactos históricos; `PENDIENTE_WEBHOOK_HEADER` permanece en el adaptador 04. No son secretos ni deben sustituirse por valores inventados: solo deben mapearse cuando se importe el workflow correspondiente en una instancia controlada.

El archivo `02_agente_plaza_template.json` funciona como plantilla histórica para experimentación aislada. No debe conectarse al runtime activo ni sustituir el evaluador del backend sin un diseño, autorización y prueba de integración independientes.

La fuente inicial del catálogo contiene 22 departamentos y 338 municipios. Las zonas no se tratan como nomenclatura nacional única dentro de la fuente inicial; por ello se dejaron como catálogo configurable, con importación JSON y mantenimiento administrativo de nombre y estado activo.

La aplicación se verificó con TypeScript, pruebas Vitest y build de producción. La prueba real de ApiChat debe ejecutarse desde el botón **Verificar** después de configurar las credenciales cifradas; esta acción consulta el estado y no envía mensajes. La alineación con ISO y DORA es metodológica: esta instalación no constituye certificación ISO, medición DORA completa ni validación psicométrica.
