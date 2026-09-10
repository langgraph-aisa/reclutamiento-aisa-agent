# Validación final · JARVI RH 2.0.114

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra el release que elimina datos sugeridos en login y teléfono, unifica el horario institucional, retira el microtexto solicitado, conecta el formulario con el catálogo geográfico y persiste ubicación validada para uso del agente. También extiende el tema oscuro accesible a las rutas públicas y conserva compatibilidad de lectura con postulaciones históricas. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.114.md](PRUEBAS_CAJA_NEGRA_2.0.114.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.114` |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 8 de 8 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 69 de 69 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La verificación posterior al despliegue debe confirmar visualmente BN-AUTH-01 a BN-LEG-01 en GitHub y el dominio productivo.
