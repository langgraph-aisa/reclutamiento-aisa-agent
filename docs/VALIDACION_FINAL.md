# Validación final · JARVI RH 2.0.126

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra el endurecimiento editorial de responsabilidades en las 25 plazas publicadas. Comprueba que cada responsabilidad sea una oración de acción completa, con verbo en infinitivo, mayúscula inicial, puntuación final y delimitadores balanceados; también verifica que una política nueva invalide evidencia anterior y active el barrido de contenido histórico. El resto de los controles públicos y administrativos permanece bajo regresión. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.126.md](PRUEBAS_CAJA_NEGRA_2.0.126.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.126` |
| Tratamiento y cobertura (`pnpm text:verify`)       | Aprobado · 77 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 9 de 9 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 92 de 92 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La inspección posterior al despliegue debe consultar las 25 plazas y ejecutar BN-EDIT-19 a BN-EDIT-21 sobre las responsabilidades persistidas. Los controles editoriales BN-EDIT-01 a BN-EDIT-18 y la experiencia de Revisión Humana 360° permanecen como regresión obligatoria.
