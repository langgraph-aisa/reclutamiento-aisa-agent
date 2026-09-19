# Expediente de auditoría de adjuntos — 18 de septiembre de 2026

El [informe](informe.md) contiene el dictamen de 2.0.179 (`b450bdb`): reconstrucción visual, contraste con el OpenAPI oficial, mapa de funciones, 16 hallazgos (H01–H16), ontología, arquitectura propuesta, protocolo forense y criterios de aceptación.

La [reauditoría](reauditoria_2.0.183.md) verifica ese dictamen contra la versión vigente (`715aee9`), ejecuta las puertas y añade los hallazgos vivos (H17–H23). **Para conocer el estado actual del conducto, lea primero la reauditoría**; el informe de 2.0.179 se conserva como antecedente y como registro del método.

| Archivo | Finalidad |
| --- | --- |
| [informe.md](informe.md) | Informe técnico y académico de 2.0.179; referencias APA 7 |
| [informe.html](informe.html) | Versión autónoma para lectura e impresión a PDF; conserva los diagramas en notación Mermaid |
| [reauditoria_2.0.183.md](reauditoria_2.0.183.md) | **Reauditoría vigente**: delta de 2.0.179 a 2.0.183, estado de H01–H16, hallazgos vivos H17–H23, árbol de decisión forense, ontología ampliada y corrección especificada |
| [validacion_tiempos_y_credencial.md](validacion_tiempos_y_credencial.md) | **Validación de credencial y de la cadena de tiempos**: esquema por delante del código, URL con secreto, umbrales de descarga, OCR y leases, y amplificación de transferencia del sondeo |
| [plan_post_auditoria.md](plan_post_auditoria.md) | **Diagnóstico de instancia**: identifica por firma de código la versión desplegada, interpreta las 16 trazas descartadas y secuencia la remediación |
| [reproduccion_pdf_bandeja.ts](reproduccion_pdf_bandeja.ts) | **Reproducción del síntoma**: cinco formas de notificar el mismo PDF contra PostgreSQL real. Dos llegan a la bandeja, tres mueren en la cola de recepción |
| [plan_puesta_en_vivo.md](plan_puesta_en_vivo.md) | **Plan de acción quirúrgico**: hacer existir el conducto, abrir las siete puertas de operación, prueba de vida con los cuatro formatos, cinco reparaciones, recuperación del caso y vigilancia |
| [reauditoria_2.0.183.ts](reauditoria_2.0.183.ts) | 15 caracterizaciones deterministas con las funciones vigentes; sin red, sin base de datos |
| [resultado_reauditoria.json](resultado_reauditoria.json) | Resultado de esas caracterizaciones |
| [manifiesto.json](manifiesto.json) | Identificación del checkout, fuentes oficiales y hashes de los archivos examinados y entregados |
| [consultas_solo_lectura.sql](consultas_solo_lectura.sql) | Consultas Q1–Q10 para correlacionar un ID de mensaje y una postulación. **Verificadas** contra PostgreSQL 16 real con el esquema completo; no ejecutadas contra producción |
| [contraejemplos.ts](contraejemplos.ts) | Cinco caracterizaciones de 2.0.179. **Obsoletas**: hoy abortan porque los defectos que describían fueron reparados. Su fallo es la evidencia del delta |
| [resultado.json](resultado.json) | Resultado de esas caracterizaciones sobre 2.0.179 |
| [validacion.json](validacion.json) | Comando y resultado de las pruebas de esa entrega |
| [validacion_reparacion.md](validacion_reparacion.md) | Validación de la solución de reparación de 2.0.180; describe un árbol intermedio, no el vigente |

Reproducción local, desde la raíz del repositorio y con las dependencias ya instaladas:

```bash
# Estado vigente del conducto (15 caracterizaciones)
node --import tsx docs/audits/2026-09-18-apichat/reauditoria_2.0.183.ts

# Delta: los contraejemplos de 2.0.179 deben abortar
node --import tsx docs/audits/2026-09-18-apichat/contraejemplos.ts
```

Las aserciones de `reauditoria_2.0.183.ts` describen el comportamiento **actual**: que pasen confirma la caracterización; tras reparar un hallazgo, deben actualizarse las que le correspondan.

Las pruebas y las consultas tienen alcances distintos: las primeras se ejecutan localmente; las segundas requieren un rol autorizado y los parámetros del incidente. Con los valores `NULL` predeterminados, las consultas específicas del candidato devuelven cero filas y evitan exportaciones generales. Los bloques de inventario sí consultan metadatos del esquema.

No se modificó código productivo, no se desplegó una reparación y no se accedió a servicios privados. El informe establece defectos contractuales y de implementación; la causa histórica del PDF requiere sus registros correlacionados.
