# Validación final · JARVI RH 2.0.121

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra la integración de la landing y la solicitud pública con la fuente canónica de Perfiles laborales. Comprueba composición compacta, objetivo, responsabilidades y requisitos por plaza, bloqueo de publicación incompleta, tres accesos en pestaña paralela, acceso administrativo inequívoco y JARVI al doble de la escala de referencia. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.121.md](PRUEBAS_CAJA_NEGRA_2.0.121.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.121` |
| Tratamiento (`pnpm text:verify`)                   | Aprobado · 76 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 9 de 9 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 77 de 77 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de WCAG 2.2, ISO/IEC 25010:2023 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La inspección posterior al despliegue debe confirmar BN-LAND-01 a BN-LAND-06 y BN-APPLY-01 a BN-APPLY-02 con todas las plazas visibles y en los tres temas.
