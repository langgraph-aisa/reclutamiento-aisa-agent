# Validación final · JARVI RH 2.0.112

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra el release que publica el README académico-comercial: análisis sociotécnico, arquitectura y flujos, ontología de datos, epistemología de la evaluación, fenomenología de la experiencia, matriz ISO, 36 referencias, posicionamiento y personaje local proporcionado a escala. También confirma la continuidad del tema, metadata Git y gobierno de releases. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.112.md](PRUEBAS_CAJA_NEGRA_2.0.112.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.112` |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Aprobado · `2.0.113`          |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 5 de 5 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 61 de 61 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La verificación posterior al despliegue debe confirmar visualmente los casos BN-UI-01 a BN-UI-09 y BN-DOC-01 a BN-DOC-04 en GitHub y el dominio productivo.
