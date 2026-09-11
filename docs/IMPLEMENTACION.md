# Manual de implementación y configuración

## Talento AISA · Reclutamiento automatizado por plaza

**Autor:** Manus AI  
**Fecha de actualización:** 11 de septiembre de 2026

**Proyecto:** `reclutamiento-automatizado`  
**Destino:** EasyPanel 2.33.2 sobre VPS de Google, PostgreSQL y n8n on-premise

---

## 1. Alcance validado

Talento AISA sustituye el uso operativo de Google Sheets por una aplicación React/Express/tRPC y PostgreSQL. La plataforma administra **perfiles laborales**, **plazas**, **formularios**, **preguntas**, **reglas automáticas**, **candidatos**, **evaluaciones**, **revisión humana** e **informes**. El backend integra OpenAI y el envío ApiChat; n8n se limita al adaptador opcional de entrada del workflow 04.

El alcance candidato 2.0.130 agrega actividad administrativa, bandeja ApiChat,
receptor normalizado de texto, protocolos versionados, asignación de JARVI HR,
política salarial y servicios aislados de transcripción/TTS. Consulte el
[análisis metodológico y protocolo de despliegue](ANALISIS_COGNITIVO_DORA_2.0.130.md)
para el estado exacto, las brechas y el rollback; no interprete las tablas
preparatorias de adjuntos como un pipeline productivo de medios terminado.

La validación técnica confirmó que un Administrador puede crear un perfil laboral, asociarlo a una o varias plazas, generar un formulario por plaza y definir para cada pregunta su tipo, obligatoriedad, opciones visibles, respuestas que aprueban, descarte directo, rangos numéricos, experiencia mínima o máxima en meses y criterio de razonamiento para IA. El evaluador del backend consulta estas configuraciones desde PostgreSQL; los JSON de n8n no forman parte de esa ejecución.

> **Resultado operativo:** una respuesta de descarte puede producir `No calificado`; una respuesta abierta puede ser razonada por OpenAI según el perfil y los criterios de la pregunta; el resultado estructurado queda persistido con motivo, resumen y resultados por regla.

## 2. Arquitectura

| Capa             | Tecnología              | Responsabilidad                                                |
| ---------------- | ----------------------- | -------------------------------------------------------------- |
| Interfaz pública | React 19 + Tailwind 4   | Formulario mobile-first asociado a una plaza                   |
| Panel interno    | React + DashboardLayout | Perfiles, plazas, formularios, candidatos, usuarios e informes |
| API              | Express 4 + tRPC 11     | Validación, autorización, transacciones y webhooks             |
| Datos            | PostgreSQL              | Fuente de verdad de configuración y operación                  |
| Evaluación       | Backend + LangGraph + OpenAI | Reglas deterministas, razonamiento y persistencia           |
| Acceso           | Código temporal + SMTP  | Autenticación sin contraseña y sesión JWT segura               |
| Mensajería       | ApiChat / WhatsApp      | Contacto del candidato; los receptores de alertas internas disponen solo de CRUD de configuración |

EasyPanel puede crear un servicio **App**, construirlo desde un ZIP o repositorio, administrar variables, dominios y despliegues. Después de guardar cambios de entorno es necesario ejecutar un nuevo despliegue para que lleguen al contenedor activo.[1]

## 3. Roles de seguridad

| Función                                 | Administrador | Reclutador |
| --------------------------------------- | :-----------: | :--------: |
| Resumen, candidatos e informes          |      Sí       |     Sí     |
| Consultar plazas y formulario público   |      Sí       |     Sí     |
| Crear o modificar plazas                |      Sí       |     No     |
| Perfiles laborales                      |      Sí       |     No     |
| Formularios, preguntas y reglas         |      Sí       |     No     |
| Integraciones y catálogo administrativo |      Sí       |     No     |
| Crear, editar o desactivar usuarios     |      Sí       |     No     |
| Cambiar estados de candidatos           |      Sí       |     Sí     |

La seguridad se aplica tanto en la navegación como en los procedimientos backend. Ocultar un botón no sustituye la autorización del servidor.

## 4. Acceso por código enviado por correo

