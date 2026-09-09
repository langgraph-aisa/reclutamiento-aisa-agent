# Viabilidad técnica: portada de plazas públicas

La funcionalidad es técnicamente viable con la arquitectura actual y no requiere una migración de base de datos.

## Diseño implementado

- La portada consume una consulta pública de solo lectura que devuelve exclusivamente plazas activas con un formulario publicado.
- La plaza inicial se determina de forma estable por `created_at DESC, id DESC`; por tanto, siempre se presenta primero la última plaza creada que continúa disponible.
- La relación con el perfil laboral se resuelve mediante una unión lateral limitada a un perfil activo. Esto evita filas duplicadas cuando existen asociaciones históricas.
- Solo se exponen título, descripción, ubicación y los campos de presentación del perfil. No se publican claves de agente, reglas internas, evaluaciones ni datos de candidatos.
- El selector cambia la oportunidad en memoria y el botón navega a `/apply/:token` en la misma pestaña, reutilizando el formulario público existente.
- El horario institucional se mantiene en una constante compartida para mostrar el mismo texto tanto en la portada como antes de comenzar el formulario.

## Comportamiento controlado

- Sin plazas publicadas: se muestra un estado vacío y no se ofrece un enlace inválido.
- Plaza sin perfil asociado: se usan el título y la descripción de la plaza como valores de respaldo.
- Plaza sin formulario publicado: no aparece en la portada.
- Varias versiones de formulario: la consulta exige una versión publicada y selecciona la versión más reciente para determinar disponibilidad.

La implementación conserva el flujo de postulación, las validaciones y el registro transaccional existentes.
