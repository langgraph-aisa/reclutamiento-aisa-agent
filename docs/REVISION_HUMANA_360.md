# Revisión Humana 360° — análisis técnico

## Resultado arquitectónico

El módulo implementa una proyección de lectura optimizada para revisión humana
sobre el modelo transaccional existente. No duplica candidatos, respuestas,
evaluaciones ni decisiones. La única operación de escritura reutiliza
`candidates.setStatus`, por lo que conserva permisos, bloqueo de fila,
transacción PostgreSQL, auditoría y la semántica de envío único de CV.

La separación principal es deliberada:

- **Plano de consulta:** `candidates.reviewWorkspace` compone la vista 360°.
- **Plano de decisión:** `candidates.setStatus` registra estado y comentario.
- **Plano de navegación:** `/admin/human-review` presenta la matriz; la ficha
  completa continúa en `/admin/candidates?application={id}`.
- **Plano de eventos:** solo el valor interno `calificado` activa la solicitud
  de CV. Los demás estados, incluido `calificado_aisa`, no generan ese evento.

## Invariantes funcionales

1. La primera carga se ordena por `submitted_at DESC`; por ello selecciona la
   última postulación ingresada dentro del filtro vigente.
2. El visor superior nunca modifica datos: representa nota IA, matriz, motivo o
   respuesta según la evidencia seleccionada en la fila.
3. Un cambio humano se confirma explícitamente. Cambiar el `select` por sí solo
   no escribe en PostgreSQL.
4. Un comentario sin cambio de estado se conserva como `comment_added` en la
   bitácora existente.
5. Las claves de campo son encabezados estables; las preguntas completas se
   preservan como contexto y las respuestas se adaptan al formulario de cada
   plaza.
6. El panel superior no depende del desplazamiento de la retícula. La tabla
   administra sus barras vertical y horizontal dentro de su propio contenedor.
7. Los controles del visor desplazan solamente sus bloques; los controles de
   resultados seleccionan la fila adyacente y sincronizan la barra vertical.

## Composición de datos

La consulta usa una sola operación SQL parametrizada y devuelve hasta 200
postulaciones por revisión:

```text
applications
  ├─ candidates                 → identidad y contacto
  ├─ job_positions              → plaza
  ├─ LATERAL latest evaluation  → score, modelo, bloques y razonamiento
  └─ LATERAL answer aggregate   → preguntas y respuestas dinámicas ordenadas
```

`LEFT JOIN LATERAL` selecciona solamente la última evaluación por aplicación y
evita el producto cartesiano entre evaluaciones y respuestas. El segundo
subquery agrega respuestas con `jsonb_agg`, preservando `fieldKey`, etiqueta,
valor normalizado y resultado determinista. Esto evita el patrón N+1 que
produciría una consulta de detalle por cada fila.

## Ordenación y filtros

Los valores de búsqueda, fechas, estado, plaza y punteo se transmiten como
parámetros PostgreSQL. Las únicas partes interpoladas son columna y dirección de
orden, ambas resueltas desde listas cerradas del servidor. Por construcción, el
usuario no puede introducir un identificador SQL arbitrario.

La búsqueda textual se difiere 250 ms para reducir solicitudes durante la
escritura. Los filtros se ejecutan en servidor para mantener el resultado
coherente con el máximo operativo y para que la selección inicial corresponda
al conjunto realmente visible.

## Modelo de interacción

La interfaz tiene cuatro estados de visor:

- `ai`: matriz porcentual y razonamiento por bloque;
- `summary`: nota inicial y contexto de la persona;
- `reason`: motivo consolidado de la evaluación;
- `answer(fieldKey)`: pregunta, respuesta y resultado determinista.

Seleccionar una fila restablece el visor a `ai`. Seleccionar una respuesta, el
icono IA, el motivo o la nota cambia el contenido sin navegar ni perder filtros.
El color de selección conecta perceptualmente fila, cabecera y visor.

El visor usa una altura compacta adaptable. Dos controles verticales recorren
el excedente cuando sus tarjetas no caben y se deshabilitan en los límites. En
el extremo inferior de la retícula, otro par recorre postulaciones, actualiza el
visor y aproxima la fila elegida a la cabecera fija. Ambos grupos exponen nombre,
estado y acciones a tecnologías de asistencia.

## Consistencia y concurrencia

La matriz es una proyección eventualmente fresca; después de guardar se
invalidan matriz, candidatos, resumen e informes. La escritura continúa usando
`SELECT ... FOR UPDATE`, actualización, creación de auditoría y `COMMIT` en el
backend ya probado. Así, dos revisores no pueden intercalar parcialmente el
mismo cambio de estado.

No se implementa edición directa de celdas de evidencia. Esa decisión protege
la procedencia de respuestas y evaluaciones: la retícula se comporta como una
hoja de cálculo para exploración, pero no transforma datos de origen.

## Seguridad y privacidad

- El procedimiento hereda `recruiterProcedure`: únicamente Administración y
  Reclutamiento pueden consultar la matriz.
- No se incorporan secretos, API keys ni payloads de configuración.
- Los filtros son parametrizados y los órdenes están en lista blanca.
- Los comentarios mantienen el límite de 1,000 caracteres del contrato actual.
- Teléfono y correo permanecen dentro del panel autenticado.
- La auditoría registra actor, antes, después, comentario y fecha.

## Rendimiento y evolución

Para el volumen actual, el límite de 200 filas y los índices existentes sobre
estado, plaza, aplicación y evaluación acotan la consulta. La complejidad de
renderizado depende del número de filas por el número de claves de campo
visibles; el desplazamiento horizontal evita comprimir información clínica u
operativa.

Si el volumen supera esa ventana, la evolución recomendada es paginación por
cursor `(submitted_at,id)`, índice trigram para búsqueda textual y una proyección
materializada de la última evaluación. Esas optimizaciones no son necesarias
para habilitar el módulo y no alteran su contrato.

## Verificación de aceptación

- La última postulación aparece seleccionada al cargar.
- Las claves de preguntas cambian dinámicamente con la plaza.
- Cada enlace de evidencia sustituye el contenido del visor azul.
- La ordenación alterna ascendente/descendente con un clic.
- La matriz posee desplazamiento vertical y horizontal independiente.
- Las flechas del visor recorren tarjetas sin mover la página.
- Las flechas inferiores recorren resultados y sincronizan la fila visible.
- Guardar un comentario sin cambiar estado produce auditoría.
- Guardar un estado actualiza candidatos, informes y tablero.
- `Calificado por AISA` no envía mensajes.
- `Solicitar CV por WhatsApp` conserva el mecanismo de entrega única.
