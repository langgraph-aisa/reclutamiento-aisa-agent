# Validación final · JARVI RH 2.0.132

Fecha de ejecución: 2026-09-11. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra la migración al SDK modular de Langfuse 5.11.1 y OpenTelemetry, la inicialización previa al tráfico, instrumentación de flujos cognitivos y servicios, redacción, seudonimización, rotación en vivo, verificación diagnóstica y cierre ordenado. Las capacidades de 2.0.130 permanecen bajo regresión. Los casos observables están especificados en [PRUEBAS_CAJA_NEGRA_2.0.132.md](PRUEBAS_CAJA_NEGRA_2.0.132.md) y el protocolo operacional en [OBSERVABILIDAD_LANGFUSE_2.0.132.md](OBSERVABILIDAD_LANGFUSE_2.0.132.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.132` |
| Tratamiento y cobertura (`pnpm text:verify`)       | Aprobado · 89 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Pendiente · debe indicar `2.0.132 → 2.0.132` |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 10 de 10 pruebas   |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 143 de 143 pruebas |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Equivalencia Drizzle (`drizzle-kit generate`)      | Sin diferencias de esquema   |
| Workflows n8n (`scripts/validate_workflows.py`)    | Aprobado · 4 de 4 workflows  |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022, ISO/IEC/IEEE 29119-1:2022, ISO/IEC 42001:2023 y prácticas DORA es metodológica y no implica certificación formal, validez psicométrica ni medición DORA completa. Después de migrar, la inspección operativa debe rotar credenciales, verificar respaldo/restauración y probar un envío controlado. Para el ingreso debe comprobar Bearer interno, revalidación `GET /v1/messages` anterior a resolución/persistencia, respuestas `422/500`, acuse posterior al backend, no retención en n8n, cuarentena y traspaso humano. La entrega saliente exactamente una vez no está demostrada; el pipeline productivo de medios, la inmutabilidad WORM, la reconciliación automática y el outbox transaccional permanecen como brechas declaradas.
