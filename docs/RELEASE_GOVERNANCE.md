# Gobierno de release JARVI RH 2.0.127

## Identidad y fuente única

La versión vigente es **JARVI RH 2.0.127**. `package.json` es la fuente canónica y `shared/release.ts` expone la constante consumida por la interfaz y las pruebas. El pie del menú administrativo presenta producto, versión, rama, hash corto, sincronización con `origin/main` y distribución de lenguajes calculada durante cada build.

La versión 2.0.127 presenta en la landing el mensaje institucional «Plataforma Laboral No.1 de Guatemala» junto al icono de verificación. Sustituye por completo la frase anterior y mantiene la misma composición responsive, jerarquía visual y contraste temático. La prueba de caja negra comprueba tanto la presencia del texto aprobado como la ausencia del sustituido.

La versión 2.0.126 fortaleció la revisión de responsabilidades para las 25 plazas detectadas en el catálogo público. La auditoría previa al cambio confirmó fragmentos separados dentro de paréntesis, enumeraciones divididas, complementos en minúscula y construcciones nominales que no expresaban una acción completa. El defecto no estaba en la representación visual: la lista persistida ya contenía esos elementos aislados.

`profileEditorial.ts` conserva Structured Outputs y añade una poscondición independiente del modelo. Para `responsibilities`, cada elemento debe mantener delimitadores balanceados, comenzar con mayúscula y verbo en infinitivo y terminar con puntuación; para `requiredRequirements`, cada proposición debe ser autónoma, iniciar correctamente, cerrar su puntuación y mantener completos sus incisos. Una salida que solo cumpla el esquema JSON, pero no estas reglas lingüísticas, se rechaza y no obtiene evidencia válida.

La política `2026-09-10.3` forma parte del hash y de `audit_log`. Por ello, una validación hecha con la política anterior no puede omitir el nuevo control: al desplegar, `auditPublishedPublicCopy` vuelve a recorrer las 25 plazas publicadas, corrige PostgreSQL mediante GPT-4.1 mini y registra modelo, ranura, hash y versión de política. Las lecturas públicas continúan sin llamadas a OpenAI.

La versión 2.0.125 corrigió la composición de Revisión Humana 360°. La matriz de evaluación deja de depender de un contenedor con altura fija y desplazamiento interno: `ResizeObserver` selecciona páginas de tres bloques cuando el panel dispone de al menos 760 píxeles y páginas de un bloque en anchos inferiores. Cada página muestra el razonamiento completo, iguala la altura visual de sus tarjetas y adapta el panel a la tarjeta más extensa. `reviewBlockPageRange` y `adjacentReviewBlockPage` limitan el rango y los extremos de forma determinista.

La botonera de bloques comparte el encabezado con «Vista 360° del Candidato», informa el intervalo visible y es la única acción que cambia la página. La botonera que selecciona candidatos también abandona la esquina inferior y queda fija en la parte superior derecha de la matriz. Ambas usan controles con etiquetas accesibles, estado anunciado y disposición horizontal para evitar que oculten datos.

La primera columna se reduce de 300 a 210 píxeles como máximo y queda fija durante el desplazamiento horizontal. Muestra exclusivamente nombre y plaza; seleccionar su botón carga el detalle completo en el resumen y el visor superiores. Day usa superficies azul grisáceo claras y Dark emplea superficies grafito diferenciadas; selección, borde lateral, sombra y anillo de foco mantienen la columna reconocible sin depender solo del color. Las filas reducen relleno y altura de controles para presentar más postulaciones sin perder sus acciones.

La versión 2.0.124 extendió el control editorial a todo texto público configurable: título, área, ubicación, descripción y mensaje de cada plaza; nombre, resumen, objetivo, responsabilidades, requisitos, competencias, conocimientos, nivel académico, idiomas, licencias, disponibilidad, ubicación, rango salarial y modalidad del perfil; título e introducción del formulario; y enunciado, ayuda, opciones, criterio y prompt de cada pregunta. La nomenclatura geográfica administrada desde el catálogo oficial se preserva como fuente autoritativa y no se reinterpreta generativamente.

Antes de guardar, activar o publicar, el servidor solicita a `gpt-4.1-mini-2025-04-14` una salida estructurada mediante OpenAI Responses API. La instrucción exige español estándar formal conforme a RAE/ASALE, conserva hechos, cifras, nombres, condiciones y variables `{{...}}`, corrige ortografía, gramática, sintaxis, semántica y puntuación, y permite recomponer fragmentos de una misma responsabilidad o requisito. La UI administrativa almacena responsabilidades y requisitos con una idea completa por línea; las comas ya no dividen una oración en viñetas distintas.

