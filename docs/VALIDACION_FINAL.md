# Validación final · JARVI RH 2.0.129

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra la sustitución del entorno ApiChat por el almacén cifrado de PostgreSQL. Comprueba la administración protegida, el consumo runtime desde una fuente única, la migración idempotente, el rechazo de texto plano, la verificación sin envío y la ausencia de secretos en respuestas y auditoría. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.129.md](PRUEBAS_CAJA_NEGRA_2.0.129.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.129` |
| Tratamiento y cobertura (`pnpm text:verify`)       | Aprobado · 78 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 10 de 10 pruebas   |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 97 de 97 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. Después de migrar, la inspección operativa debe guardar credenciales rotadas, ejecutar BN-API-05 y realizar un único envío con un número controlado. Los controles editoriales, temáticos y de Revisión Humana 360° permanecen como regresión obligatoria.
