# Validación final · JARVI RH 2.0.122

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra la corrección del bloqueo de publicación. Comprueba conservación de `position_ids`, autorreparación idempotente de vínculos por nombre coincidente, mensaje visible ante perfiles incompletos y prioridad permanente de Ejecutivo de Negocios (Ventas) en la landing. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.122.md](PRUEBAS_CAJA_NEGRA_2.0.122.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.122` |
| Tratamiento (`pnpm text:verify`)                   | Aprobado · 76 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 9 de 9 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 78 de 78 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de ISO/IEC 25010:2023 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La inspección posterior al despliegue debe confirmar BN-PUB-01 a BN-PUB-03 y BN-ORDER-01 con la plaza indicada.
