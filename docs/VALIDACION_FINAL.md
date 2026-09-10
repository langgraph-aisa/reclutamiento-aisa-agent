# Validación final · JARVI RH 2.0.115

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra el release que reemplaza la inversión acromática por tokens funcionales Dark AISA y ofrece Day, Dark Dimmed y Dark High Contrast de forma persistente en login, páginas públicas y vistas internas. La validación incluye contraste computado, foco visible, semántica no dependiente solo del color, arranque sin destello claro y conservación de la regresión funcional. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.115.md](PRUEBAS_CAJA_NEGRA_2.0.115.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.115` |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 8 de 8 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 69 de 69 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de WCAG 2.2, ISO/IEC 25010:2023, ISO/IEC 27001:2022 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La verificación posterior al despliegue debe confirmar BN-DARK-01 a BN-STATE-01 en los tres temas, navegadores y resoluciones objetivo. El modo oscuro es una alternativa de confort y personalización, no una afirmación clínica.
