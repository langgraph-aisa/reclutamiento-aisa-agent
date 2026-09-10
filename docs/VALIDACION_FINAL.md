# Validación final · JARVI RH 2.0.120

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra la corrección transversal de contraste para títulos `h1` en páginas públicas y administrativas. Comprueba el token blanco de encabezado en ambos temas oscuros, su precedencia frente a colores heredados y la legibilidad completa del héroe de privacidad y términos. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.120.md](PRUEBAS_CAJA_NEGRA_2.0.120.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.120` |
| Tratamiento (`pnpm text:verify`)                   | Aprobado · 76 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 9 de 9 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 74 de 74 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de WCAG 2.2, ISO/IEC 25010:2023 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La inspección posterior al despliegue debe confirmar BN-DARK-07 en login, portada, postulación, privacidad y rutas administrativas, tanto en Dark Dimmed como en Dark High Contrast.