El control falla de forma cerrada ante credencial ausente, Responses API deshabilitada, salida vacía, claves estructurales alteradas o variables modificadas. `store: false` evita solicitar almacenamiento de la respuesta; la rotación principal/respaldo no expone secretos en registros. `audit_log` conserva entrada, salida, hash, modelo y ranura empleada; el hash exacto permite reutilizar evidencia sin otra llamada, mientras cualquier cambio obliga a validar de nuevo.

Las rutas de reactivación de perfiles y preguntas ejecutan el mismo control antes de volver a exponer contenido histórico. La publicación directa desde la edición valida la plaza, su perfil y el formulario completo. Al iniciar el servidor, `auditPublishedPublicCopy` obtiene un bloqueo consultivo PostgreSQL y recorre secuencialmente todas las plazas que ya tienen plaza y formulario publicados; normaliza sus entidades sin cargar ese costo a quien visita la landing. Un fallo queda aislado por plaza, no revela datos ni detiene el servicio y se informa por conteo para intervención administrativa.

Los textos institucionales fijos no dependen de una llamada externa en cada vista. `scripts/verify-formal-spanish.mjs` verifica el tratamiento «usted» y `scripts/verify-public-copy.mjs` comprueba en cada build que perfiles, plazas, formularios, preguntas, activaciones, publicación, evidencia y barrido de existentes conserven el control. La portada mantiene los ajustes de 2.0.123: enlace corto de privacidad, lema «Cada candidato merece una evaluación a su medida» y descripción institucional de Talento AISA.

Desde 2.0.122, `profiles.list` agrega `position_ids` y la UI los precarga al editar; antes, el formulario los dejaba vacíos y `profiles.upsert` eliminaba el vínculo aun cuando el perfil conservara objetivo, responsabilidades y requisitos. La publicación busca primero una asociación explícita completa y, si no existe, admite un perfil activo completo cuyo nombre coincida exactamente con el título de la plaza; en ese caso inserta la relación con `ON CONFLICT DO NOTHING` antes de publicar. La ausencia de perfil válido permanece bloqueada y `Jobs.tsx` muestra el mensaje del endpoint.

`publicJobs.listPublished` asigna prioridad determinista a Ejecutivo de Negocios (Ventas) antes de ordenar el resto por creación e identificador descendentes. La regla usa un parámetro SQL y afecta tanto la primera opción del selector como la selección inicial de la landing. No altera el orden administrativo ni las demás plazas.

Desde 2.0.121, una plaza solo integra el catálogo público cuando está publicada, dispone de formulario publicado y mantiene un perfil activo con objetivo, responsabilidades y al menos un requisito obligatorio. `publicJobs.listPublished` y `publicJobs.getByToken` resuelven esos datos mediante `JOIN LATERAL` deterministas; la interfaz presenta objetivo, responsabilidades y todos los requisitos sin textos sustitutos.

La composición elimina el divisor y relleno vertical redundantes de la tarjeta, identifica OPORTUNIDADES DISPONIBLES y RESPONSABILIDADES DEL PUESTO en mayúsculas y duplica el ancho de JARVI en escritorio de 12 a 24 rem. Productos, contacto y privacidad usan destinos explícitos en pestañas paralelas con `noopener noreferrer`; el ingreso interno se denomina Acceso Administrativo. La adaptación conserva tamaños intermedios para no invadir acciones ni contenido en pantallas estrechas.

Desde 2.0.120, los 20 elementos `h1` usan `--color-heading`, que conserva el tono institucional en Day y adopta `#FFFFFF` en Dark Dimmed y Dark High Contrast. La regla global tiene precedencia deliberada sobre colores heredados de héroes y controles. En `/privacidad-terminos`, el encabezado completo recibe además texto blanco para que etiqueta, versión, título e introducción no hereden `primary-foreground`, cuyo valor oscuro corresponde exclusivamente a texto sobre superficies teal.

`scripts/verify-theme-css.mjs` inspecciona el artefacto minificado y exige tanto el valor blanco del token como la regla global de `h1`; la caja negra confirma su presencia junto con todas las superficies React implicadas. El contraste de blanco sobre el panel grafito `#162333` es 15.88:1, por encima de 4.5:1 para texto normal y 3:1 para texto grande según WCAG 2.2.

