# Validación final · JARVI RH 2.0.111

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra únicamente el release que incorpora tema claro/oscuro persistente, menú lateral diferenciado, identidad de versión, metadata Git del artefacto y gobierno automatizado de releases. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.111.md](PRUEBAS_CAJA_NEGRA_2.0.111.md).

## Evidencia automatizada

| Validación                                         | Resultado                                 |
| -------------------------------------------------- | ----------------------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.111`             |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Aprobado · `2.0.112`                      |
| Caja negra (`pnpm test:black-box`)                 | 4 de 4 pruebas aprobadas                  |
| Regresión Vitest (`pnpm test`)                     | 60 de 60 pruebas aprobadas en 13 archivos |
| Contratos TypeScript (`pnpm check`)                | Aprobado                                  |
| Build cliente/servidor (`pnpm build`)              | Aprobado                                  |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La verificación posterior al despliegue debe confirmar visualmente los casos BN-UI-01 a BN-UI-09 en el dominio productivo.
