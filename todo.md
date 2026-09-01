# Project TODO

## Aplicación y experiencia pública

- [x] Crear formulario público responsive mobile-first por plaza.
- [x] Confirmar visualmente la plaza antes de iniciar la postulación.
- [x] Usar identificadores seguros no predecibles para los enlaces de plaza.
- [x] Registrar la aplicación únicamente al pulsar el botón de envío.
- [x] No permitir pausar ni guardar parcialmente el cuestionario.
- [x] Mostrar confirmación de envío exitoso.
- [x] Mostrar aviso de aplicación previa únicamente después de detectar una postulación finalizada.
- [x] Bloquear duplicados mediante teléfono normalizado + plaza.
- [x] Normalizar teléfonos de Guatemala a formato internacional.
- [x] Mantener configuración de país predeterminado para futuras expansiones.

## Administración y configuración

- [x] Crear panel administrativo con rol Administrador de control total.
- [x] Crear rol Reclutador con acceso a candidatos, plazas e informes, sin acceso a configuración de formularios/campos.
- [x] Crear, editar, publicar, despublicar y eliminar plazas.
- [x] Crear, editar, publicar, despublicar y eliminar formularios.
- [x] Configurar un formulario asociado a una plaza.
- [x] Crear, editar, ordenar, activar y eliminar preguntas.
- [x] Configurar tipos de pregunta, obligatoriedad y respuestas aceptadas.
- [x] Configurar reglas de descarte por pregunta.
- [x] Configurar rangos numéricos y condiciones dependientes.
- [x] Configurar criterios de evaluación de respuestas abiertas por agente/plaza.
- [x] Configurar mensaje inicial de WhatsApp por plaza.
- [x] Configurar lista de números internos para alertas de WhatsApp.
- [x] Configurar variables de integración ApiChat/WhatsApp.
- [x] Crear mantenimiento del catálogo geográfico de Guatemala.
- [x] Preparar importación y actualización de departamentos, municipios y zonas oficiales del INE.

## Datos y evaluación

- [x] Definir esquema PostgreSQL para plazas, formularios, preguntas, opciones, reglas, candidatos, respuestas, estados, evaluaciones, conversaciones, auditoría e integraciones.
- [x] Crear restricción transaccional de unicidad teléfono normalizado + plaza.
- [x] Guardar estado del candidato con los estados requeridos.
- [x] Guardar motivo de evaluación generado por IA.
- [x] Guardar resumen del perfil del candidato.
- [x] Guardar resultado determinista por pregunta.
- [x] Guardar resultado estructurado de evaluación de respuestas abiertas.
- [x] Permitir actualización manual de estado por usuarios autorizados.
- [x] Registrar bitácora de cambios con usuario, valor anterior, valor nuevo, comentario y fecha.
- [x] Disparar proceso diferido cuando un humano cambie el estado a Calificado.
- [x] Esperar 10 minutos antes de continuar el proceso de entrevista.
- [x] Cancelar la continuación si el estado deja de ser Calificado durante la espera.

## Workflows n8n

- [x] Crear workflow maestro importable para recepción y coordinación de eventos.
- [x] Crear workflow independiente por plaza/agente.
- [x] Validar teléfono, duplicados, datos obligatorios y asociación con plaza.
- [x] Ejecutar reglas deterministas configuradas por pregunta.
- [x] Invocar el nodo nativo OpenAI/ChatGPT de n8n para respuestas abiertas.
- [x] Exigir salida estructurada con estado, motivo y resumen de perfil.
- [x] Persistir resultados en PostgreSQL.
- [x] Crear workflow para cambios manuales de estado.
- [x] Crear espera diferida de 10 minutos para cambios humanos a Calificado.
- [x] Crear workflow de continuación de entrevista por WhatsApp.
- [x] Crear workflow de notificaciones a lista configurable de números internos.
- [x] Parametrizar URL Webhook de ApiChat.
- [x] Parametrizar Conectar a de ApiChat.
- [x] Parametrizar API Endpoint de ApiChat.
- [x] Parametrizar ID Cuenta de ApiChat.
- [x] Parametrizar Token de ApiChat.
- [x] Dejar credenciales de PostgreSQL, OpenAI/ChatGPT y ApiChat/WhatsApp pendientes.
- [x] Generar JSONs importables para la versión vigente de n8n on-premise.

## Panel de candidatos e informes

- [x] Crear listado de candidatos con filtros por plaza, estado, fecha y resultado.
- [x] Crear detalle de candidato con respuestas, evaluación, perfil, historial y conversación.
- [x] Permitir edición manual de campos autorizados: estado y comentario auditables.
- [x] Mostrar claramente efectos y confirmación de cambios manuales.
- [x] Crear informes por período.
- [x] Crear informes por plaza.
- [x] Crear informes por resultado y motivo.
- [x] Crear informe de conversiones a entrevista.
- [x] Crear informe de tiempos de respuesta.

