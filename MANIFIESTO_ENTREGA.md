# Talento AISA · Paquete integral para EasyPanel

**Fecha:** 16 de septiembre de 2026  
**Contenido:** código fuente completo, migraciones PostgreSQL, seeds, scripts, documentación Markdown y manual PDF.

## Despliegue mínimo

1. Cargar este ZIP como servicio App en EasyPanel con el contenido ubicado en la raíz.
2. Configurar las variables descritas en `docs/IMPLEMENTACION.md`.
3. Ejecutar las migraciones `0000` a `0022` en orden.
4. Ejecutar `database/001_functions.sql`, `database/002_ine_catalog_seed.sql` y `database/002_local_admin.sql`.
5. Configurar `pnpm install --frozen-lockfile`, `pnpm build` y `pnpm start`.
6. Ingresar con `adminit@aisa.com.gt` solicitando el código de correo.

## Validación previa

| Control | Resultado |
|---|---|
| TypeScript | Aprobado |
| Vitest | 264/264 |
| Caja negra | 17/17 |
| Fronteras conversacionales | Aprobado · 10 de 10 |
| Build | Aprobado |
| Retiro de n8n | Confirmado |
| PDF | Compilación estricta y verificación aprobadas |

El paquete excluye `.env`, credenciales, `node_modules`, `dist`, `.git`, registros y artefactos temporales. Las pruebas SMTP, PostgreSQL y ApiChat de extremo a extremo deben realizarse dentro de EasyPanel con las credenciales de la organización.

## Servicio conversacional 2.0.141

La migración `0022_conversational_agent.sql` habilita la memoria del agente JARVI HR: turnos con huella de contexto, bitácora de eventos idempotente, resúmenes versionados, ciclos de información y RAG personal del candidato. Es idempotente y no contiene credenciales; se aplica con el ejecutor SQL de EasyPanel después de `0021`. Sin ella la revisión humana sigue operativa y el panel conversacional explica que la bitácora se habilita al aplicar la migración. El agente requiere la OpenAI Responses API habilitada y una credencial verificada en «Agente de IA LangGraph»; el envío permanece sujeto a la configuración de ApiChat y la recepción al historial verificado.
