# Análisis ontológico, epistemológico, fenomenológico y estratégico · formularios múltiples 2.0.138

Fecha: 2026-09-14. Rama objetivo: `main`. Este documento fundamenta la solución de formularios múltiples con enlace propio, interruptor individual, vista previa administrativa y trazabilidad por variante, y declara la lógica de ingeniería de software y la estrategia de propiedad intelectual incorporadas para preservar la integridad de los datos y el valor del know-how.

## 1. Análisis ontológico

**El enlace no identifica la plaza: identifica el instrumento.** `application_forms.public_token` designa una variante concreta dentro de una plaza. Una plaza admite varias variantes —A, B, C, D— construidas con la herramienta (`source='herramienta'`) o importadas (`source='importado'`), y cada una conserva su propia capacidad de acceso, su propio interruptor y su propia evidencia. La plaza sigue siendo el anuncio; el formulario es el instrumento de captura.

**Mereología del instrumento.** `job_positions` 1—N `application_forms` 1—N `form_questions`; la hoja importada se descompone en preguntas con `field_key` estable y ordinal dentro del formulario importado. Ninguna pregunta se comparte entre variantes: cada formulario posee su propio conjunto, y por eso dos variantes pueden reutilizar el mismo `field_key` sin colisionar.

**La identidad del candidato es el WhatsApp normalizado.** `candidates.phone_international` permanece único. Completar la variante A y luego la variante B no crea dos candidatos ni dos postulaciones: crea dos participaciones (`application_form_submissions`) sobre la misma postulación, protegidas por las unicidades `(application_id, form_id)` y `(application_id, question_id)`.

**La participación es la unidad de relación, la respuesta la unidad de contenido.** `applications` conserva la invariante previa de un registro por candidato y plaza; cada variante aporta su participación con origen y fecha, y sus respuestas conservan valor JSON, valor normalizado, resultado determinista y la pregunta que las originó.

**El interruptor pertenece al instrumento, no a la plaza.** `application_forms.published` decide si esa variante está disponible. Apagar una variante no borra evidencia: cierra el acceso, invalida su enlace y deja intactas las respuestas ya registradas. Publicar la plaza es una condición necesaria, no suficiente: el enlace de formulario exige ambas condiciones.

## 2. Análisis epistemológico

**Toda respuesta conserva su procedencia.** La evaluación dejó de agrupar respuestas por `field_key` sin más contexto: cada pregunta viaja con `form_id`, `form_version`, `form_title` y `questionId`, y cuando dos variantes reutilizan la misma clave, la respuesta se indexa con una clave cualificada (`field_key#formularioN`). Antes, dos variantes con la misma clave producían una sobrescritura silenciosa —una pérdida de evidencia— y un veredicto determinista compartido por error de correlación; ahora cada respuesta se evalúa y se marca por separado.

**Idempotencia como criterio de verdad operativa.** El mismo teléfono reutiliza candidato, postulación y respuesta; el mismo formulario rechaza un segundo envío; una variante distinta agrega participación en lugar de duplicar identidad. La consistencia se verifica por restricción de base de datos, no por confianza en el orden de ejecución.

**El alcance de la lectura es parte del conocimiento.** `getByToken` resuelve la variante publicada de mayor versión —el enlace de plaza, determinista—; `getFormByToken` resuelve una variante concreta y exige que su interruptor y la plaza estén encendidos. `forms.getPreview` permite observar un borrador sin publicarlo y sin crear registros: la previsualización es lectura, no emisión de evidencia.

**Solo se conoce lo persistido.** La vista previa no genera candidatos, postulaciones, participaciones ni respuestas; no dispara evaluación con IA. Lo que se ve no es lo que se registra: la brecha entre observar y registrar se mantiene explícita.

## 3. Análisis fenomenológico

**El candidato no ve un experimento: ve una oportunidad.** Recibe un enlace, una plaza y un formulario con su propia introducción. No se le etiqueta con la variante, no se le expone la existencia de otras versiones ni el criterio de comparación. La variante es invisible para quien postula y legible para quien decide.

**La persona administradora ve antes de decidir.** En Plazas y anuncios, cada formulario muestra su enlace, su interruptor, su versión, su origen y sus conteos; «Cómo se ve» abre una previsualización que reproduce el formulario público con los mismos controles y el mismo orden, en solo lectura. La continuidad entre lo que se aprueba y lo que se publica es la misma fuente de datos, no una segunda interpretación.

**Apagar es una acción reversible y no destructiva.** El interruptor cambia la disponibilidad del enlace y conserva la evidencia; el candidato que llega a un formulario apagado recibe un mensaje claro —«Este formulario no está disponible»— sin exponer detalles internos.

**La trazabilidad es la forma del respeto.** Cada participación identifica su formulario y su fecha; la ficha del candidato agrupa las respuestas por formulario y versión; el registro de auditoría conserva actor, formulario y conteos sin copiar respuestas ni datos confidenciales.

