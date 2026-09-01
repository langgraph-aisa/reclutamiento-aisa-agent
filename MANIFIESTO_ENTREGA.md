# Talento Claro · Paquete integral para EasyPanel

**Fecha:** 1 de septiembre de 2026  
**Contenido:** código fuente completo, migraciones PostgreSQL, seeds, workflows n8n, scripts, documentación Markdown y manual PDF.

## Despliegue mínimo

1. Cargar este ZIP como servicio App en EasyPanel con el contenido ubicado en la raíz.
2. Configurar las variables descritas en `docs/IMPLEMENTACION.md`.
3. Ejecutar las migraciones `0000` a `0004` en orden.
4. Ejecutar `database/001_functions.sql`, `database/002_ine_catalog_seed.sql` y `database/002_local_admin.sql`.
5. Configurar `pnpm install --frozen-lockfile`, `pnpm build` y `pnpm start`.
6. Importar los cuatro JSON de `n8n-workflows/` y asignar credenciales.
7. Ingresar con `adminit@aisa.com.gt` solicitando el código de correo.

## Validación previa

| Control | Resultado |
|---|---|
| TypeScript | Aprobado |
| Vitest | 18/18 |
| Build | Aprobado |
| n8n | 4/4 workflows válidos |
| PDF | Compilación estricta y verificación aprobadas |

El paquete excluye `.env`, credenciales, `node_modules`, `dist`, `.git`, registros y artefactos temporales. Las pruebas SMTP, PostgreSQL, n8n y ApiChat de extremo a extremo deben realizarse dentro de EasyPanel con las credenciales de la organización.
