# Análisis ontológico, epistemológico y fenomenológico · formularios y anuncios 2.0.137

Fecha: 2026-09-14. Rama objetivo: `main`. Este documento fundamenta la solución de formularios múltiples por plaza, importación desde hoja de cálculo y participaciones del candidato, y declara la lógica de ingeniería de software incorporada para preservar consistencia de datos.

## 1. Análisis ontológico

**La plaza es un anuncio, no el instrumento.** `job_positions` expresa la oferta organizacional (título, área, ubicación, mensaje institucional). El formulario es un instrumento de captura distinto: una plaza puede administrar varios, unos construidos con la herramienta (`source='herramienta'`) y otros importados (`source='importado'`). Ningún formulario reemplaza a la plaza; cada uno se relaciona con ella mediante clave foránea con borrado en cascada.

**El candidato no es su número, pero el número es su identidad de relación.** `candidates.phone_international` permanece único. La importación no inventa entidades: si el número de WhatsApp ya existe, la fila se reconcilia con el candidato existente; si no existe, se crea con el número como única fuente de relación autorizada. El nombre importado solo completa un registro sin nombre (`COALESCE(candidates.full_name, EXCLUDED.full_name)`), nunca sobrescribe identidad persistida.

**La participación es una entidad explícita.** `application_form_submissions` registra qué formularios o anuncios llenó cada postulación, con origen (`formulario` o `importado`) y fecha. Una postulación (`applications`) conserva la invariante previa de un registro por candidato y plaza; las participaciones adicionales no duplican la postulación: agregan respuestas a la misma, protegidas por unicidad `(application_id, question_id)` y `(application_id, form_id)`.

**La pregunta es el átomo del instrumento.** Cada columna con encabezado de la hoja se convierte en `form_questions` con `field_key` estable (slug normalizado + ordinal) dentro del formulario importado. La respuesta (`application_answers`) conserva valor JSON, valor normalizado y regla determinista, sin mezclar preguntas de formularios distintos.

## 2. Análisis epistemológico

**Solo se conoce lo persistido.** La importación persiste únicamente el contenido de las celdas; una celda vacía es ausencia, no evidencia negativa: no se crea respuesta para ella ni se marca al candidato como incumplidor.

**El testimonio importado es evidencia de participación, no verificación.** Las respuestas cargadas desde Excel entran al análisis del agente con el mismo contrato que las respuestas del formulario público: quedan trazadas, son revisables por el equipo humano y el punteo IA se recalcula cuando la importación agrega respuestas. El número de WhatsApp nunca puntúa: es clave de relación, no atributo de mérito.

**La idempotencia es el criterio de verdad operativa.** Reimportar la misma hoja no duplica candidatos, postulaciones, participaciones ni respuestas: `ON CONFLICT DO NOTHING` en participaciones y respuestas, reconciliación por teléfono en candidatos y reutilización de la postulación existente. La consistencia se verifica por restricción, no por confianza en el orden de ejecución.

**El límite protege la inferencia.** La importación exige una columna de teléfono, al menos una columna de pregunta y archivos CSV/Excel de hasta 5 MB; filas sin teléfono válido se cuentan y se descartan sin silencio (el resumen informa `rowsSkippedNoPhone`).

## 3. Análisis fenomenológico

**Una sola hoja para saber y actuar.** La experiencia del reclutador se conserva en la misma página: en Plazas y anuncios, cada plaza muestra sus formularios y el botón «Importar Excel/CSV» abre el diálogo sin abandonar la vista. En Revisión Humana, la pestaña «Nota IA» resume los formularios y anuncios donde participó la persona con sus respuestas; la matriz ya expone cada pregunta importada como columna dinámica. La ficha del candidato agrupa las respuestas por formulario y el módulo de chat muestra el conteo y los títulos de las participaciones.

**El candidato no rellena formularios, atraviesa un proceso.** Cada participación nueva alimenta el análisis y actualiza el punteo: la evaluación vuelve a ejecutarse para las postulaciones afectadas por la importación. La decisión de contratación permanece en el equipo humano; la herramienta reduce la fricción de consolidar evidencia dispersa sin sustituir el juicio.

**La trazabilidad es la forma del respeto.** Toda importación registra `audit_log` con actor, formulario, conteos y metadatos del archivo, sin copiar respuestas ni datos confidenciales al registro de auditoría.

## 4. Lógica de ingeniería de software incorporada

1. **Transaccionalidad:** la importación corre dentro de `BEGIN`/`COMMIT`/`ROLLBACK`; una fila inválida descarta la operación completa y conserva la base íntegra.
2. **Restricciones como contrato:** unicidad `(application_id, form_id)`, unicidad `(application_id, question_id)`, unicidad de `phone_international` y `CHECK` de `source` en formularios y participaciones.
3. **Idempotencia por diseño:** reimportar produce el mismo estado lógico (sin duplicados) y las respuestas existentes nunca se sobrescriben.
4. **Migración idempotente y retrocompatible:** `0018_form_imports.sql` usa `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS` y siembra participaciones históricas desde `applications.form_id`.
5. **Separación de lecturas:** `forms.listByPosition`, `candidates.list` (resumen de respuestas), `candidates.reviewWorkspace` (participaciones y respuestas) y `candidates.detail` (agrupación por formulario) mantienen contratos distintos para vistas distintas.
6. **Límites y validación temprana:** tamaño máximo, extensiones permitidas, teléfono validado con `libphonenumber-js` y descarte explícito de filas sin relación de identidad.
7. **Re-evaluación controlada:** solo las postulaciones con respuestas nuevas (`affectedApplicationIds`) vuelven a evaluarse, con el mismo bloqueo consultivo y manejo seguro de mensajes del agente.
8. **Modelo tipado:** `drizzle/schema.ts` declara `applicationFormSubmissions` y las columnas `source`/`import_meta`, manteniendo al esquema como fuente de tipos del sistema.

## 5. Límites declarados

La importación no interpreta semántica de celdas (todo se captura como texto), no deduce geografía ni estado de aplicación desde la hoja, no sustituye la revisión humana y no valida psicométricamente el contenido importado. El punteo IA se recalcula con el modelo y las reglas vigentes; la verdad de fondo la conserva la decisión humana auditada.