## Calidad y entrega

- [x] Aplicar diseño elegante, consistente, accesible y responsive para Android/iOS.
- [x] Usar DashboardLayout para la zona administrativa.
- [x] Crear pruebas Vitest para reglas, normalización, duplicados, estados y permisos.
- [x] Validar TypeScript, build y pruebas.
- [x] Verificar visualmente las vistas desktop y móvil.
- [x] Crear README de instalación on-premise en EasyPanel.
- [x] Documentar variables de entorno y credenciales pendientes.
- [x] Documentar configuración de PostgreSQL.
- [x] Documentar configuración de URLs públicas y webhooks.
- [x] Documentar orden de importación de workflows n8n.
- [x] Documentar pruebas de aceptación y operación.
- [x] Crear archivo descargable de migración/esquema PostgreSQL.
- [x] Crear archivos JSON descargables de workflows n8n.
- [x] Guardar checkpoint final con todos los elementos completados.

## Correcciones y validaciones pendientes detectadas

- [x] Implementar rol real `reclutador` en PostgreSQL, guardas backend y visibilidad restringida de configuración.
- [x] Completar edición real de preguntas existentes.
- [x] Persistir ordenamiento y activación/desactivación de preguntas desde la UI.
- [x] Exponer en el constructor los rangos numéricos, mínimos de experiencia y condiciones dependientes.
- [x] Persistir y administrar por plaza el mensaje inicial de WhatsApp.
- [x] Persistir y administrar el país predeterminado de normalización.
- [x] Persistir `deterministic_result` por cada respuesta durante la evaluación.
- [x] Conectar el cambio manual de estado a `Calificado` con la activación real del workflow diferido.
- [x] Añadir filtros de candidatos por plaza, fecha y resultado.
- [x] Conectar filtros de período del informe con la UI.
- [x] Calcular y mostrar tiempos de respuesta reales.
- [x] Agregar pruebas de duplicados, transiciones de estado y permisos.
- [x] Ejecutar `pnpm build` y corregir cualquier error de producción.
- [x] Revisar visualmente la aplicación también en viewport desktop.
- [x] Validar JSONs estructuralmente y documentar la importación pendiente en la instancia n8n del usuario.
- [x] Mantener marcadores `PENDIENTE` como referencias configurables sin exponer secretos.
- [x] Revisar y corregir expresiones de nodos n8n para que el flujo WhatsApp y el parser estructurado sean coherentes.

## Validación semántica adicional

- [x] Inspeccionar y validar en contexto el contenido de cada workflow JSON: nodos, expresiones, parser estructurado, Wait y cancelación.
- [x] Implementar CRUD visible para departamentos, municipios y zonas; las zonas quedan configurables porque no se estableció una nomenclatura nacional única.
- [x] Agregar historial/auditoría y conversación al detalle de candidato.
- [x] Corregir reordenamiento de preguntas con intercambio transaccional consistente.
- [x] Agregar selector visible de plaza en filtros de candidatos.
- [x] Mantener marcadores de credenciales pendientes y documentarlos como pendientes de configuración, no como reemplazados.
- [x] Validar semánticamente expresiones de workflows n8n y coherencia entre parser estructurado y WhatsApp.

- [x] Crear y entregar documento de implementación integral del sistema.

- [x] Crear guía técnica de implementación en PDF con diagramas de arquitectura, procesos, datos y workflows n8n.

- [x] Crear y entregar documento descargable con el mapa de variables de entorno, nodos, archivos, credenciales y pendientes de ApiChat/WhatsApp.

- [x] Crear y entregar guía descargable para configurar variables de entorno directamente en EasyPanel.

- [x] Adaptar la guía de variables a EasyPanel 2.33.2 y entregar la versión actualizada.

## Acceso local y perfiles laborales

- [x] Implementar inicio de sesión local protegido para administración.
- [x] Crear usuario inicial de testing `adminit@aisa.com.gt` con clave temporal `ADMIN` y cambio obligatorio posterior preparado mediante seed SQL.
- [x] Implementar cierre de sesión, cambio de contraseña y recuperación por correo mediante webhook opcional.
- [x] Agregar control de acceso para impedir consultas administrativas sin sesión.
- [x] Crear mantenimiento de usuarios con alta, edición, activación, desactivación y baja lógica.
- [x] Mantener roles iniciales Administrador y Reclutador, con estructura extensible para permisos futuros.
- [x] Crear modelo y mantenimiento de perfiles laborales reutilizables por plaza.
- [x] Administrar objetivo, responsabilidades, requisitos, habilidades, conocimientos, nivel académico, experiencia, idiomas, licencias, disponibilidad, ubicación, salario y modalidad.
- [x] Preparar relación entre perfil laboral, formulario, respuestas, currículo futuro y evaluación IA.
- [x] Mejorar vistas de usuarios, perfiles y registros con tablas legibles, búsqueda, filtros y detalle.
- [x] Crear PDF técnico con cambios, módulos, librerías y archivos afectados.