Desde 2.0.119, el tratamiento escrito institucional utiliza **usted** en portal público, formularios, administración, validaciones, correo de acceso, WhatsApp y plantillas operativas. `scripts/verify-formal-spanish.mjs` inspecciona literales de 77 archivos de ejecución y forma parte de `release:verify`, `test:black-box` y `build`. La migración `0012_dear_lifeguard.sql` homologa únicamente textos históricos predeterminados y conserva contenido libre de administración.

Desde 2.0.118, `/privacidad-terminos` funciona como documento interno de referencia, separado del formulario y disponible en una pestaña paralela mediante `target="_blank"` y `rel="noopener noreferrer"`. La ruta identifica a Alternativas Inteligentes, S.A., elimina marcadores editoriales, explica uso y límites de IA, categorías y finalidades de datos, proveedores, seguridad, conservación y solicitudes. Título, descripción y URL canónica se establecen como metadata de la página. El texto distingue compromisos voluntarios y normas aplicables; no presenta una iniciativa legislativa como ley vigente ni equivale a dictamen jurídico.

Desde 2.0.117, todos los formularios públicos incorporan un bloque común e inalterable con tres manifestaciones: mayoría de edad, veracidad y actualización de la información, y autorización de tratamiento. La interfaz exige cada casilla y el contrato tRPC vuelve a validar los tres booleanos antes de acceder a PostgreSQL. La transacción guarda en `audit_log` la versión del texto, cada enunciado y su aceptación junto con la postulación. La versión del aviso cambia a `2026-09-10.2`, por lo que las nuevas aceptaciones preservan exactamente el nuevo enunciado enlazado.

`geo_zones`, `geo_departments` y `geo_municipalities` continúan como catálogo autorizado para nuevas postulaciones. El cliente únicamente presenta opciones; el servidor vuelve a resolver su relación activa en PostgreSQL antes de insertar. Los identificadores se guardan en `applications` y los nombres resueltos alimentan el contexto del agente. Esta doble validación evita tratar valores visuales o texto libre como evidencia territorial confiable.

El porcentaje de sincronización es metadata del artefacto desplegado, no una consulta autenticada al API de GitHub. Un build sin divergencia entre `HEAD` y `origin/main` muestra 100 %. Esta decisión evita tokens GitHub en el navegador y conserva reproducibilidad.

## Gobierno de visualización

El control global recorre tres preferencias persistentes: **Day**, **Dark Dimmed** y **Dark High Contrast**. La aplicación las activa antes de hidratar React para evitar un destello de tema incorrecto y las conserva en `localStorage` como preferencia no sensible. Login, portada, postulación y rutas administrativas consumen los mismos tokens funcionales; las superficies estructurales usan azul AISA profundo y las señales de éxito, información, IA, atención y error conservan color semántico acompañado de texto, icono o forma.

La paleta Dark Dimmed adopta fondo `#0B1118`, superficie `#111A24`, elevación `#162333`, borde estructural `#2A3949`, borde identificable de control `#7F8C9A`, texto principal `#E6EDF3`, secundario `#AAB7C5` y foco/acción `#35D6B1`. Los contrastes calculados de esos textos y del teal sobre el fondo son 16.05:1, 9.29:1 y 10.30:1; el control sobre superficie alcanza 5.11:1. La prueba automatizada exige 4.5:1 para texto y 3:1 para la frontera del control; la inspección posterior al despliegue debe comprobar indicadores en sus fondos reales conforme a WCAG 2.2.

El alcance es un sistema de visualización alternativa orientado al confort, personalización y accesibilidad. No afirma que el modo oscuro elimine o reduzca universalmente la fatiga visual: Intaruk et al. (2025) no observaron diferencia estadísticamente significativa de fatiga inmediata entre modos en su muestra, aunque reportaron diferencias en otras variables y recomendaron estudios longitudinales. GitHub también ofrece alternativas oscuras y de alto contraste según preferencia o necesidad visual, lo que respalda ofrecer elección en vez de imponer una sola polaridad.

