# Validación final · JARVI RH 2.0.124

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra la auditoría transversal de textos públicos configurables con GPT-4.1 mini. Comprueba plazas, perfiles completos, responsabilidades, requisitos, formularios, preguntas, ayudas, opciones y mensajes; salida estructurada, recomposición de fragmentos, preservación de variables, rotación de credenciales, fallo cerrado, reactivación segura, evidencia reutilizable en `audit_log` y barrido de plazas publicadas al iniciar. Los textos fijos pasan además por dos verificadores de compilación. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.124.md](PRUEBAS_CAJA_NEGRA_2.0.124.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.124` |
| Tratamiento y cobertura (`pnpm text:verify`)       | Aprobado · 77 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 9 de 9 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 90 de 90 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La inspección posterior al despliegue debe confirmar el conteo del barrido inicial, revisar una plaza histórica con fragmentos deliberados, validar que responsabilidades y requisitos queden en ideas completas y ejecutar BN-EDIT-01 a BN-EDIT-18. La nomenclatura del catálogo geográfico debe compararse con su fuente oficial y no con una reescritura generativa.