## 4. Lógica de ingeniería de software incorporada

1. **Capacidad no predecible:** el token es de 128 bits generados con la fuente criptográfica del sistema operativo (`randomBytes(16)`), no se deriva de la plaza, la versión ni el candidato, y no es enumerable.
2. **Unicidad por restricción:** índice único `application_forms_public_token_uq` y control `CHECK (length(public_token) >= 16)`; el valor por omisión de la base de datos impide filas sin token.
3. **Migración idempotente y retrocompatible:** `0019_form_public_links.sql` añade la columna, rellena los formularios existentes, normaliza el valor por omisión y crea índice y control sin exigir orden de despliegue.
4. **Una plaza, una tarjeta:** `positions.list` resuelve el formulario más reciente con `LEFT JOIN LATERAL ... LIMIT 1`; el `LEFT JOIN` anterior devolvía una fila por formulario y duplicaba visualmente la plaza.
5. **Transaccionalidad y concurrencia:** la recepción corre en `BEGIN`/`COMMIT`/`ROLLBACK`; la reconciliación por WhatsApp, la reutilización de la postulación y la participación se apoyan en restricciones únicas que resuelven la carrera entre solicitudes simultáneas.
6. **Correlación exacta en la evaluación:** `answerKey` cualificada por variante, `questionId` en cada regla y marca determinista por pregunta; el motivo de descarte cita la pregunta que realmente falló, no la primera coincidencia por clave.
7. **Reutilización sin divergencia:** el control de pregunta y el campo público viven en un solo componente compartido por la postulación real y la previsualización administrativa.
8. **Evento diferido:** la evaluación con IA no se ejecuta durante la importación ni durante la previsualización; permanece disponible bajo demanda para no cargar la infraestructura.
9. **Pruebas de cierre:** token, resolución por enlace, rechazo de formulario apagado, no duplicación de candidato entre variantes, rechazo del mismo formulario repetido y ausencia de metodología en el payload público.

## 5. Estrategia de propiedad intelectual

**Separación estricta entre lo público y lo reservado.** El navegador recibe únicamente lo necesario para representar la pregunta: identificador, clave de campo, enunciado, ayuda, tipo, obligatoriedad, orden y una configuración depurada (`options`, `min`, `max`). Las respuestas aceptadas, la marca de requisito indispensable, los criterios de evaluación y las instrucciones del agente permanecen en el servidor y solo son visibles en el constructor administrativo. La depuración no es cosmética: antes, el instrumento de selección —qué se considera aceptable y qué descalifica— era reconstruible desde el tráfico público.

**El enlace es una capacidad, no un dato.** Un token aleatorio de 128 bits con índice único permite compartir una variante sin publicar identificadores internos, sin permitir enumeración y sin revelar cuántas variantes existen ni su relación con la plaza.

**El diseño experimental no se comunica al participante.** Las variantes comparten plaza, formulario público y experiencia; el candidato no recibe etiqueta, orden ni criterio de comparación. El diseño de pruebas A/B/C/D es información de gestión interna.

**El know-how vive en el servidor y se audita.** Pesos, reglas deterministas, criterios e instrucciones del agente permanecen fuera del bundle público; la auditoría registra actor, formulario y conteos sin replicar respuestas. La evaluación automática se ejecuta donde están las credenciales, nunca en el cliente.

**Los activos se preservan por construcción, no por ocultamiento.** `ON DELETE CASCADE` en formularios y participaciones evita huérfanos; las restricciones únicas evitan duplicados; el interruptor evita el borrado destructivo como forma de retirar una variante. La integridad de los datos es la condición material del valor del sistema.

## 6. Límites declarados

La asignación de variantes **no es aleatoria**: el sistema entrega enlaces distintos, pero la distribución de candidatos entre A, B, C y D depende de cómo se compartan esos enlaces. Por lo tanto, la plataforma habilita la experimentación comparativa, pero no constituye un ensayo aleatorizado ni calcula significancia estadística, poder, tamaño de muestra o intervalos de confianza. Tampoco valida psicométricamente los ítems, no deduce significado de celdas importadas, no sustituye la decisión humana auditada y no mide conversión por variante de forma automática. Los conteos por formulario son descriptivos y la lectura causal requiere diseño propio del equipo responsable.

## 7. Referencias de calidad asociadas

ISO/IEC 25010:2023 (adecuación funcional, fiabilidad, seguridad, mantenibilidad), ISO/IEC 27001:2022 (control de acceso y minimización de exposición), ISO/IEC/IEEE 29119-1:2022 (pruebas de caja negra sobre contratos públicos) e ISO/IEC 20000-1:2018 (control de cambios y trazabilidad operativa). La plataforma documenta sus controles; no acredita certificación.