La corrección 2.0.116 eliminó `@theme inline`: esa directiva había convertido utilidades como `bg-background`, `bg-card`, `bg-sidebar` y `text-foreground` en valores claros fijos, aunque las variables del nodo raíz sí cambiaran. `scripts/verify-theme-css.mjs` inspecciona el artefacto minificado después de Vite y detiene el build si esas utilidades dejan de referenciar `var(--color-*)`. Las superficies estructurales oscuras usan gris grafito `#162333` en lugar del azul profundo; el azul se limita a información semántica.

## Secuencia de versiones

- Cada push a `main` debe incrementar exactamente un release.
- Una versión `x.y.n` continúa como `x.y.(n+1)` hasta el parche `999`.
- Después de `2.0.999` sigue `2.1.0`; el mismo criterio se repite para los siguientes menores.
- `pnpm release:bump` actualiza la fuente y las hojas vigentes, preservando el historial del README.
- Antes de publicar, se agrega al historial fecha, descripción y alcance del nuevo release; la puerta rechaza una versión sin entrada vigente.
- `pnpm release:verify -- --compare-git` compara el release con el commit anterior.
- GitHub Actions bloquea un push incoherente mediante `.github/workflows/black-box.yml`.

## Componentes auditados

| Componente                 | Versión declarada | Evidencia                                         |
| -------------------------- | ----------------: | ------------------------------------------------- |
| Langfuse                   |           3.38.20 | `package.json` y `pnpm-lock.yaml`                 |
| LangGraph JS               |            1.4.14 | `package.json` y `pnpm-lock.yaml`                 |
| Adaptador LangChain OpenAI |            1.5.11 | `package.json` y `pnpm-lock.yaml`                 |
| OpenAI SDK para JavaScript |            7.13.0 | `package.json` y `pnpm-lock.yaml`                 |
| OpenAI Responses API       |    `v1/responses` | Uso estructurado desde `server/agentEvaluator.ts` |
| Modelo editorial           |      GPT-4.1 mini | Snapshot `gpt-4.1-mini-2025-04-14`                |

La Responses API crea respuestas de modelo mediante `POST /responses`; el prefijo de servicio usado por el SDK es `/v1`. La API no comparte el versionado semántico del paquete npm, por lo que ambos datos se documentan por separado. Referencias: [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) y [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), documentación oficial de OpenAI.

## Referencias de aseguramiento

- [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html): modelo de calidad del producto; se usa para trazabilidad de adecuación funcional, usabilidad, compatibilidad, fiabilidad, seguridad y mantenibilidad.
- [ISO/IEC 27001:2022](https://www.iso.org/standard/27001): referencia para gestión de riesgos de información. El tema se guarda como preferencia no sensible y no se introducen tokens GitHub en cliente.
- [ISO/IEC/IEEE 29119-1:2022](https://www.iso.org/standard/81291.html): conceptos generales de pruebas; cada caso registra condición, estímulo y resultado observable.

Estas normas se aplican como referencias metodológicas. Este documento no afirma certificación ni conformidad evaluada por un organismo acreditado.

## Puerta de caja negra

Cada push o solicitud de cambio a `main` ejecuta:

1. validación de versión, dependencias auditadas y tratamiento formal;
2. pruebas del contrato observable de tema y release;
3. regresión funcional Vitest;
4. comprobación TypeScript;
5. build de producción.

La migración `0011_application_location.sql` mantiene nulos los nuevos campos para lecturas históricas, pero el contrato `publicJobs.submit` los exige en toda postulación nueva. También siembra de forma idempotente las zonas 1–25 y los municipios del departamento de Guatemala necesarios para la operación inicial; cambios posteriores permanecen administrables desde Configuración > Catálogo.

Las confirmaciones de 2.0.117 son controles institucionales transversales, no preguntas configurables de una plaza. El endpoint rechaza propiedades ausentes, falsas o adicionales y registra las aceptaciones únicamente cuando la postulación completa confirma su transacción. La ruta jurídica creada en 2.0.118 no recibe ni expone datos de la postulación.

La revisión normativa consultó fuentes oficiales del Congreso y DIACO: Decreto 47-2008 sobre comunicaciones electrónicas, Decreto 06-2003 sobre protección al consumidor, Decreto 57-2008 sobre acceso a información pública y el estado legislativo de iniciativas generales de protección de datos a septiembre de 2026. Las referencias contextualizan el documento; la validación final por asesoría jurídica de AISA continúa siendo un control organizacional requerido.

La especificación del release está en [PRUEBAS_CAJA_NEGRA_2.0.127.md](PRUEBAS_CAJA_NEGRA_2.0.127.md).
