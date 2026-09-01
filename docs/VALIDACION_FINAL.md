# Validación final

## Evidencia visual registrada

El manual PDF compiló en modo estricto, pasó la verificación determinista y su revisión estándar de páginas representativas no mostró recortes, desbordes ni tablas ilegibles.

La pantalla de acceso en escritorio presenta correctamente el flujo inicial de solicitud de código para `adminit@aisa.com.gt`, con jerarquía legible y sin campos de contraseña. El formulario público de ejemplo conserva la confirmación explícita de la plaza, el enlace verificado y la acción para comenzar el cuestionario.

En viewport móvil de 375 × 812, la tarjeta de acceso mantiene márgenes, contraste y controles legibles. El formulario público conserva la identidad visual, la plaza, ubicación, confirmación y botón principal sin desbordes horizontales.

## Validaciones automatizadas

| Validación | Resultado |
|---|---|
| TypeScript (`pnpm check`) | Aprobado |
| Vitest | 18 de 18 pruebas aprobadas |
| Build de producción | Aprobado; advertencia no bloqueante de tamaño de bundle |
| Workflows n8n | 4 de 4 JSON válidos y marcadores semánticos presentes |
| Manual PDF | Compilación estricta y verificación determinista aprobadas |

La prueba real de entrega SMTP, migración PostgreSQL, ejecución n8n y envío ApiChat debe realizarse en EasyPanel con las credenciales de la organización.
