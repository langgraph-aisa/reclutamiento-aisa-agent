# Gobierno de release JARVI RH 2.0.114

## Identidad y fuente única

La versión vigente es **JARVI RH 2.0.114**. `package.json` es la fuente canónica y `shared/release.ts` expone la constante consumida por la interfaz y las pruebas. El pie del menú administrativo presenta producto, versión, rama, hash corto, sincronización con `origin/main` y distribución de lenguajes calculada durante cada build.

En esta versión, `geo_zones`, `geo_departments` y `geo_municipalities` constituyen el catálogo autorizado para nuevas postulaciones. El cliente únicamente presenta opciones; el servidor vuelve a resolver su relación activa en PostgreSQL antes de insertar. Los identificadores se guardan en `applications` y los nombres resueltos alimentan el contexto del agente. Esta doble validación evita tratar valores visuales o texto libre como evidencia territorial confiable.

El porcentaje de sincronización es metadata del artefacto desplegado, no una consulta autenticada al API de GitHub. Un build sin divergencia entre `HEAD` y `origin/main` muestra 100 %. Esta decisión evita tokens GitHub en el navegador y conserva reproducibilidad.

## Secuencia de versiones

- Cada push a `main` debe incrementar exactamente un release.
- Una versión `x.y.n` continúa como `x.y.(n+1)` hasta el parche `999`.
- Después de `2.0.999` sigue `2.1.0`; el mismo criterio se repite para los siguientes menores.
- `pnpm release:bump` actualiza la fuente y las hojas vigentes, preservando el historial del README.
- Antes de publicar, se agrega al historial fecha, descripción y alcance del nuevo release; la puerta rechaza una versión sin entrada vigente.
- `pnpm release:verify -- --compare-git` compara el release con el commit anterior.
- GitHub Actions bloquea un push incoherente mediante `.github/workflows/black-box.yml`.

## Componentes auditados

| Componente                 | Versión declarada | Evidencia                                         |
| -------------------------- | ----------------: | ------------------------------------------------- |
| Langfuse                   |           3.38.20 | `package.json` y `pnpm-lock.yaml`                 |
| LangGraph JS               |            1.4.14 | `package.json` y `pnpm-lock.yaml`                 |
| Adaptador LangChain OpenAI |            1.5.11 | `package.json` y `pnpm-lock.yaml`                 |
| OpenAI SDK para JavaScript |            7.13.0 | `package.json` y `pnpm-lock.yaml`                 |
| OpenAI Responses API       |    `v1/responses` | Uso estructurado desde `server/agentEvaluator.ts` |

La Responses API crea respuestas de modelo mediante `POST /responses`; el prefijo de servicio usado por el SDK es `/v1`. La API no comparte el versionado semántico del paquete npm, por lo que ambos datos se documentan por separado. Referencia: [documentación oficial de OpenAI](https://developers.openai.com/api/docs/guides/migrate-to-responses).

## Referencias de aseguramiento

- [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html): modelo de calidad del producto; se usa para trazabilidad de adecuación funcional, usabilidad, compatibilidad, fiabilidad, seguridad y mantenibilidad.
- [ISO/IEC 27001:2022](https://www.iso.org/standard/27001): referencia para gestión de riesgos de información. El tema se guarda como preferencia no sensible y no se introducen tokens GitHub en cliente.
- [ISO/IEC/IEEE 29119-1:2022](https://www.iso.org/standard/81291.html): conceptos generales de pruebas; cada caso registra condición, estímulo y resultado observable.

Estas normas se aplican como referencias metodológicas. Este documento no afirma certificación ni conformidad evaluada por un organismo acreditado.

## Puerta de caja negra

Cada push o solicitud de cambio a `main` ejecuta:

1. validación de versión y dependencias auditadas;
2. pruebas del contrato observable de tema y release;
3. regresión funcional Vitest;
4. comprobación TypeScript;
5. build de producción.

La migración `0011_application_location.sql` mantiene nulos los nuevos campos para lecturas históricas, pero el contrato `publicJobs.submit` los exige en toda postulación nueva. También siembra de forma idempotente las zonas 1–25 y los municipios del departamento de Guatemala necesarios para la operación inicial; cambios posteriores permanecen administrables desde Configuración > Catálogo.

La especificación del release está en [PRUEBAS_CAJA_NEGRA_2.0.114.md](PRUEBAS_CAJA_NEGRA_2.0.114.md).