- [x] Preparar la verificación de `DATABASE_URL` y la ejecución de la migración 0003 sobre PostgreSQL; la ejecución corresponde al despliegue en EasyPanel.
- [x] Preparar el seed idempotente del usuario administrador `adminit@aisa.com.gt` con clave temporal `ADMIN`; su ejecución corresponde al despliegue en EasyPanel.

- [x] Preparar despliegue de aplicación y migración contra PostgreSQL externo de EasyPanel, sin usar TiDB del preview.
- [x] Continuar login local, administración de usuarios y perfiles laborales para uso en EasyPanel.

## Correcciones posteriores a validación

- [x] Implementar pantalla completa de recuperación con token y nueva contraseña.
- [x] Documentar y conectar operativamente el webhook de recuperación de contraseña.
- [x] Agregar edición de usuarios existentes desde la interfaz.
- [x] Agregar baja lógica explícita y edición de estado de usuarios desde la interfaz.
- [x] Corregir edición persistente de perfiles usando `id`.
- [x] Agregar baja lógica y estado activo de perfiles desde la interfaz.
- [x] Separar y persistir disponibilidad, ubicación, rango salarial y modalidad en perfiles.
- [x] Integrar funcionalmente perfiles con formularios, respuestas y evaluación IA futura.
- [x] Agregar búsqueda, filtros y detalle para usuarios y perfiles.

## Gaps finales de validación

- [x] Implementar y probar el envío del token mediante `PASSWORD_RESET_WEBHOOK_URL`; la URL real queda pendiente de configurar en EasyPanel.
- [x] Añadir indicador de estado activo/inactivo y reactivación de perfiles laborales.
- [x] Conectar criterios del perfil al formulario y al pipeline de evaluación n8n de forma operativa.
- [x] Agregar búsqueda, filtros y vista de detalle para usuarios.
- [x] Completar filtros y detalle de perfiles laborales.

## Integración funcional final

- [x] Precargar requisitos y criterios del perfil laboral dentro del constructor de formularios.
- [x] Derivar reglas de evaluación desde campos concretos del perfil en el agente n8n.
- [x] Añadir vista de detalle de usuario con estado, rol, fechas y acciones separadas.
- [x] Ajuste solicitado: tratar EasyPanel como fuente de verdad para variables de entorno y evitar validaciones locales bloqueantes de credenciales.
- [x] Derivar en el workflow n8n reglas adicionales desde requisitos obligatorios, nivel académico, licencias, ubicación, idiomas y criterios IA del perfil laboral.
- [x] Ampliar el detalle de usuario con fechas de creación y actualización, además del último acceso, e incluir acciones administrativas separadas.
- [x] Corregir el workflow del agente para usar `required_requirements` y `academic_level`, y aplicar `ai_criteria` de forma operativa.

## Validación y entrega para EasyPanel con acceso por código

- [x] Auditar la creación, edición, publicación y uso público de formularios vinculados a plazas.
- [x] Auditar que cada pregunta permita configurar tipo, respuestas aceptadas, descarte, rangos y criterios IA.
- [x] Validar la relación operativa entre perfiles laborales, formularios y evaluación automática.
- [x] Sustituir el acceso administrativo por solicitud y verificación de código de un solo uso enviado al correo del usuario.
- [x] Restringir el acceso inicial al administrador `adminit@aisa.com.gt` y mantener creación de usuarios con roles.
- [x] Incorporar controles de expiración, intentos máximos, uso único y almacenamiento seguro del código.
- [x] Actualizar migraciones y seed para el nuevo esquema de autenticación.
- [x] Actualizar el manual de implementación y configuración de EasyPanel, incluyendo variables de entorno.
- [x] Generar manual actualizado en formato descargable y PDF.
- [x] Ejecutar TypeScript, Vitest, build, validación de workflows y revisión visual.
- [x] Crear ZIP completo de implementación con la estructura íntegra del proyecto y sin secretos.
- [x] Implementar envío directo de códigos de acceso mediante SMTP configurable en EasyPanel.
- [x] Documentar `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM`.
