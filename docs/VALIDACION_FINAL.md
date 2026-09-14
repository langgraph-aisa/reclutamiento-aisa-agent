# Validación final · JARVI RH 2.0.133

Fecha de ejecución: 2026-09-14. Rama objetivo: `main`.

## Alcance verificado

Esta hoja registra el retiro completo de n8n y la operación directa con ApiChat: puente `inboxSync` con sondeo de un segundo y relleno deduplicado desde `GET /v1/messages`, catálogo de los siete endpoints oficiales con interruptores auditados, burbujas con hora y ticks, tarjeta de conversación con punteo IA y etiqueta humano/agente, envío de enlace, ubicación, archivo y nota de voz, borrado de mensajes, borrado de versiones de prueba con código temporal de seis dígitos y migración `0015`, y actividad ISO con títulos de 11 palabras, resúmenes de 33 y mapa ISO/IEC 20000-1. Observabilidad Langfuse y las capacidades de 2.0.132 permanecen bajo regresión. Los casos observables están en [PRUEBAS_CAJA_NEGRA_2.0.133.md](PRUEBAS_CAJA_NEGRA_2.0.133.md) y el protocolo operacional en [OBSERVABILIDAD_LANGFUSE_2.0.131.md](OBSERVABILIDAD_LANGFUSE_2.0.131.md).

## Evidencia automatizada

| Validación                                         | Resultado                     |
| -------------------------------------------------- | ----------------------------- |
| Gobierno (`pnpm release:verify`)                   | Aprobado · `JARVI RH 2.0.133` |
| Tratamiento y cobertura (`pnpm text:verify`)       | Aprobado · 87 archivos        |
| Próxima versión (`pnpm release:bump -- --dry-run`) | Pendiente · debe indicar `2.0.133 → 2.0.134` |
| Caja negra (`pnpm test:black-box`)                 | Aprobado · 13 de 13 pruebas   |
| Regresión Vitest (`pnpm test`)                     | Aprobado · 184 de 184 pruebas |
| Contratos TypeScript (`pnpm check`)                | Aprobado                      |
| Esquema Drizzle (`drizzle/schema.ts`)            | Aprobado · `protocol_delete_challenges` alineado con `0015` |
| Retiro de n8n (`n8n-workflows/` y scripts)         | Confirmado · ausentes         |
| Build cliente/servidor (`pnpm build`)              | Aprobado                      |

El build conserva advertencias no bloqueantes preexistentes para variables opcionales de analítica y tamaño del paquete principal; no afectan la generación del artefacto ni las operaciones verificadas.

## Dictamen

El release cumple la puerta técnica local. La aplicación de ISO/IEC 25010:2023, ISO/IEC 27001:2022, ISO/IEC/IEEE 29119-1:2022, ISO/IEC 20000-1:2018, ISO/IEC 42001:2023 y prácticas DORA es metodológica y no implica certificación formal, validez psicométrica ni medición DORA completa. Después de migrar, la inspección operativa debe rotar credenciales, verificar respaldo/restauración y probar un envío controlado. Para la bandeja debe comprobar el sondeo de un segundo contra el historial del proveedor, la deduplicación por identificador, el retroceso por límite de tasa, el catálogo de endpoints con interruptores y el borrado con código temporal en el ambiente objetivo. La entrega saliente exactamente una vez no está demostrada; el pipeline productivo de medios, la inmutabilidad WORM, la reconciliación automática y el outbox transaccional permanecen como brechas declaradas.