El administrador inicial utiliza `adminit@aisa.com.gt`. **No se entrega ni almacena una contraseña inicial.** Al ingresar el correo, el backend genera un código numérico de seis dígitos, almacena únicamente un hash con salt, lo envía directamente mediante SMTP y permite verificarlo una sola vez.

| Control          | Valor implementado                                              |
| ---------------- | --------------------------------------------------------------- |
| Longitud         | 6 dígitos                                                       |
| Vigencia         | 10 minutos                                                      |
| Intentos máximos | 5                                                               |
| Reenvío          | Intervalo mínimo de 60 segundos                                 |
| Almacenamiento   | Hash `scrypt` con salt aleatorio                                |
| Reutilización    | No permitida; `used_at` se registra al verificar                |
| Sesión           | Cookie HTTP-only firmada con `JWT_SECRET`, duración de 12 horas |

Los nuevos usuarios se crean desde **Usuarios y permisos** con nombre, correo, rol y estado. En su primer acceso solicitan el código en su propio correo. Desactivar la cuenta impide tanto generar como verificar nuevos códigos.

## 5. Preparación del servicio en EasyPanel 2.33.2

En el proyecto de EasyPanel, crear un servicio **App**, cargar el ZIP o conectar el repositorio, seleccionar un constructor compatible con Node y configurar los comandos siguientes. La documentación oficial de EasyPanel para Express ubica las variables en la pestaña **Environment** y exige guardar y desplegar nuevamente.[1] [3]

| Parámetro       | Valor                                         |
| --------------- | --------------------------------------------- |
| Versión de Node | 22                                            |
| Instalación     | `pnpm install --frozen-lockfile`              |
| Construcción    | `pnpm build`                                  |
| Inicio          | `pnpm start`                                  |
| Puerto          | Variable `PORT` inyectada por EasyPanel       |
| Build Path      | `/` si el ZIP contiene el proyecto en la raíz |

No copiar `node_modules`, `.git`, `.manus-logs` ni archivos `.env`. El ZIP entregado excluye estos elementos y conserva `client/`, `server/`, `drizzle/`, `database/`, `n8n-workflows/`, `scripts/`, `docs/` y archivos de configuración.

## 6. Variables de entorno de la aplicación

En EasyPanel abrir **Proyecto → servicio de la aplicación → Environment**, pegar las variables en sintaxis `.env`, guardar y seleccionar **Deploy**. EasyPanel trata esos valores como configuración del contenedor; no deben imprimirse en logs ni guardarse en el repositorio.[1]

| Variable                        |       Obligatoria        | Ejemplo no secreto                                 | Uso                                 |
| ------------------------------- | :----------------------: | -------------------------------------------------- | ----------------------------------- |
| `NODE_ENV`                      |            Sí            | `production`                                       | Activa comportamiento de producción |
| `DATABASE_URL`                  |            Sí            | `postgresql://usuario:clave@postgres:5432/talento` | Conexión PostgreSQL                 |
| `JWT_SECRET`                    |            Sí            | Generar al menos 32 bytes aleatorios               | Firma de sesiones                   |
| `SMTP_HOST`                     |            Sí            | `smtp.proveedor.com`                               | Servidor SMTP                       |
| `SMTP_PORT`                     |            Sí            | `587` o `465`                                      | Puerto SMTP                         |
| `SMTP_SECURE`                   |            Sí            | `false` para 587; `true` para 465                  | TLS inmediato                       |
| `SMTP_USER`                     |            Sí            | `notificaciones@dominio.com`                       | Usuario SMTP                        |
| `SMTP_PASSWORD`                 |            Sí            | Valor secreto                                      | Clave o contraseña de aplicación    |
| `SMTP_FROM`                     |            Sí            | `Talento AISA <notificaciones@dominio.com>`        | Remitente autorizado                |
| `PORT`                          | Gestionada por EasyPanel | Sin valor fijo en código                           | Puerto HTTP interno                 |

