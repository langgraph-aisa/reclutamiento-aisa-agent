# Gobierno de release JARVI RH 2.0.131

## Identidad y fuente única

La versión vigente es **JARVI RH 2.0.131**. `package.json` es la fuente canónica y `shared/release.ts` expone la constante consumida por la interfaz y las pruebas. El pie del menú administrativo presenta producto, versión, rama, hash corto, sincronización con `origin/main` y distribución de lenguajes calculada durante cada build.

### Alcance candidato 2.0.131

El release candidato incorpora observabilidad en vivo mediante el SDK modular de Langfuse 5.11.1 y OpenTelemetry 0.222.0. La instrumentación cubre evaluación LangGraph, generaciones OpenAI, edición asistida, ApiChat, solicitud de currículum, bandeja y audio; aplica seudonimización, redacción previa a exportación, muestreo, rotación inmediata y cierre ordenado. Las capacidades de 2.0.130 permanecen bajo regresión.

El alcance no incluye todavía descarga productiva de medios ApiChat, bucket, antivirus, previsualización de PDF/Word/audio, ejecución adaptativa completa de pruebas, validación psicométrica ni ingestión de despliegues e incidentes para calcular DORA. La actividad usa sondeo de cuatro o cinco segundos según la vista, no streaming. Los resúmenes de actividad son deterministas aunque exista un selector reservado para un modelo futuro. El workflow 04 debe importarse, recibir su Header Auth interno y activarse antes de que la URL n8n configurada acepte el sobre `messages` de ApiChat.

El protocolo de privacidad, despliegue, verificación y rollback se documenta en [OBSERVABILIDAD_LANGFUSE_2.0.131.md](OBSERVABILIDAD_LANGFUSE_2.0.131.md). El análisis cognitivo general permanece en [ANALISIS_COGNITIVO_DORA_2.0.130.md](ANALISIS_COGNITIVO_DORA_2.0.130.md). El incremento atómico a 2.0.131 ya fue ejecutado; `pnpm release:bump -- --dry-run` confirma que el siguiente parche será 2.0.132.

La versión 2.0.129 convirtió Configuración > WhatsApp en el almacén operativo de ApiChat. `integration_settings` conserva preferencias y secretos cifrados; el cliente recibe únicamente estado y máscara. `cvRequest.ts` obtiene la configuración mediante `getApiChatRuntimeSettings` después de confirmar la transacción y `apichat.ts` ya no consulta el entorno. La ruta genérica de configuración queda limitada al proveedor no secreto `recruitment`.

Client ID, token e ID de cuenta se cifran con AES-256-GCM y autenticación antes de persistirse. Cada rotación o eliminación registra clave y estado en `audit_log`, nunca el valor. Una fila histórica en texto plano se rechaza y exige rotación desde el módulo seguro. La verificación nativa ejecuta `GET /v1/status`, no envía mensajes y descarta cualquier contenido QR antes de responder al navegador.

La migración `0013_apichat_credential_vault.sql` es idempotente, inicializa los valores públicos aprobados y reserva filas secretas con `NULL`. Los secretos deben ingresarse desde la UI para garantizar su cifrado; no se entregan como SQL ni se almacenan en el repositorio. El endpoint nativo exige HTTPS, `api.apichat.io` y `/v1/sendText`.

La versión 2.0.128 corrigió el mensaje institucional de la landing a «Plataforma Laboral No.1» y eliminó el sufijo «de Guatemala» introducido en 2.0.127.

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

