# Validación final · JARVI RH 2.0.137

Fecha de ejecución: 2026-09-14. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra los formularios y anuncios múltiples por plaza: «Plazas y anuncios» sustituye a «Plazas y formularios» con icono de mundo; cada plaza lista sus formularios creados con la herramienta o importados desde Excel/CSV. La importación (migración `0018`) toma la primera fila como preguntas, exige columna de teléfono o WhatsApp, reconcilia o crea candidatos con el número como única fuente de relación, registra participaciones en `application_form_submissions`, agrega respuestas sin sobrescribir y recalcula el punteo de las postulaciones afectadas. La ficha del candidato, Revisión Humana y el chat resumen las participaciones con sus respuestas. El análisis ontológico, epistemológico y fenomenológico está en [ANALISIS_ONTOLOGICO_FORMULARIOS_2.0.137.md](ANALISIS_ONTOLOGICO_FORMULARIOS_2.0.137.md). Las capacidades de 2.0.136, 2.0.135 y 2.0.134 permanecen bajo regresión. Los casos observables están en [PRUEBAS_CAJA_NEGRA_2.0.137.md](PRUEBAS_CAJA_NEGRA_2.0.137.md) y el protocolo operacional en [OBSERVABILIDAD_LANGFUSE_2.0.131.md](OBSERVABILIDAD_LANGFUSE_2.0.131.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.137` |
| Tratamiento y cobertura (`pnpm text:verify`)       | Aprobado · 90 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Aprobado · indica `2.0.137 → 2.0.138` |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 15 de 15 pruebas   |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 195 de 195 pruebas |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Esquema Drizzle (`drizzle/schema.ts`)            | Aprobado · `applicationFormSubmissions` y `source`/`import_meta` alineados con `0018` |
| Retiro de n8n (`n8n-workflows/` y scripts)         | Confirmado · ausentes         |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022, ISO/IEC/IEEE 29119-1:2022, ISO/IEC 20000-1:2018, ISO/IEC 42001:2023 y prácticas DORA es metodológica y no implica certificación formal, validez psicométrica ni medición DORA completa. Después de migrar, la inspección operativa debe rotar credenciales, verificar respaldo/restauración y probar un envío controlado. Para la bandeja debe comprobar el sondeo de un segundo contra el historial del proveedor, la deduplicación por identificador, el retroceso por límite de tasa, el catálogo de endpoints con interruptores y el borrado con código temporal. Para el conocimiento debe aplicar `0016` y `0017`, configurar `KNOWLEDGE_STORAGE_DIR` en un volumen persistente y comprobar carga por arrastre, análisis de 66/325 palabras, visores, vinculación múltiple de plazas desde ambas vistas, guardado de análisis sin error de tipos con resumen bajo el nombre y entrega del RAG al agente en el ambiente objetivo. Para formularios y anuncios debe aplicar `0018`, importar una hoja CSV/Excel con columna de teléfono, comprobar reconciliación o creación de candidatos por WhatsApp, participaciones sin duplicados, respuestas agregadas sin sobrescritura, actualización del punteo y resumen de participaciones en ficha, Revisión Humana y chat. La entrega saliente exactamente una vez no está demostrada; el pipeline productivo de medios, la inmutabilidad WORM, la reconciliación automática y el outbox transaccional permanecen como brechas declaradas.
