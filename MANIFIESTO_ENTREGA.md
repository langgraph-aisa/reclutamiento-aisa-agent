# Talento AISA · Paquete integral para EasyPanel

**Fecha:** 16 de septiembre de 2026  
**Contenido:** código fuente completo, migraciones PostgreSQL, seeds, scripts, documentación Markdown y manual PDF.

## Despliegue mínimo

1. Cargar este ZIP como servicio App en EasyPanel con el contenido ubicado en la raíz.
2. Configurar las variables descritas en `docs/IMPLEMENTACION.md`.
3. Ejecutar las migraciones `0000` a `0024` en orden.
4. Ejecutar `database/001_functions.sql`, `database/002_ine_catalog_seed.sql` y `database/002_local_admin.sql`.
5. Configurar `pnpm install --frozen-lockfile`, `pnpm build` y `pnpm start`.
6. Ingresar con `adminit@aisa.com.gt` solicitando el código de correo.

## Validación previa

| Control | Resultado |
|---|---|
| TypeScript | Aprobado |
| Vitest | 287/287 |
| Caja negra | 20/20 |
| Catálogo de endpoints por capacidad | Aprobado · 16 de 16 |
| Fronteras conversacionales | Aprobado · 11 de 11 |
| Build | Aprobado |
| Retiro de n8n | Confirmado |
| PDF | Compilación estricta y verificación aprobadas |

El paquete excluye `.env`, credenciales, `node_modules`, `dist`, `.git`, registros y artefactos temporales. Las pruebas SMTP, PostgreSQL y ApiChat de extremo a extremo deben realizarse dentro de EasyPanel con las credenciales de la organización.

## Servicio conversacional 2.0.141

La migración `0022_conversational_agent.sql` habilita la memoria del agente JARVI HR: turnos con huella de contexto, bitácora de eventos idempotente, resúmenes versionados, ciclos de información y RAG personal del candidato. Es idempotente y no contiene credenciales; se aplica con el ejecutor SQL de EasyPanel después de `0021`. Sin ella la revisión humana sigue operativa y el panel conversacional explica que la bitácora se habilita al aplicar la migración. El agente requiere la OpenAI Responses API habilitada y una credencial verificada en «Agente de IA LangGraph»; el envío permanece sujeto a la configuración de ApiChat y la recepción al historial verificado.

## Despliegue separado 2.0.142

La migración `0023_conversation_service_split.sql` crea la cola `conversation_outbox`, los esquemas `wa_receiver`, `wa_sender` y `wa_engine`, los roles `jarvi_receptor`, `jarvi_emisor` y `jarvi_motor` sin contraseña, y la vista `conversation_reconciliation`. El despliegue separado se elige en el panel de configuración y no exige variables nuevas: solo `DATABASE_URL` y la clave de cifrado del agente. El procedimiento completo está en [docs/GUIA_EASYPANEL_CONVERSACION_2.0.142.md](docs/GUIA_EASYPANEL_CONVERSACION_2.0.142.md), con la **consulta única de verificación** de la base; sin `0023` el despliegue conserva el modo integrado.

## Activación por configuración 2.0.144

La migración `0024_conversation_activation.sql` **preactiva** el servicio conversacional en el panel: no se requieren variables de entorno nuevas. Los ocho interruptores —agente, despacho de la cola, capacidad de recepción, de razonamiento y de envío, modo de despliegue, historial recordado y límite de palabras— se gobiernan desde `Configuración › WhatsApp` y cada cambio queda auditado.

## Administrador de endpoints por capacidad 2.0.143

El catálogo de `Configuración › WhatsApp` declara por interruptor la capacidad que atiende, los consumidores y si es indispensable para el agente, además del efecto operativo de apagarlo; la preparación por capacidad publica Recepción, Razonamiento y Envío con su endpoint exigido, el modo declarado y los avisos en tratamiento formal.