Desde 2.0.119, el tratamiento escrito institucional utiliza **usted** en portal público, formularios, administración, validaciones, correo de acceso, WhatsApp y plantillas operativas. `scripts/verify-formal-spanish.mjs` inspecciona los 78 archivos de ejecución vigentes y forma parte de `release:verify`, `test:black-box` y `build`. La migración `0012_dear_lifeguard.sql` homologa únicamente textos históricos predeterminados y conserva contenido libre de administración.

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
| Langfuse SDK modular       |            5.11.1 | `@langfuse/client`, `tracing`, `otel`, `openai` y `langchain` |
| OpenTelemetry SDK Node     |           0.222.0 | `package.json` y `pnpm-lock.yaml`                 |
| LangGraph JS               |            1.4.14 | `package.json` y `pnpm-lock.yaml`                 |
| Adaptador LangChain OpenAI |            1.5.11 | `package.json` y `pnpm-lock.yaml`                 |
| OpenAI SDK para JavaScript |            7.13.0 | `package.json` y `pnpm-lock.yaml`                 |
| OpenAI Responses API       |    `v1/responses` | Uso estructurado desde `server/agentEvaluator.ts` |
| OpenAI Transcriptions API  | `v1/audio/transcriptions` | Servicio aislado en `server/_core/voiceTranscription.ts` |
| OpenAI Speech API          | `v1/audio/speech` | Servicio aislado en `server/_core/voiceTranscription.ts` |
| Modelo editorial           |      GPT-4.1 mini | Snapshot `gpt-4.1-mini-2025-04-14`                |
| Modelo de transcripción inicial | `gpt-4o-mini-transcribe` | Preferencia en PostgreSQL; flujo ApiChat de medios pendiente |
| Modelo TTS inicial         | `gpt-4o-mini-tts` | Voz `coral`; integración productiva con bandeja pendiente |

La Responses API crea respuestas de modelo mediante `POST /responses`; el prefijo de servicio usado por el SDK es `/v1`. La API no comparte el versionado semántico del paquete npm, por lo que ambos datos se documentan por separado. Referencias oficiales: [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [transcripción](https://developers.openai.com/api/reference/cli/resources/audio/subresources/transcriptions/methods/create) y [texto a voz](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create).

## Referencias de aseguramiento

- [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html): modelo de calidad del producto; se usa para trazabilidad de adecuación funcional, usabilidad, compatibilidad, fiabilidad, seguridad y mantenibilidad.
- [ISO/IEC 27001:2022](https://www.iso.org/standard/27001): referencia para gestión de riesgos de información. El tema se guarda como preferencia no sensible y no se introducen tokens GitHub en cliente.
- [ISO 22301:2019](https://www.iso.org/standard/75106.html): continuidad del negocio; orienta BIA, objetivos de recuperación, planes, ejercicios y mejora.
- [ISO/IEC 42001:2023](https://www.iso.org/standard/42001): sistema de gestión de IA; orienta autoridad humana, riesgos, impactos, trazabilidad y mejora.
- [ISO/IEC/IEEE 29119-1:2022](https://www.iso.org/standard/81291.html): conceptos generales de pruebas; cada caso registra condición, estímulo y resultado observable.
- [Métricas DORA](https://dora.dev/guides/dora-metrics/): tiempo de entrega del cambio, frecuencia de despliegue, tiempo de recuperación de despliegue fallido, tasa de fallos de cambio y tasa de retrabajo de despliegue.
- [Standards for Educational and Psychological Testing](https://www.testingstandards.net/): evidencia de validez, confiabilidad, equidad y uso previsto de puntuaciones.

Estas normas se aplican como referencias metodológicas. Este documento no afirma certificación ni conformidad evaluada por un organismo acreditado.

DORA se refiere aquí a DevOps Research and Assessment: es un programa de investigación y mejora, no una certificación. El mapa de actividad administrativa y el conteo de commits no son métricas DORA. Para calcular las cinco métricas deben incorporarse eventos confiables de commit, despliegue, fallo, restauración y retrabajo por servicio y ambiente; esa integración queda pendiente. No se evalúa el reglamento financiero europeo que comparte el acrónimo.

Del mismo modo, los protocolos y sus 64 criterios de gobierno no verificados orientan el proceso; no son controles acreditados ni un instrumento psicológico validado. Una prueba de caja negra demuestra el comportamiento cubierto del software; no demuestra validez psicométrica, cumplimiento legal integral ni certificación ISO.

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

La especificación del release está en [PRUEBAS_CAJA_NEGRA_2.0.131.md](PRUEBAS_CAJA_NEGRA_2.0.131.md).