Nodemailer utiliza `secure=true` para TLS desde el inicio, normalmente en el puerto 465. En el puerto 587 debe configurarse `secure=false`; la conexión puede elevarse mediante STARTTLS si el servidor lo ofrece.[2]

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/BASE
JWT_SECRET=REEMPLAZAR_CON_SECRETO_ALEATORIO
SMTP_HOST=smtp.proveedor.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notificaciones@dominio.com
SMTP_PASSWORD=REEMPLAZAR
SMTP_FROM=Talento AISA <notificaciones@dominio.com>
```

El remitente de `SMTP_FROM` debe estar autorizado por el proveedor. Para producción se recomienda SPF, DKIM y DMARC en el dominio de envío. No habilitar depuración SMTP que exponga cuerpos de mensajes o credenciales.

## 7. PostgreSQL y orden de migración

Crear la base PostgreSQL y definir `DATABASE_URL` antes de iniciar la aplicación. Ejecutar los archivos en este orden:

| Orden | Archivo                                             | Finalidad                             |
| ----: | --------------------------------------------------- | ------------------------------------- |
|     1 | `drizzle/migrations/0000_smooth_jasper_sitwell.sql` | Esquema base                          |
|     2 | `drizzle/migrations/0001_daffy_wendigo.sql`         | Ampliaciones iniciales                |
|     3 | `drizzle/migrations/0002_same_bromley.sql`          | Roles y perfiles                      |
|     4 | `drizzle/migrations/0003_lethal_lila_cheney.sql`      | Campos finales y ajustes PostgreSQL   |
|     5 | `drizzle/migrations/0004_fearless_sentry.sql`       | Desafíos de código de acceso          |
|     6 | `drizzle/migrations/0005_direct_apichat.sql`        | Mensajería directa ApiChat            |
|     7 | `drizzle/migrations/0006_mst_eir_documents.sql`     | Documentos metodológicos MST-EIR      |
|     8 | `drizzle/migrations/0007_pre_calificado.sql`        | Estado de precalificación              |
|     9 | `drizzle/migrations/0008_agent_evaluator.sql`       | Configuración del agente evaluador     |
|    10 | `drizzle/migrations/0009_calificado_aisa.sql`       | Estado Calificado por AISA            |
|    11 | `drizzle/migrations/0010_agent_score_statuses.sql`  | Escala de puntuación del agente        |
|    12 | `drizzle/migrations/0011_application_location.sql` | Catálogo y ubicación de postulación |
|    13 | `drizzle/migrations/0012_dear_lifeguard.sql`        | Homologación de tratamiento formal    |
|    14 | `drizzle/migrations/0013_apichat_credential_vault.sql` | Bóveda cifrada de ApiChat          |
|    15 | `drizzle/migrations/0014_cognitive_governance.sql` | Gobierno cognitivo y conversacional   |
|    16 | `database/001_functions.sql`                        | Funciones de postulación y evaluación |
|    17 | `database/002_ine_catalog_seed.sql`                 | Catálogo inicial de Guatemala         |
|    18 | `database/002_local_admin.sql`                      | Administrador inicial por correo      |

El seed administrativo es idempotente: si ya existe `adminit@aisa.com.gt`, actualiza el mecanismo de acceso a `email_code`, conserva el registro y elimina el uso operativo de contraseña; si no existe, crea la cuenta con rol `admin`.

La tabla `login_code_challenges` contiene el hash, fecha de expiración, intentos, máximo permitido, IP solicitante y fecha de consumo. La migración es aditiva y no elimina datos.

## 8. Perfiles, plazas y formularios

El orden recomendado de configuración es el siguiente:

1. Abrir **Perfiles laborales** y registrar nombre, objetivo, responsabilidades, requisitos obligatorios, habilidades, conocimientos, nivel académico, experiencia, idiomas, licencias, disponibilidad, ubicación, salario, modalidad y criterios IA.
2. Crear una plaza y anotar su ID.
3. Asociar el perfil a la plaza desde el campo **IDs de plazas asociadas**.
4. Abrir **Plazas y formularios → Preguntas**.
5. Usar **Generar preguntas desde perfil** o crear cada pregunta manualmente.
6. Revisar las opciones mostradas y las respuestas que aprueban; no son el mismo concepto.
7. Publicar primero el formulario y luego la plaza.
8. Copiar `/apply/{public_slug}` para el anuncio de Facebook o Instagram.

| Configuración de pregunta | Comportamiento                                |
| ------------------------- | --------------------------------------------- |
| Tipo `text`               | Respuesta breve                               |
| Tipo `textarea`           | Respuesta abierta para razonamiento IA        |
| Tipo `select`             | Lista de opciones configuradas                |
| Tipo `number`             | Control numérico con mínimo y máximo          |
| Tipo `phone`              | Control telefónico                            |
| `required`                | Exigido en frontend y backend                 |
| `accepted_answers`        | Valores que aprueban la condición             |
| `hard_fail`               | Descalifica si la regla falla                 |
| `min` / `max`             | Rango numérico permitido                      |
| `minMonths` / `maxMonths` | Rango de experiencia; interpreta meses y años |
| `evaluation_criteria`     | Instrucción de razonamiento para OpenAI       |

El backend rechaza una pregunta de selección sin opciones y una regla de descarte sin respuestas aprobadas ni rango. También impide que un envío manipulado omita preguntas obligatorias o use una opción que no existe.

## 9. n8n como adaptador opcional de entrada

Los workflows 01 a 03 son referencias históricas importables y no participan en el runtime vigente. El backend aplica reglas, llama a OpenAI, persiste la evaluación y envía la solicitud de CV directamente. No existe una espera operativa de 30 segundos ni cancelación diferida.

| Workflow | Estado y alcance verificable |
| --- | --- |
| `01_flujo_maestro_postulaciones.json` | Referencia histórica; no recibe postulaciones del runtime web. |
| `02_agente_plaza_template.json` | Plantilla histórica; no evalúa las postulaciones actuales. |
| `03_revision_humana_30s.json` | Investigación histórica; la espera no está conectada. |
| `04_whatsapp_apichat.json` | Único adaptador operativo posible: normaliza texto entrante y lo entrega al receptor autenticado del backend. No evalúa ni envía mensajes salientes. |

Para importar el workflow 04 configure exclusivamente su Header Auth interno; no requiere credenciales PostgreSQL ni OpenAI. El artefacto responde después del último nodo y tiene desactivada la conservación de ejecuciones correctas, erróneas, manuales y progreso. Antes de exponerlo, verifique que el Bearer coincida con el secreto cifrado de la UI, que el backend persista antes del acuse y que no queden payloads en el historial de n8n.

El receptor revalida el identificador, teléfono, dirección y texto mediante `GET /v1/messages` de ApiChat antes de resolver y persistir. Una discordancia responde `422`; un fallo de red o rechazo de la consulta de verificación responde `500`, sin registrar el cuerpo. Esta mitigación ya está conectada en el backend, pero debe probarse de extremo a extremo en el ambiente objetivo junto con el acuse posterior. Nunca incorpore Client ID, token o Bearer dentro del JSON versionado.

## 10. Pruebas de aceptación en EasyPanel

Después del despliegue, ejecutar esta secuencia con una plaza de prueba:

1. Solicitar un código para `adminit@aisa.com.gt` y confirmar recepción.
2. Intentar un código incorrecto y confirmar que no crea sesión.
3. Verificar un código correcto; intentar reutilizarlo y confirmar rechazo.
4. Esperar diez minutos y confirmar rechazo por expiración.
5. Crear un Reclutador y confirmar que recibe su propio código.
6. Confirmar que Reclutador no ve Usuarios, Perfiles ni Configuración, y no puede abrir el constructor.
7. Crear un perfil y asociarlo a una plaza.
8. Generar preguntas desde el perfil, configurar opciones, respuestas aprobadas y una regla de experiencia.
9. Publicar formulario y plaza; abrir el enlace desde Android y iOS.
10. Enviar una respuesta que incumple una regla `hardFail` y confirmar `No calificado`.
11. Enviar una respuesta abierta y confirmar evaluación estructurada.
12. Repetir teléfono + plaza y confirmar rechazo de duplicado.
13. Seleccionar **Solicitar CV por WhatsApp** y verificar el envío directo posterior al commit; el estado técnico continúa siendo `calificado`.
14. Confirmar que no existe espera de 30 segundos: el envío comienza después del commit y un resultado desconocido exige verificación manual antes de reintentar.
15. Abrir Bandeja de entrada, filtrar la conversación y comprobar que el teclado
    humano permanece bloqueado mientras el agente o la prueba estén activos.
16. Enviar dos veces un webhook de texto ficticio con el mismo identificador y
    confirmar que la segunda recepción es idempotente.
17. Verificar que una postulación sin expectativa salarial conserve cero y que una
    cifra de ventas no se interprete como salario.
18. Ejecutar las pruebas de servicio de transcripción y TTS con transporte simulado. No existe un endpoint productivo de medios para una prueba desde la UI.

## 11. Comandos de validación

```bash
pnpm install --frozen-lockfile
pnpm release:verify
pnpm test:black-box
pnpm check
pnpm test
pnpm build
python3 scripts/validate_workflows.py
```

La validación final debe mostrar TypeScript sin errores, todas las pruebas Vitest aprobadas, build de producción correcto y artefactos n8n estructuralmente válidos. La conexión SMTP se valida en EasyPanel; ApiChat se verifica desde el módulo administrativo y el envío real se confirma con un número controlado.

Las referencias ISO, DORA y de pruebas se utilizan como orientación metodológica. Estos comandos no constituyen certificación ISO, medición DORA completa ni validación psicométrica.

## 12. Diagnóstico

| Síntoma               | Revisión recomendada                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| No llega el código    | Revisar `SMTP_HOST`, puerto, usuario, clave, remitente autorizado y spam        |
| Error SMTP en 465     | Confirmar `SMTP_SECURE=true`                                                    |
| Error SMTP en 587     | Confirmar `SMTP_SECURE=false` y soporte STARTTLS                                |
| Código inválido       | Solicitar uno nuevo; comprobar expiración, intentos y hora del servidor         |
| Error de tabla OTP    | Ejecutar `0004_fearless_sentry.sql`                                             |
| No aparece formulario | Publicar formulario y plaza; confirmar `public_slug`                            |
| Lista sin opciones    | Editar pregunta `select` y guardar **Opciones que verá el candidato**           |
| El agente no evalúa   | Revisar la configuración cifrada de OpenAI, la activación de Responses API y los logs controlados del backend |
| No llega texto entrante | Revisar importación y activación del workflow 04, Bearer interno, acuse posterior, no retención y revalidación con ApiChat |
| WhatsApp no continúa  | Revisar estado, bóveda PostgreSQL, verificación ApiChat y control de automatización |
| Webhook responde 401  | Revisar secreto cifrado y encabezado Bearer; no registrar el cuerpo             |
| Audio no se procesa   | El webhook vigente acepta texto; validar el servicio aislado y no asumir pipeline de medios |

## 13. Archivos principales

| Ruta                                          | Descripción                                                      |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `server/localAuth.ts`                         | OTP, hash, sesión y envío SMTP                                   |
| `server/routers.ts`                           | Solicitud/verificación, usuarios, formularios, perfiles y reglas |
| `drizzle/schema.ts`                           | Modelo PostgreSQL                                                |
| `drizzle/migrations/0004_fearless_sentry.sql` | Tabla OTP                                                        |
| `drizzle/migrations/0014_cognitive_governance.sql` | Actividad, bandeja, protocolos, adjuntos preparatorios y gobierno |
| `database/002_local_admin.sql`                | Seed idempotente del administrador                               |
| `client/src/pages/Login.tsx`                  | Acceso de dos pasos                                              |
| `client/src/pages/Users.tsx`                  | Usuarios y roles sin contraseña                                  |
| `client/src/pages/Profiles.tsx`               | Definición del perfil laboral                                    |
| `client/src/pages/FormBuilder.tsx`            | Constructor y reglas                                             |
| `client/src/pages/Apply.tsx`                  | Formulario público mobile-first                                  |
| `n8n-workflows/*.json`                        | Referencias históricas y adaptador opcional de entrada 04        |
| `docs/ANALISIS_COGNITIVO_DORA_2.0.130.md`     | Alcance, DORA/ISO, despliegue, rollback y brechas                 |

## Referencias

[1]: https://easypanel.io/docs/services/app "EasyPanel Docs — App Service"
[2]: https://nodemailer.com/smtp "Nodemailer — SMTP transport"
[3]: https://easypanel.io/docs/quickstarts/express "EasyPanel Docs — Deploying an Express.js Application"
