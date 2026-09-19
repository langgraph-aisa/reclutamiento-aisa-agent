# Talento AISA · Paquete integral para EasyPanel

**Fecha:** 16 de septiembre de 2026  
**Contenido:** código fuente completo, migraciones PostgreSQL, seeds, scripts, documentación Markdown y manual PDF.

## Despliegue mínimo

1. Cargar este ZIP como servicio App en EasyPanel con el contenido ubicado en la raíz.
2. Configurar las variables descritas en `docs/IMPLEMENTACION.md`.
3. Ejecutar `database/005_servicio_conversacional_listo.sql` (reúne `0022` a `0030` y verifica al final).
4. Ejecutar `database/001_functions.sql`, `database/002_ine_catalog_seed.sql` y `database/002_local_admin.sql`.
5. Configurar `pnpm install --frozen-lockfile`, `pnpm build` y `pnpm start`.
6. Ingresar con `adminit@aisa.com.gt` solicitando el código de correo.

## Validación previa

| Control | Resultado |
|---|---|
| TypeScript | Aprobado |
| Vitest | 677/677 |
| Caja negra | 38/38 |
| Catálogo de endpoints por capacidad | Aprobado · 16 de 16 |
| Fronteras conversacionales | Aprobado · 11 de 11 |
| Build | Aprobado |
| Retiro de n8n | Confirmado |
| PDF | Compilación estricta y verificación aprobadas |

El paquete excluye `.env`, credenciales, `node_modules`, `dist`, `.git`, registros y artefactos temporales. Las pruebas SMTP, PostgreSQL y ApiChat de extremo a extremo deben realizarse dentro de EasyPanel con las credenciales de la organización.

## Recuperación del expediente 2.0.188

El rechazo del adjunto deja de ser terminal. Cuando el proveedor entrega un PDF y la política de conocimiento lo rechaza porque su extensión no está habilitada o su peso supera el máximo, el binario **permanece conservado en el volumen de la bandeja** y ahora puede incorporarse al expediente del candidato sin exigir un envío nuevo: la operación reconstruye por contenido su extensión, tipo y huella, lo publica en el RAG personal, ejecuta su análisis con el mismo método que la carga manual, vuelve a ejecutar el agente evaluador con la evidencia nueva y deja el documento disponible en el visor para el dictamen humano. El asiento del mensaje se corrige: la bandeja deja de declarar una exclusión superada. El desenlace tipado del conducto —extensión no habilitada, peso sobre el límite, contenido no disponible, codificación no interpretable— se traduce a una sentencia que declara la causa y el remedio, compartida por la bandeja, la ficha y el expediente, de modo que la política administrativa no se lea como un defecto del candidato. El agradecimiento y el aviso de contacto declarados en «Evaluación de CV con IA» se emiten una sola vez como acuse del expediente, por el mismo medio y con la conversación tomada. **Sin migración**: reutiliza las tablas `0035` a `0037` y el volumen de la bandeja; las superficies de la interfaz viven en `Revisión Humana › RAG Personal`.

## Servicio conversacional 2.0.141

La migración `0022_conversational_agent.sql` habilita la memoria del agente JARVI HR: turnos con huella de contexto, bitácora de eventos idempotente, resúmenes versionados, ciclos de información y RAG personal del candidato. Es idempotente y no contiene credenciales; se aplica con el ejecutor SQL de EasyPanel después de `0021`. Sin ella la revisión humana sigue operativa y el panel conversacional explica que la bitácora se habilita al aplicar la migración. El agente requiere la OpenAI Responses API habilitada y una credencial verificada en «Agente de IA LangGraph»; el envío permanece sujeto a la configuración de ApiChat y la recepción al historial verificado.

## Despliegue separado 2.0.142

La migración `0023_conversation_service_split.sql` crea la cola `conversation_outbox`, los esquemas `wa_receiver`, `wa_sender` y `wa_engine`, los roles `jarvi_receptor`, `jarvi_emisor` y `jarvi_motor` sin contraseña, y la vista `conversation_reconciliation`. El despliegue separado se elige en el panel de configuración y no exige variables nuevas: solo `DATABASE_URL` y la clave de cifrado del agente. El procedimiento completo está en [docs/GUIA_EASYPANEL_CONVERSACION_2.0.142.md](docs/GUIA_EASYPANEL_CONVERSACION_2.0.142.md), con la **consulta única de verificación** de la base; sin `0023` el despliegue conserva el modo integrado.

## Despliegue en un solo paso 2.0.145

`database/005_servicio_conversacional_listo.sql` reúne las migraciones `0022` a `0030` y termina con la verificación autocertificada: se pega una sola vez en el ejecutor SQL y todas las filas deben quedar en `OK`. Es idempotente y se genera con `pnpm deploy:sql`. Validado en PostgreSQL 17 desde cero con `GATE GLOBAL OK`.

## Activación por configuración 2.0.144

La migración `0024_conversation_activation.sql` **preactiva** el servicio conversacional en el panel: no se requieren variables de entorno nuevas. Los ocho interruptores —agente, despacho de la cola, capacidad de recepción, de razonamiento y de envío, modo de despliegue, historial recordado y límite de palabras— se gobiernan desde `Configuración › WhatsApp` y cada cambio queda auditado.

## Administrador de endpoints por capacidad 2.0.143

El catálogo de `Configuración › WhatsApp` declara por interruptor la capacidad que atiende, los consumidores y si es indispensable para el agente, además del efecto operativo de apagarlo; la preparación por capacidad publica Recepción, Razonamiento y Envío con su endpoint exigido, el modo declarado y los avisos en tratamiento formal.
