# Validación final · JARVI RH 2.0.125

Fecha de ejecución: 2026-09-10. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra la corrección responsive de Revisión Humana 360°. Comprueba paginación exclusiva por botonera, tres tarjetas completas en escritorio, una tarjeta en ancho reducido, contenido sin truncamiento, altura adaptable, navegación superior, columna fija compacta con nombre y plaza, contraste diferenciado en Day y Dark y selección accesible que actualiza el detalle superior. El control editorial transversal de 2.0.124 permanece bajo regresión. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.125.md](PRUEBAS_CAJA_NEGRA_2.0.125.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.125` |
| Tratamiento y cobertura (`pnpm text:verify`)       | Aprobado · 77 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Incremento semántico aprobado |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 9 de 9 pruebas     |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 90 de 90 pruebas   |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local cuando toda la evidencia anterior resulte aprobada. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022 e ISO/IEC/IEEE 29119-1:2022 es metodológica y no implica certificación formal. La inspección posterior al despliegue debe ejecutar BN-360-01 a BN-360-08 con seis bloques y al menos dos postulaciones, tanto en Day como en Dark y en anchos superiores e inferiores a 760 píxeles. Los controles editoriales BN-EDIT-01 a BN-EDIT-18 permanecen como regresión obligatoria.
