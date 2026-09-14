# Validación final · JARVI RH 2.0.135

Fecha de ejecución: 2026-09-14. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra la vinculación múltiple de plazas al RAG: la migración `0017` crea `knowledge_project_positions` conservando el vínculo anterior, Administrador de Proyectos sustituye el selector por una lista de verificación que escanea las plazas configuradas, «Guardar proyecto» persiste las relaciones en la misma transacción, Plazas y formularios administra los proyectos de cada RAG con matriz de verificación y el agente incorpora la base de conocimiento de todos los proyectos vinculados. Administrador de Proyectos, bandeja ApiChat directa, observabilidad Langfuse y las capacidades de 2.0.134 permanecen bajo regresión. Los casos observables están en [PRUEBAS_CAJA_NEGRA_2.0.135.md](PRUEBAS_CAJA_NEGRA_2.0.135.md) y el protocolo operacional en [OBSERVABILIDAD_LANGFUSE_2.0.131.md](OBSERVABILIDAD_LANGFUSE_2.0.131.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.135` |
| Tratamiento y cobertura (`pnpm text:verify`)       | Aprobado · 89 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Pendiente · debe indicar `2.0.135 → 2.0.136` |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 14 de 14 pruebas   |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 191 de 191 pruebas |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Esquema Drizzle (`drizzle/schema.ts`)            | Aprobado · `knowledge_project_positions` alineado con `0017` |
| Retiro de n8n (`n8n-workflows/` y scripts)         | Confirmado · ausentes         |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022, ISO/IEC/IEEE 29119-1:2022, ISO/IEC 20000-1:2018, ISO/IEC 42001:2023 y prácticas DORA es metodológica y no implica certificación formal, validez psicométrica ni medición DORA completa. Después de migrar, la inspección operativa debe rotar credenciales, verificar respaldo/restauración y probar un envío controlado. Para la bandeja debe comprobar el sondeo de un segundo contra el historial del proveedor, la deduplicación por identificador, el retroceso por límite de tasa, el catálogo de endpoints con interruptores y el borrado con código temporal. Para el conocimiento debe aplicar `0016` y `0017`, configurar `KNOWLEDGE_STORAGE_DIR` en un volumen persistente y comprobar carga por arrastre, análisis de 66/325 palabras, visores, vinculación múltiple de plazas desde ambas vistas y entrega del RAG al agente en el ambiente objetivo. La entrega saliente exactamente una vez no está demostrada; el pipeline productivo de medios, la inmutabilidad WORM, la reconciliación automática y el outbox transaccional permanecen como brechas declaradas.
