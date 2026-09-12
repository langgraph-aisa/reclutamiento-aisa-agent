# Talento AISA · instalación on-premise

## Alcance

Este proyecto contiene una aplicación web responsive para postulaciones y operación de reclutamiento, una base PostgreSQL transaccional y un catálogo inicial de departamentos y municipios de Guatemala. La mensajería de WhatsApp es ApiChat directo desde el backend. Las credenciales permanecen fuera del repositorio.

> La configuración de la base de datos del entorno administrado de desarrollo no se utiliza para PostgreSQL. La migración se entrega para ejecutarse en la instancia PostgreSQL que se configure en EasyPanel.

## Componentes

| Componente                        | Responsabilidad                                                                       | Credencial pendiente                                 |
| --------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Aplicación React + Express + tRPC | Formulario público, panel, configuración e informes                                   | `DATABASE_URL`, autenticación del proveedor elegido  |
| PostgreSQL                        | Plazas, formularios, respuestas, candidatos, evaluaciones, conversaciones y auditoría | Usuario, contraseña, host, puerto, SSL               |
| ApiChat                           | Envío y recepción directos de WhatsApp desde el backend                                | Credenciales cifradas desde Configuración > WhatsApp |
| OpenAI                            | Razonamiento y servicios aislados de transcripción/TTS; no hay endpoint productivo de medios | Claves cifradas desde Agente de IA LangGraph |
| Langfuse + OpenTelemetry          | Trazas jerárquicas, consumo, latencia y calidad operacional                          | Claves cifradas desde Agente de IA LangGraph |

## PostgreSQL

1. Crear una base PostgreSQL en EasyPanel y activar SSL si la red lo requiere.
2. Definir `DATABASE_URL` en la aplicación y ejecutar `pnpm db:push`; Drizzle aplica el journal hasta `0014_cognitive_governance.sql`.
3. Ejecutar `database/002_ine_catalog_seed.sql` si el catálogo geográfico aún no está cargado. Las zonas se mantienen administrables porque su fuente y granularidad operativa pueden variar.
4. Promover el primer usuario administrador por medio de SQL controlado, por ejemplo: `UPDATE users SET role='admin' WHERE email='correo-del-administrador';`.

Las funciones `process_public_application` y `finalize_application_evaluation` permanecen como soporte de los workflows históricos 01 y 02. No forman parte de la ruta vigente de postulación y evaluación del backend; no deben presentarse como dependencias del runtime actual.

## Variables de entorno

### Aplicación

`DATABASE_URL` es obligatorio para operación real. `JWT_SECRET`, las variables de OAuth del template y los valores `VITE_*` se gestionan desde la configuración segura del proyecto.

### Sincronización de mensajes

El runtime de evaluación no consulta `N8N_AGENT_EVALUATION_URL`, `N8N_MANUAL_STATUS_WEBHOOK_URL` ni `OPENAI_MODEL`. La evaluación se ejecuta en el backend y el envío ApiChat ocurre después de confirmar la operación local. La recepción la resuelve el puente `inboxSync`, que cada segundo consulta `GET /v1/messages` de las conversaciones activas y registra entradas y salidas con deduplicación por `providerMessageId`.

### ApiChat

ApiChat no utiliza variables de entorno en JARVI RH 2.0.131. Ejecute las migraciones y configure endpoint, conexión, Client ID y token desde Administración > Configuración > WhatsApp. Los secretos se cifran en el servidor antes de almacenarse en `integration_settings`; no se devuelven al navegador.

### Langfuse

Langfuse tampoco requiere claves en EasyPanel. Conserve únicamente la raíz estable `AGENT_SETTINGS_ENCRYPTION_KEY`; ingrese las claves del proyecto desde Administración > Agente de IA LangGraph. Guarde cada credencial hasta ver **Configurada**, seleccione la misma región del proyecto, active la telemetría y verifique. La primera validación fuerza una traza diagnóstica. Consulte [OBSERVABILIDAD_LANGFUSE_2.0.131.md](OBSERVABILIDAD_LANGFUSE_2.0.131.md) antes del despliegue.

## Recepción directa

La recepción no requiere importar artefactos ni registrar URLs de reenvío: el puente `inboxSync` consulta el historial oficial `GET /v1/messages` cada segundo por conversación activa y rellena la bandeja con deduplicación por `providerMessageId`. Ante HTTP 429, el puente se pausa y retoma con espaciamiento automático.

## Publicación de la aplicación

La aplicación puede montarse en EasyPanel como servicio Node con el comando `pnpm build` y `pnpm start`. No hardcodear el puerto: EasyPanel debe inyectar `PORT`. El formulario público usa `/apply/{public_slug}` y el panel protegido usa `/admin`. Se recomienda servir HTTPS bajo un proxy inverso con límites de solicitud adecuados.

## Pruebas de aceptación

Enviar una postulación completa y comprobar que solo se crea al pulsar `Enviar formulario`. Repetir el envío con el mismo teléfono y plaza para verificar el aviso de duplicado. Crear una regla `hardFail`, probar una respuesta incorrecta y confirmar `no_calificado`. Probar una respuesta abierta con experiencia expresada en meses y verificar que la IA devuelve JSON estructurado. Seleccionar **Solicitar CV por WhatsApp** (estado interno `calificado`) y comprobar el envío directo posterior al commit y el estado local de entrega; un resultado desconocido exige conciliación manual antes del reintento. Confirmar que la bandeja rellena entradas y salidas desde `GET /v1/messages` con deduplicación por `providerMessageId`.

## Validación de workflows y límites de la plantilla

Los workflows 01 a 03 se conservan como referencias importables. El workflow 04 es exclusivamente el adaptador entrante; el envío activo permanece en `server/cvRequest.ts`, `server/apiChatSettings.ts` y `server/apichat.ts`. Las pruebas automatizadas usan transportes simulados y no prueban el proveedor ni un endpoint productivo de medios.

Los valores `PENDIENTE` se mantienen deliberadamente en los artefactos históricos; `PENDIENTE_WEBHOOK_HEADER` permanece en el adaptador 04. No son secretos ni deben sustituirse por valores inventados: solo deben mapearse cuando se importe el workflow correspondiente en una instancia controlada.

El archivo `02_agente_plaza_template.json` funciona como plantilla histórica para experimentación aislada. No debe conectarse al runtime activo ni sustituir el evaluador del backend sin un diseño, autorización y prueba de integración independientes.

La fuente inicial del catálogo contiene 22 departamentos y 338 municipios. Las zonas no se tratan como nomenclatura nacional única dentro de la fuente inicial; por ello se dejaron como catálogo configurable, con importación JSON y mantenimiento administrativo de nombre y estado activo.

La aplicación se verificó con TypeScript, pruebas Vitest y build de producción. La prueba real de ApiChat debe ejecutarse desde el botón **Verificar** después de configurar las credenciales cifradas; esta acción consulta el estado y no envía mensajes. La alineación con ISO y DORA es metodológica: esta instalación no constituye certificación ISO, medición DORA completa ni validación psicométrica.
