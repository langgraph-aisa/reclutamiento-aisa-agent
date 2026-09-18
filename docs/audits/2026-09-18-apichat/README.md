# Expediente de auditoría de adjuntos — 18 de septiembre de 2026

El [informe](informe.md) contiene el dictamen, reconstrucción visual, contraste con OpenAPI oficial, mapa de funciones, 16 hallazgos, ontología, arquitectura propuesta, protocolo forense y criterios de aceptación.

| Archivo | Finalidad |
| --- | --- |
| [informe.md](informe.md) | Informe técnico y académico; referencias APA 7 |
| [informe.html](informe.html) | Versión autónoma para lectura e impresión a PDF; conserva los diagramas en notación Mermaid |
| [manifiesto.json](manifiesto.json) | Identificación del checkout, fuentes oficiales y hashes de los archivos examinados y entregados |
| [consultas_solo_lectura.sql](consultas_solo_lectura.sql) | Consultas para correlacionar un ID de mensaje y una postulación; no ejecutadas contra producción |
| [contraejemplos.ts](contraejemplos.ts) | Cinco caracterizaciones deterministas con funciones reales y datos ficticios |
| [resultado.json](resultado.json) | Resultado de esas caracterizaciones |
| [validacion.json](validacion.json) | Comando y resultado de las 125 pruebas existentes seleccionadas |
| [validacion_reparacion.md](validacion_reparacion.md) | Validación académica de la solución de reparación: defectos de ejecución detectados y reparados, caja negra con PostgreSQL real y estado por hallazgo |

Reproducción local, desde la raíz del repositorio y con las dependencias ya instaladas:

```bash
node --import tsx docs/audits/2026-09-18-apichat/contraejemplos.ts
```

Estas aserciones describen defectos de la revisión auditada. **Que pasen confirma los contraejemplos; no demuestra una corrección.** Tras reparar las funciones, deben actualizarse o archivarse como evidencia de la versión anterior.

Las pruebas y las consultas tienen alcances distintos: las primeras fueron ejecutadas localmente; las segundas requieren un rol autorizado y parámetros del incidente. Con los valores NULL predeterminados, las consultas específicas del candidato devuelven cero filas y evitan exportaciones generales. Los bloques de inventario sí consultan metadatos del esquema.

No se modificó código productivo, no se desplegó una reparación y no se accedió a servicios privados. El informe establece defectos contractuales y de implementación; la causa histórica del PDF requiere sus registros correlacionados.
