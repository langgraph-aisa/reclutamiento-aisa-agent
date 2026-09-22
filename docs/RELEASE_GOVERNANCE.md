# Gobierno de release JARVI RH 2.0.203

## Identidad y fuente única

La versión vigente es **JARVI RH 2.0.203**. `package.json` es la fuente canónica y `shared/release.ts` expone la constante consumida por la interfaz y las pruebas. El pie del menú administrativo presenta producto, versión, rama, hash corto, sincronización con `origin/main` y distribución de lenguajes calculada durante cada build.

### Alcance candidato 2.0.203
El release **implementa el backend de almacenamiento en Google Drive**. Sin migración.

**La costura pasa a clave relativa.** `StorageBackend` deja de recibir rutas absolutas y opera sobre la misma clave que conserva la base —`<proyecto>/<uuid>`, `applications/<postulación>/<uuid>` y `inbox-files/<id>/<uuid>`—; el backend local resuelve la clave contra el volumen con validación de recorrido. Los métodos vigentes no cambian de firma.

**El backend de Drive.** `server/driveStorage.ts` resuelve cada clave contra la jerarquía `JARVI RH/<proyecto>/…` en el Drive del propietario, crea las carpetas intermedias, escribe con subida multipart o sobrescribe, lee, mide y borra, y declara la ausencia con el código `ENOENT` del sistema de archivos. El token de acceso se renueva desde el `refresh_token` (`refreshDriveAccessToken`). Todo el tráfico se inyecta para las pruebas.

**Sin migración.** El backend de Drive queda implementado y probado, aún sin activar por proyecto: la conmutación y las carpetas por candidato se cierran en la fase siguiente.

### Alcance candidato 2.0.202
El release **abre la custodia del RAG a Google Drive**. Sin migración ni cambio de comportamiento.

**La costura de almacenamiento.** `server/storageBackend.ts` define la interfaz `StorageBackend` —escribir, leer, borrar y medir— y el backend local con escritura atómica. Los métodos vigentes (`writeKnowledgeFile`, `readKnowledgeFile`, `writeInboxFile`, `readInboxFile`) despachan al backend activo por un único punto de conmutación, de modo que un backend de Drive pueda sustituir al volumen local sin tocar los más de cuarenta puntos de llamada.

**La conexión de Google Drive.** `server/driveConnection.ts` separa la credencial de plataforma —`oauth_client_id` y `oauth_client_secret`, administrada en Configuración y cifrada— de la conexión por usuario —el `refresh_token` que Google devuelve cuando la persona autoriza su Drive, cifrado bajo `refresh:<usuario>`—. El flujo OAuth usa el scope mínimo `drive.file`, estado firmado con caducidad, canje del código y revocación. La persona se autoriza a sí misma con un botón en «Mi cuenta» y puede desconectarse sin que la aplicación toque sus archivos.

**Sin migración.** Reutiliza `integration_settings` y el cifrado vigente.

### Alcance candidato 2.0.201
El release **publica el análisis de viabilidad de Google Drive como capa de custodia del RAG**. Es un release de gobierno y documentación: no toca el esquema ni cambia código.

**El defecto que motiva el análisis.** El catálogo del RAG vive en PostgreSQL y los binarios en el volumen local `KNOWLEDGE_STORAGE_DIR`. Una base restaurada sin su volumen deja filas válidas apuntando a binarios ausentes —el aviso «N de M documentos no están en el volumen»—, y el fallo de infraestructura se confunde con una ausencia del candidato. El documento [ANALISIS_RAG_GOOGLE_DRIVE_CUSTODIA.md](ANALISIS_RAG_GOOGLE_DRIVE_CUSTODIA.md) separa la ruptura en cuatro eslabones —durabilidad, transporte, visor y atribución—, valida el scope `drive.file`, propone una abstracción `StorageBackend` que conserva los métodos vigentes y declara el único punto que exige verificación empírica: la descarga con rango sobre `alt=media`.

**Sin migración ni cambio de código.** El alcance es de decisión y de documentación; la implementación, si se aprueba, se planifica por fases.

### Alcance candidato 2.0.200
El release **añade un segundo proveedor de IA con conmutación resiliente**. Ninguna capacidad toca el esquema.

**El defecto y su corrección.** El agente consumía OpenAI con dos credenciales del mismo proveedor. Esa rotación mitiga la caída de una credencial, pero no la del proveedor: si OpenAI no responde, el razonamiento de texto —evaluador, conversación, esencia del CV, RAG, editorial y reclutador— se detiene aunque DeepSeek, compatible con OpenAI en Chat Completions, esté disponible. La capa nueva en `server/agentProviders.ts` compone una cadena resiliente: el proveedor activo aporta sus dos credenciales —principal y respaldo— y, si ninguna responde, el secundario aporta las suyas. La observabilidad asienta proveedor y ranura en cada intento para distinguir la caída del proveedor de la de una credencial.

**Salida estructurada neutra.** OpenAI conserva la Responses API; DeepSeek usa Chat Completions con `response_format: json_object` y valida con el mismo esquema Zod, sin duplicar reglas. `deepseek-reasoner` no admite salida estructurada, de modo que la evaluación y las superficies con esquema se anclan a `deepseek-chat`.

**Límite declarado.** DeepSeek no expone Responses API, transcripción ni voz: las superficies de audio conservan la rotación de credenciales de OpenAI. La hoja administrativa incorpora el switch de proveedor activo —uno a la vez— y deja en gris las credenciales del proveedor inactivo, con verificación por proveedor y ranura.

**Sin migración.** Reutiliza `integration_settings` y el cifrado vigente.

### Alcance candidato 2.0.199
El release **vuelve estructural la idempotencia del envío**. Toca el esquema con una garantía, no con una columna.

**El defecto y su corrección.** La solicitud de CV salía dos veces al candidato porque confirmar el envío sobrescribía `message_key` —la clave local que sostiene el `INSERT ... ON CONFLICT (message_key) DO NOTHING`— con el identificador del proveedor. A partir de ahí el conflicto no podía encontrar nada, cada intento insertaba un asiento nuevo y el mensaje salía de nuevo. El efecto era visible para la persona —dos mensajes idénticos, en el mismo minuto— pero la causa era invisible: la protección se desactivaba en silencio. La corrección alcanzó los tres caminos de envío.

**Por qué una garantía y no sólo la corrección.** Ese defecto no falló por descuido de una función, sino porque la idempotencia dependía de que ningún código futuro escribiera una columna concreta. Una invariante que se apoya en la disciplina del que escriba el próximo `UPDATE` no es una invariante. La migración `0038` declara la clave local **inmutable** con un disparador: el `UPDATE` que intentaría cambiarla falla con su causa nombrada —código `23514`— en lugar de degradar el envío sin que nadie lo note. La referencia del proveedor pertenece a `provider_message_id`, que es donde se escribe.

**No intercepta ninguna escritura legítima.** Las tres políticas de conflicto vigentes —solicitud de CV, saludo del ciclo y reconciliación de la bandeja— usan `DO NOTHING`, de modo que ninguna actualiza la clave. La confirmación del envío —estado, referencia remota, marca de tiempo y metadatos— sigue escribiéndose sin obstáculo, y una prueba lo fija junto a la secuencia exacta del defecto.

**Migración `0038`, idempotente y expansiva.** Se incorpora al artefacto único de despliegue.

### Alcance candidato 2.0.198
El release **devuelve la verdad a las migraciones de prueba**. Ninguna capacidad del producto cambia.

**Fallo intermitente, y por tanto atribuido al azar.** La puerta de integración continua falló con `0023_conversation_service_split.sql: duplicate key value violates unique constraint "pg_authid_rolname_index"` acompañando a un cambio que no tenía relación con ella. Un fallo que aparece y desaparece no se diagnostica: se reintenta, y el reintento enseña a ignorar la puerta.

**La causa es una carrera de consulta-antes-de-actuar.** La migración comprueba `pg_roles` y después crea el rol, de modo que dos migradores simultáneos ven «no existe» los dos y el segundo viola el índice. El detalle que la vuelve inevitable es que **el rol es del clúster y no de la base**: las bases de prueba son distintas —una por archivo— y aun así compiten por el mismo nombre. `CREATE SCHEMA IF NOT EXISTS` tiene exactamente la misma forma.

**La defensa se elige por clase, no por caso.** Corregir la guarda de `0023` habría cerrado esa instancia y ninguna otra: la migración siguiente podría reintroducirla, y el fallo volvería a aparecer como una pérdida intermitente y ajena a su causa. El arnés serializa la aplicación de migraciones con un cerrojo consultivo del clúster, de modo que las bases se construyen de una en una mientras las pruebas siguen en paralelo. El cerrojo se toma en una conexión propia porque la liberación sólo alcanza a la sesión que lo tomó.

**El hecho se mide, no se supone.** `pnpm verify:migrations` ejecuta la guarda real con dos sesiones simultáneas y declara las dos mitades: sin cerrojo la carrera se reprodujo en **seis de diez rondas** con el error exacto de la puerta, y con cerrojo no se reprodujo ninguna. Una primera sonda que concurrentaba la creación de bases **no reprodujo la carrera**, porque el `CREATE DATABASE` previo escalona a los migradores: medir con ella habría dado un verde falso. La verificación declara además su propia falta de conclusión cuando no consigue reproducir el fallo, en lugar de darse por aprobada.

**Sin migración.** Cambia el arnés de pruebas y añade la verificación deliberada.

### Alcance candidato 2.0.197
El release **devuelve la identidad local al asiento y detiene el envío duplicado**. Ninguna capacidad toca el esquema.

**La protección de idempotencia se destruía al enviar.** El asiento de un mensaje saliente se crea con `INSERT … ON CONFLICT (message_key) DO NOTHING`, y su clave local es determinista —`cv_request:<postulación>` para la solicitud de CV—. Confirmar el envío reemplazaba esa clave por la del proveedor (`apichat:<huella>`), de modo que a partir del primer envío el asiento **ya no se reconocía**: un segundo intento —la confirmación del formulario y la automatización del ciclo, o dos invocaciones solapadas— no encontraba conflicto, insertaba un asiento nuevo y **el candidato recibía el mismo mensaje dos veces**.

**La clave de idempotencia es un hecho del artefacto.** La referencia del proveedor sirve para reconciliar el historial y para deduplicar entregas, y vive en su propia columna (`provider_message_id`); la clave local existe para que el asiento se reconozca a sí mismo entre intentos. Sobrescribir la segunda con la primera confunde dos identidades distintas —la del mensaje para el artefacto y la del mensaje para el proveedor— y deja la protección sin efecto en silencio, sin error y sin rastro.

**El defecto se había repetido en los tres caminos.** La corrección alcanza el buzón del agente, la entrega de la solicitud de CV y el envío de la bandeja: los tres confirmaban el envío reescribiendo la clave.

**Sin migración.** Reutiliza el esquema vigente.

### Alcance candidato 2.0.196
El release **devuelve la causa al fallo de red y prefiere el cifrado al descargar**. Ninguna capacidad toca el esquema.

**`network_error` era una palabra sin causa.** La guarda de descarga clasificaba cualquier excepción no tipada con un único enunciado —«La descarga del adjunto no pudo completarse»— y descartaba el motivo. Un puerto cerrado, un tiempo agotado, un nombre que no resuelve y un certificado rechazado compartían código, de modo que ante el fallo observado en la instancia el operador no podía saber si el problema era de red, de esquema o de certificado: la única acción posible era suponer. El motivo técnico —`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `DEPTH_ZERO_SELF_SIGNED_CERT` o el vencimiento del propio límite— se conserva y se publica. No transporta contenido del candidato: es la clasificación del fallo.

**Se prefiere TLS a la dirección sin cifrar.** El servidor de medios declara direcciones `http://` por IP, y muchos atienden también en 443. Intentar primero el mismo host por TLS consigue el archivo **con integridad de transporte** en lugar de renunciar a ella sin necesidad, que es exactamente lo que el expediente debe procurar. El orden importa y la caída de recurso está acotada: sólo se recurre a la dirección declarada cuando el intento cifrado **no pudo establecer la conexión**. Un rechazo del servidor —un 404, un peso excesivo— es una respuesta definitiva y no se repite, porque repetirla sin cifrado duplicaría la petición sin poder cambiar el desenlace.

**La integridad asentada es la observada, no la declarada.** El asiento de custodia deducía el esquema del texto de la dirección, de modo que una descarga que prosperó por TLS sobre una dirección `http://` quedaba registrada como «sin cifrado»: una afirmación falsa en el asiento que el evaluador humano usa para juzgar la evidencia. El esquema observado manda.

**Sin migración.** Reutiliza las tablas `0035` a `0037`.

### Alcance candidato 2.0.195
El release **corrige dos defectos de ingeniería del conducto de anuncios y devuelve el pase automático**. Ninguna capacidad toca el esquema.

**Una dirección se confundía con una carga.** `decodeRemoteAttachment` decidía el camino con `^https://`: toda cadena que no fuera HTTPS caía en la rama de base64 sin sobre, y esa rama acepta cualquier cosa que pase de sesenta y cuatro caracteres y supere la prueba de alfabeto. Una dirección `http://` con ruta larga satisface ambas —el alfabeto de base64 incluye letras, dígitos, `+`, `/` y `=`, y una ruta los contiene—, de modo que el receptor **decodificaba la dirección como si fuera el archivo** y escribía en el expediente un binario ilegible. El síntoma observado era el peor posible: no una pérdida declarada, sino un documento inservible con apariencia de documento. El esquema decide ahora el camino, y una dirección nunca se interpreta como contenido.

**La guarda de destino no nombraba su causa.** El rechazo por esquema, por puerto, por credenciales o por host no encaminable viajaba como un único enunciado genérico, y una dirección `http://` quedaba declarada como «contenido no resoluble»: el operador no podía distinguir una decisión de destino —que él puede revertir— de una carga ausente en el proveedor —que no depende de él—. El mensaje nombra ahora el esquema y la razón.

**La descarga sin cifrado se admite sólo por acto humano.** La recepción automática sigue exigiendo TLS: el expediente no puede acreditar la integridad de lo que viaja sin cifrar, y descargar por iniciativa propia cualquier dirección que llegue en un mensaje convertiría al receptor en un cliente de la red a merced del emisor. La carga manual —y sólo ella— admite `http://` público, porque una persona lo pidió sobre una dirección concreta y la procedencia queda asentada en la auditoría.

**El pase automático.** El cohete exige que alguien lo pulse, y hay expedientes que nadie revisa hasta que el candidato pregunta por su proceso. La apertura de la ficha dispara la misma operación a los veinte segundos si nadie la pidió antes. Tres condiciones lo sostienen bajo carga alta: el **alcance** es la postulación que se está leyendo —la carga no crece con el catálogo—, el **reclamo con ventana de silencio** descarta en la base los anuncios ya intentados —antes de abrir ninguna conexión hacia afuera, y apoyado en `audit_log_entity_idx`—, y el **tope del pase** acota cuántos anuncios procesa un pase, de modo que la latencia de una ficha no dependa de cuántos anuncios acumule. La re-evaluación del agente se dispara **una sola vez** al cierre del pase, no una por archivo.

**Sin migración.** Reutiliza las tablas `0035` a `0037`, el volumen y los índices vigentes.

### Alcance candidato 2.0.194
El release **devuelve la decisión al evaluador sobre los anuncios que el conducto no pudo resolver**. Ninguna capacidad toca el esquema.

**Una pérdida que el receptor no puede resolver y una persona sí.** Hay anuncios cuyo binario no existe y cuya procedencia sí: el proveedor notificó el adjunto como una dirección, y la guarda de descarga la rechaza cuando no es `https://` —no por descuido, sino porque el expediente no puede acreditar la integridad de lo que viaja sin cifrar—. Hasta aquí esa pérdida quedaba declarada y sin salida: el evaluador leía el motivo, veía el nombre del archivo y no tenía forma de traerlo.

**Carga manual, no descarga automática.** La operación es un acto humano explícito sobre una dirección concreta. Descargar por iniciativa propia cualquier dirección que llegue en un mensaje es exactamente lo que la guarda impide, y automatizarlo convertiría el receptor en un cliente de la red a merced del emisor. El cohete de la ficha ejecuta el **mismo conducto guardado** que la recepción: destino público verificado contra la misma lista de rangos no encaminables, sin credenciales, sin redirecciones fuera de guarda, tope de peso y verificación por contenido —la extensión, el tipo y la huella se reconstruyen del binario, nunca de lo declarado—.

**Traer el archivo no lo incorpora.** La política vigente sigue decidiendo, y un rechazo se declara con su remedio igual que en la recuperación de un binario conservado. La diferencia entre las dos vías es de dónde salió el documento, y esa diferencia se asienta: el expediente guarda la **procedencia** —la dirección declarada— junto al motivo anterior, de modo que el dictamen humano pueda acreditar de dónde vino la evidencia.

**Sin migración.** Reutiliza las tablas `0035` a `0037` y el volumen. Cuatro pruebas nuevas fijan el camino completo, la dirección sin TLS, el destino interno y el rechazo de política.

### Alcance candidato 2.0.193
El release **devuelve al evaluador la vista del archivo que originó el rechazo**. Ninguna capacidad toca el esquema y ninguna decisión de la recuperación cambia.

**La lista deja de ser un callejón sin salida.** La ficha declaraba el nombre del adjunto, su hora y su causa, pero no ofrecía forma de mirarlo: el reclutador leía «la extensión no está habilitada» sobre un archivo que no podía abrir, y tenía que decidir si habilitar la política sin haber visto lo que iba a incorporar. Ahora el nombre del adjunto **conservado** abre en una pestaña nueva el binario real, servido por la ruta autenticada del propio artefacto —la misma que ya usa la conversación del candidato—, de modo que la revisión del documento y la decisión sobre la política ocurren sobre la misma evidencia.

**El anuncio sin contenido publica su procedencia, no su contenido.** Cuando el conducto no pudo resolver la carga, el binario no existe, pero el proveedor **sí declaró** de dónde venía. El contrato admite direcciones `http://` que la guarda de descarga no acepta por esquema, y ésa es una pérdida del receptor que una persona puede mirar: la dirección declarada se lee del asiento de recepción y se publica como enlace a la procedencia. Nunca se publica un sobre `data:` —sería ofrecer un archivo vacío con apariencia de documento— ni una cadena de contenido cualquiera.

**El enlace se acota al destino público.** Se admiten únicamente `http` y `https`, se descartan los nombres de host internos y las direcciones literales que no son unicast públicas, con la misma guarda que aplica el transporte a la descarga. Un enlace del panel administrativo lo pulsa una persona y no puede convertir su navegador en un sondeo de la red privada. Cuando la pérdida no tiene ni binario ni dirección declarada, la sentencia lo dice: no hay archivo que abrir.

**Sin migración.** Reutiliza las tablas `0035` a `0037` y una prueba nueva fija el contrato de la dirección publicable.

### Alcance candidato 2.0.192
El release **devuelve el nombre a la causa perdida y retira de la conversación dos afirmaciones que no eran ciertas**. Ninguna capacidad toca el esquema.

**La causa del exceso de peso se perdía en el nombre de la excepción.** La ruta inline —la carga viaja en el cuerpo, sin sobre `data:`, que es la forma real que envía el proveedor— lanzaba `Error` sin tipar en sus guardas de tamaño y de codificación. El asiento de recepción se clasifica con `receiptFailureReason`, que para una excepción sin código cae en `error.name`: la cadena «Error», la misma palabra para cualquier fallo. El efecto observado en la instancia es una pérdida **permanente** declarada como «Error», indistinguible y sin remedio nombrado, y el candidato aparece sin el documento que sí envió. Las guardas declaran ahora su código propio —`content_too_large` para el exceso de recepción, `payload_invalid` para la codificación ilegible, `empty_content` para la carga vacía—, de modo que el fallo se declara con su causa y su naturaleza, y una causa permanente se asienta de inmediato en lugar de agotar ocho intentos durante veintiún minutos.

**`content_too_large` no es `size_limit`.** El segundo es un veredicto de la política de conocimiento y deja el binario conservado, así que la recuperación lo incorpora cuando el límite se eleva. El primero es el límite de recepción del conducto: el contenido se descartó antes de escribirse y **no hay binario**. Confundirlos sería prometer una incorporación imposible, que es exactamente el defecto que este release corrige.

**La conversación afirmaba una conservación que no ocurrió.** Las dos superficies donde se lee un adjunto —la bandeja general y la conversación del candidato— mostraban una sentencia fija para todo desenlace `rejected`: «Archivo conservado en la bandeja; aún no incorporado al expediente por su formato o peso. La incorporación se ejecuta desde el RAG Personal del candidato y no exige un envío nuevo». Para las causas sin binario esa frase era falsa en sus dos mitades —no hay nada conservado y no hay incorporación que ejecutar—, y para las causas de política no nombraba el motivo ni el remedio: el reclutador podía pulsar la incorporación indefinidamente sin saber que el obstáculo estaba en la configuración. Ahora la sentencia procede del catálogo compartido —el mismo que lee el expediente— y sólo añade la promesa de incorporación cuando la causa efectivamente conserva el binario. El campo `media_processing_reason` ya viajaba en la respuesta de la bandeja y no lo consumía ninguna superficie.

**Sin migración.** Cuatro pruebas nuevas fijan el contrato tipado del transporte y su clasificación.

### Alcance candidato 2.0.191
El release **corrige el alcance del adjunto conservado y devuelve al conducto la entrega diferida**, cerrando los dos únicos eslabones que 2.0.188 dejó prometiendo más de lo que el hecho sostenía. Ninguna capacidad toca el esquema ni altera el comportamiento verificado de la recuperación.

**«Conservado» es una afirmación sobre el volumen, no sobre el mensaje.** La lista que la ficha ofrecía bajo «Adjuntos conservados fuera del expediente» se componía con una condición que admitía la clave de almacenamiento **vacía**, y el conducto escribe exactamente eso cuando la carga no llegó (`storageKey: ''` en la rama de rechazo de `apiChatWebhook.ts`). El conjunto incluía, por tanto, anuncios cuyo contenido nunca arribó —`payload_missing` y `content_unresolved`, los cuatro casos observados en la instancia el 19 de septiembre de 2026—, de modo que la ficha los presentaba como recuperables mientras la lectura institucional del propio artefacto declaraba, para esos mismos códigos, que **no hay binario conservado**. Dos superficies autorizadas afirmaban lo contrario sobre el mismo hecho y la operación respondía `binary_missing` sin causa declarada. La condición exige ahora una referencia no vacía, con lo que el alcance de la operación coincide con lo que la política administrativa dejó fuera y el volumen todavía conserva.

**La ausencia se declara donde corresponde.** Lo que se retira de la lista de conservados no desaparece de la ficha: se declara aparte, con el código que el conducto asentó y con la sentencia que **nombra la causa y el remedio**. El catálogo que redacta esa sentencia existía desde 2.0.188 y no lo consumía ninguna superficie; ahora lo comparten la bandeja y la ficha, de modo que el reclutador distinga «la política lo dejó fuera y es recuperable» de «el proveedor no lo entregó y exige un envío nuevo», que exigen acciones distintas.

**La entrega diferida vuelve a ser posible.** La identidad de un recibo la fija el proveedor —alcance, teléfono y mensaje—, así que la reentrega del **mismo** mensaje se descartaba como repetición. Un anuncio sin carga que después llegaba con su contenido quedaba `dead` para siempre: el expediente esperaba un binario que el sistema ya estaba recibiendo y descartando. El recibo difunto se rearma cuando el proveedor reentrega esa identidad **con una carga distinta**, y sólo entonces: el rearme se acota a su causa con dos condiciones conjuntas —ningún desenlace vivo se reabre y la huella de la carga cambió—, de modo que un proveedor que repita el mismo anuncio no genera trabajo. Recibida la carga, el camino ya verificado en 2.0.188 hace el resto: el binario entra al expediente, se analiza y el agente evaluador vuelve a dictaminar.

**Sin migración.** Reutiliza las tablas `0035` a `0037` y el volumen de la bandeja. Tres casos nuevos sobre PostgreSQL real fijan el alcance del conjunto conservado, la declaración del anunciado sin contenido y el rearme acotado del recibo difunto.

### Alcance candidato 2.0.190
El release **vuelve la señalización del expediente un vocabulario compartido** y la lleva a las hojas donde el reclutador decide. Ninguna capacidad toca el esquema.

**La señal se deriva una sola vez.** La ficha de Candidatos ya declaraba la revisión humana con un sello rosa, pero esa lectura vivía en su propia consulta: la Bandeja de entrada no la tenía y el evaluador no podía reconocer, sin abrir la ficha, qué conversación correspondía a un expediente ya dictaminado. Ahora la procedencia se declara en un solo lugar del servidor —`server/expedienteSignal.ts`— y la consumen la bandeja y la ficha, de modo que las dos hojas afirmen el mismo hecho. Si cada consulta inventara su propia procedencia, la interfaz mostraría señales distintas para el mismo expediente y la señalización dejaría de ser una prueba.

**La revisión humana es un asiento, no una fecha de escritura.** Su fuente es `audit_log` con actor identificado: una escritura del agente, del sincronizador o de la recuperación automática no acredita que una persona haya revisado el expediente. La distinción no es formal —determina si el sello puede leerse como dictamen—, y por eso la consulta exige `actor_user_id IS NOT NULL` y un vocabulario acotado de acciones.

**El cambio posterior invalida el sello como cierre.** Un expediente revisado que después recibe un adjunto recuperado, un documento incorporado, un análisis actualizado o una nueva pasada del agente evaluador ya no está cubierto por el dictamen anterior. La señal lo declara —con su verbo, su hora y su fecha institucionales— en lugar de dejar creer que el sello sigue vigente, y añade un aviso explícito de cambios tras la revisión para que el reclutador vuelva a mirar la evidencia antes de dictaminar.

**Dónde aparece.** En la Bandeja de entrada, en la fila de cada conversación de «Últimas conversaciones» y en el pie de la caja de conversación, para que el evaluador tenga presente el estado del expediente en el momento en que lee y responde. En la ficha del candidato, en el encabezado —junto al punteo, del que es su fecha de validez— y en la matriz de evaluación IA, donde el reclutador lee la evidencia que funda el dictamen.

**Sin migración.** Reutiliza las tablas `0035` a `0037` y `audit_log`. Tres pruebas nuevas fijan el contrato sobre PostgreSQL real y cinco casos de caja negra —`BN-SENAL-01` a `BN-SENAL-05`— fijan que la señal llegue a las tres hojas con una sola procedencia.

### Alcance candidato 2.0.188
El release **convierte el rechazo del adjunto en una decisión reversible y devuelve la evidencia al agente**, cerrando la cadena que 2.0.187 dejó abierta en su último eslabón. Tres capacidades —recuperación documental, lectura institucional del desenlace y acuse del expediente— y ninguna toca el esquema.

**El rechazo de política deja de ser terminal.** La política de conocimiento se aplicaba una sola vez, en el instante de la recepción, y su veredicto era definitivo: el proveedor entregaba el PDF, el receptor lo decodificaba, lo escribía en el volumen de la bandeja y **después** lo rechazaba porque la extensión no estaba habilitada o el peso superaba el máximo. A partir de ahí el mensaje declaraba `processingOutcome='rejected'` para siempre, el recibo se cerraba con su carga ya borrada y **ninguna operación del sistema volvía sobre esa decisión**. El candidato aparecía sin evidencia documental y el evaluador recibía la frase «no incorporado al análisis» como si describiera al candidato y no a una configuración administrativa. Ahora la recepción y el ingreso son dos hechos distintos: mientras el binario exista, la incorporación se reintenta sin exigir al candidato un envío nuevo. La recuperación lee el binario conservado, reconstruye por contenido su extensión, tipo y huella —nunca confía en lo declarado por el emisor—, lo publica en el expediente con el mismo análisis del RAG personal, vuelve a ejecutar el agente evaluador con la evidencia nueva y **corrige el asiento**: el mensaje deja de declarar una exclusión superada, porque una creencia falsa en la bandeja seguiría afirmando lo que el expediente ya desmiente.

**El desenlace se tipa y se lee.** La bandeja declaraba un solo enunciado para cuatro causas distintas con cuatro remedios distintos —la extensión no está habilitada, el peso supera el máximo, el proveedor anunció el archivo sin su contenido o la lectura del formato falló—, de modo que la única acción posible era suponer. Ahora el código tipado que el conducto ya escribía se traduce a una sentencia que **declara la causa y el remedio**, y esa lectura se comparte entre la bandeja, la ficha del candidato y el expediente para que las tres superficies afirmen lo mismo. La distinción que el texto conserva es deliberada: **recibido no es incorporado**, e **incorporable no es interpretado**. Un rechazo de política conserva el binario y admite incorporación; una ausencia de contenido en el proveedor no la admite y exige un envío nuevo.

**El expediente se acusa una sola vez.** El agradecimiento y el aviso de contacto declarados en «Evaluación de CV con IA» se enviaban como parte del ciclo de la solicitud, pero no existía una operación que los emitiera cuando el expediente se completaba por otra vía. Ahora el acuse se compone con la misma función que el cierre de la solicitud —para que no existan dos redacciones del agradecimiento— y se envía por el camino humano de la bandeja: la conversación con el candidato es una superficie con control humano y el sistema no escribe al candidato sin que alguien sostenga el teclado. La idempotencia se asienta en la auditoría y no en la clave del mensaje, porque el envío humano sobrescribe esa clave con el identificador del proveedor.

**Sin migración.** Las tres capacidades reutilizan las tablas `0035` a `0037` y el volumen de la bandeja. Doce pruebas nuevas fijan la incorporación, el análisis, la re-evaluación del agente, la detección por huella, la ausencia de binario y la idempotencia del acuse.

### Alcance candidato 2.0.189
El release **publica el análisis fenomenológico, ontológico y epistémico del fallo del adjunto conservado** y lo enlaza desde el gobierno, de modo que la recuperación entregada en 2.0.188 quede fundada, declarada y refutable. Ninguna capacidad toca el esquema.

**El fallo se lee y se declara.** El documento [ANALISIS_RECUPERACION_ADJUNTO_2.0.188.md](ANALISIS_RECUPERACION_ADJUNTO_2.0.188.md) fija lo que aparecía —un enunciado único para cuatro causas, ofrecido como cierre y por tanto indistinguible de una decisión—, separa los dos hechos que el conducto confundía —la entrega del proveedor es un hecho del mundo; la admisión del expediente es un veredicto de la configuración—, declara que el déficit del agente evaluador fue de conocimiento y no de razonamiento, y restituye la refutabilidad: el visor entrega el documento con vale firmado y el evaluador humano lee la misma base que leyó el agente, de modo que su dictamen prevalece sobre un fundamento verificable.

**Sin migración.** Es un release de gobierno y de documentación; reutiliza las tablas `0035` a `0037` y el volumen de la bandeja. Cuatro casos nuevos de caja negra —`BN-ANALISIS-01` a `BN-ANALISIS-04`— fijan que la secuencia declarada coincida con las operaciones observables.

### Alcance candidato 2.0.187
El release **lleva la pregunta del artefacto a la frontera donde está la causa**: la configuración efectiva del proveedor. Cinco capacidades —diagnóstico, conformidad del contrato, evidencia simétrica y recuperación— y ninguna toca el esquema.

**La configuración efectiva se lee, se declara y se corrige.** La pérdida del PDF quedó demostrada con tres observaciones independientes —el panel del proveedor, la traza del cuerpo y la aritmética de sus bytes— como un **descriptor sin carga**: `url` vale `data:<tipo>;base64` y ningún campo del cuerpo lleva contenido. El artefacto dependía entonces de una capacidad que se configura fuera de él, y su ausencia era invisible. El contrato expone la lectura de esa configuración y la notificación de cuenta declara el modo de notificación de adjuntos y el formato de aviso, de modo que el artefacto **sabe** si el proveedor entrega la carga o sólo su descriptor, en lugar de presuponerlo. La Auditoría de ApiChat publica el veredicto con su consecuencia operativa y la administración puede corregir el modo de notificación desde el panel, con asiento de auditoría propio, sin conservar credencial alguna.

**El descriptor sin carga se mide en lugar de suponerse.** El contrato ejemplifica la dirección de medios en los tres esquemas de recepción —`{url}/media/{clientId}/file.pdf`, `…/audio.ogg`, `…/image.png`—, y si esa forma se cumpliera también bajo la notificación en base64 el archivo anunciado sería recuperable sin pedirle nada al candidato. Queda una hipótesis y no una conclusión, de modo que el artefacto la **mide**: la base de medios se declara desde la administración, cada dirección candidata declara su procedencia, se intenta una sola vez por candidata y el asiento conserva el host y la procedencia, nunca el identificador de cliente. Un fracaso **refuta la hipótesis con evidencia** y la pérdida se declara con su causa propia: es la diferencia entre medir y suponer.

**El adaptador se conforma al vocabulario del contrato.** El registro del historial envuelve el mismo esquema de mensaje que el callback, y el cuerpo observado usa campos que el adaptador no leía. El artefacto acoge ahora el teléfono de quien escribe como respaldo del destinatario declarado —nunca en su sustitución—, la identidad del registro histórico como respaldo del identificador y el contenido de los mensajes de publicación. Excluye deliberadamente el nombre del contacto y la miniatura: leerlos como carga confundiría el rótulo con el archivo. Y **guarda los sobres que no son mensajes** —los eventos y las actualizaciones de conversación son notificaciones distintas por contrato—, porque un acuse comparte el vocabulario de identidad de un mensaje y sin la guarda se leería como una pérdida. Las pruebas de conformidad se transcriben de los ejemplos oficiales en lugar de derivarse del propio adaptador, que era la circularidad que ocultaba la divergencia.

**Una pérdida deja el mismo asiento en las dos superficies.** El receptor asentaba un adjunto rechazado cuando el contenido faltaba por completo, pero una carga presente e irresoluble lanzaba su excepción antes de escribir la fila: el reclutador, que lee la bandeja, veía silencio, mientras la cola conservaba un recibo agotado. Ahora toda pérdida del adjunto —ausencia, carga irresoluble, destino inseguro o peso excedido— escribe el mismo asiento con su motivo tipado, y un adjunto rechazado deja de confundirse con un duplicado: es el mismo mensaje del proveedor con su carga todavía sin resolver, de modo que su estado puede avanzar cuando la causa se corrige.

**Lo recibido y no convertido puede recuperarse.** La recuperación devuelve a la cola las notificaciones agotadas de una ventana declarada y rebobina el cursor del historial, con presupuesto de intentos y asiento de auditoría, de modo que lo que el proveedor ya entregó y el artefacto no pudo convertir se reprocesa **sin exigir al candidato un envío nuevo**. El diagnóstico del conducto deja de declarar «sin pendientes» con un rechazo de ingreso a la vista: los adjuntos recibidos y rechazados en el ingreso se publican con su motivo y estado propio, y las notificaciones de estado y de conversación dejan de contarse como pérdida. La distinción es la del propio análisis: recepción e ingreso son hechos distintos.

**Se preserva el instrumento forense.** La traza del conducto se declara en el esquema de Drizzle, de modo que una reconciliación de la base no pueda borrar la única evidencia de la forma del cuerpo que envía el proveedor.

**Sin migración.** Las cinco capacidades son de lectura, de conformidad y de recuperación; reutilizan las tablas `0035` a `0037`. Treinta y cuatro pruebas nuevas —diecinueve de conformidad del contrato, seis de recuperación y nueve sobre las superficies existentes— fijan el vocabulario, la guarda de sobres, la simetría del asiento y el reproceso.

### Alcance candidato 2.0.186
El release **hace decidible un reproceso y nombra la ausencia de contenido**, cerrando la clasificación de fallos que el conducto dejaba a medias. Una capacidad de diagnóstico y ninguna de transporte; no toca el esquema.

**El asiento de recepción declara la causa y su naturaleza.** La cola distinguía «no llegó» de «llegó y murió», pero conservaba el nombre de la clase de excepción, de modo que la superficie de auditoría mostraba la misma palabra para un destino ausente, una dirección expirada y una base de datos caída, y la columna de desenlace quedaba vacía. Ahora un clasificador declara el motivo tipado: los fallos del transporte conservan su código con su condición de reintento, un chat sin conversación se asienta como `sin_destinatario` con una ventana corta, un fallo de PostgreSQL se asienta como `base_de_datos:<SQLSTATE>` y la columna de desenlace deja de quedar vacía. La superficie de auditoría puede decidir si conviene reprocesar o corregir la configuración sin leer el código.

**Lo permanente no ocupa la cola.** Un fallo declarado permanente se clasificaba igual que uno transitorio y consumía ocho intentos —veintiún minutos— sobre una causa que no va a cambiar. Ahora lo permanente agota de inmediato, salvo el destino ausente, que calcula su propia condición por intento y agota en tres para no retener mensajes de números ajenos al reclutamiento.

**La ausencia de contenido se nombra.** El contrato declara `url` como «URL del contenido o archivo codificado en base64 con su tipo». Cuando el sobre llega sin la codificación, el transporte lo declaraba como una excepción genérica; ahora se asienta `payload_missing:permanente`, y una carga que no se decodifica como `payload_invalid:permanente`. Son los dos desenlaces del adjunto anunciado sin contenido, y cada uno tiene un nombre.

**Sin migración.** Es una clasificación de fallos, no un cambio de esquema. Nueve pruebas nuevas fijan la clasificación.

### Alcance candidato 2.0.185
El release **lleva al panel las dos variables que el artefacto necesita para recibir y para entregar**, con el mismo tratamiento que ya reciben las demás credenciales. Una capacidad de superficie y una de ejecución, y ninguna toca el esquema.

**La credencial entrante del webhook se declara en el panel.** La ruta de recepción exigía una variable de entorno del despliegue, de modo que rotarla obligaba a reconstruir la imagen y su valor no participaba del cifrado ni del enmascarado que protege a las demás credenciales. Pasa a ser una cajilla más, con la misma raíz de cifrado AES-256-GCM, la misma máscara de confirmación, el mismo registro de auditoría al rotarla y el mismo botón de retirada. La ruta la resuelve en cada petición: **lo declarado en el artefacto tiene precedencia y la variable de entorno queda como respaldo**, de manera que una instalación que ya la definiera en el despliegue sigue operando sin cambios y ninguna credencial queda expuesta en un archivo de configuración.

**La dirección pública de los archivos salientes se declara en el panel.** El proveedor debe descargar los documentos que la bandeja envía, y esa base se deducía del encabezado del proxy inverso con la variable de entorno como respaldo. Ahora la institución puede declararla desde la interfaz: **la dirección declarada manda sobre el encabezado** y, si se retira, la base vuelve a deducirse del proxy. Se valida como dirección absoluta con TLS y sin parámetros ni fragmentos, y se guarda en claro porque no es un secreto: enmascararla impediría al operador comprobar cuál está vigente sin retirarla y volverla a escribir.

**Sin migración.** Ambas viven en la configuración de integración que ya existía; la credencial se cifra con su contexto de proveedor y clave, y la dirección se almacena como valor de operación. Diez pruebas nuevas fijan la precedencia, el respaldo, el enmascarado y el rechazo de direcciones inválidas.

### Alcance candidato 2.0.184
El release **hace que el peso del archivo deje de agotar los reintentos y que un recibo agotado diga por qué murió**. Dos precisiones sobre el conducto del adjunto, y ninguna toca el esquema.

**La descarga dispone de dos minutos.** El receptor invocaba la descarga con la ventana por omisión de veinte segundos mientras admitía archivos de hasta treinta megabytes: eso exige doce megabits sostenidos hasta el proveedor, de modo que un enlace modesto consumía los ocho intentos y dejaba la notificación en `dead` sin que el archivo tuviera defecto alguno. La ventana pasa a dos minutos, que admiten enlaces de dos megabits sin dejar de acotar el cuelgue. Cuando la carga viaja en base64 —la representación que el panel declara— no hay descarga y el cambio no interviene.

**El trabajo documental reclama quince minutos.** El peor caso legítimo es el reconocimiento óptico de veinte páginas, la transcripción de una nota de voz y el análisis del texto extraído. Con un reclamo de ocho minutos, un expediente lento podía ser reclamado por un segundo trabajador mientras el primero seguía trabajando; el bloqueo por asesoría impedía el análisis duplicado, de modo que no había corrupción, pero sí demora y un intento consumido de más.

**Un recibo agotado declara su causa y su naturaleza.** El transporte ya clasificaba cada fallo con un código —destino no permitido, error de respuesta, fallo de red, peso excedido, contenido vacío o contenido no resoluble— y calculaba si era reintentable, pero el asiento de recepción conservaba únicamente el nombre de la clase de error. El operador leía `AttachmentTransportError` y no podía distinguir una dirección expirada de un destino prohibido. Ahora el asiento conserva el código con su condición de reintento, y el contenido que no puede resolverse recibe un código propio en lugar de una excepción genérica. La reproducción del expediente lo mide: destino no permitido declara `unsafe_destination:permanente`, un fallo de red declara `network_error:reintentable` y un contenido irresoluble declara `content_unresolved:permanente`.

**Sin migración.** Las tres precisiones son de comportamiento y de diagnóstico; reutilizan las tablas `0036` y `0037` y no añaden esquema. **La política de reintentos no se altera**: el asiento declara si el fallo es permanente, pero el número de intentos sigue siendo el mismo hasta observar la cola en producción. Compilación estricta en cero errores, ciento cincuenta y tres pruebas unitarias y diecisiete de caja negra HTTP/PostgreSQL en verde.

### Alcance candidato 2.0.183
El release **reordena la matriz de Candidatos y hace visible la revisión humana ya guardada**. Dos capacidades y una precisión, y ninguna toca el esquema.

**La identidad se fija y encabeza; la evaluación sigue.** El orden de lectura pasa a ser Candidato / plaza, Evaluación IA, Motivo, Comentario humano, Estado / acción e Ingreso, y el teléfono con las respuestas queda después. La columna fija es la identidad, como en el diseño original: el evaluador no pierde de vista a quién pertenece la fila mientras se desplaza en horizontal, y el dictamen queda inmediatamente a su derecha, que es el orden que la hoja declara. Una corrección intermedia fijó la evaluación y desplazó la identidad al final; el efecto era peor que el defecto original, porque la fila dejaba de tener nombre visible y la columna aparecía cortada en el borde del panel.

**Un filtro configurado ordena por la mejor calificación.** Sin filtro la hoja es un registro y se lee por fecha de ingreso. Con filtro es una lista de trabajo, de modo que aplicar cualquiera de los seis filtros devuelve el orden a «Evaluación IA» descendente y el evaluador ve primero a quien mejor puntuó. Retirar todos los filtros devuelve el registro a su fecha, porque entonces vuelve a ser un registro.

**El sello de la revisión humana.** Cuando una persona guarda una revisión, la matriz muestra un botón rosa con la hora y la fecha de ese guardado —«Revisión Humana (16:45) 18 SEP 2026»— para que el evaluador distinga de un vistazo lo ya revisado de lo pendiente. Su fuente es el asiento de auditoría de la revisión: actor identificado y acción `status_changed` o `comment_added`. Esa precisión es el punto entero de la capacidad. Una escritura del agente evaluador, del sincronizador de mensajería o de la bandeja no acredita que una persona haya abierto el expediente, y presentarla como revisión humana haría creer lo contrario. La hora se presenta en la zona horaria de la institución, no en la del navegador que consulta.

**Sin migración.** La matriz ya recibía el punteo y el estado, y el sello se deriva del asiento que la revisión humana ya escribía en `audit_log`. El orden por la fecha del sello queda disponible en el contrato de la lectura sin añadir esquema, y los expedientes no revisados se ordenan al final en lugar de hundirse por su valor nulo.

### Alcance candidato 2.0.182
El release **cierra la continuidad entre recibir el adjunto, mostrarlo y usarlo como evidencia**. Repara los cuatro residuos que la entrega anterior dejó fuera de su alcance, y ninguno era un defecto de lógica: los tres primeros pertenecen al ciclo de vida de los trabajadores y el cuarto a la provisión del despliegue, que es exactamente donde una suite verde no alcanza a mirar.

**La cola durable deja de ser un punto ciego.** `apichat_inbound_receipts` y `candidate_document_jobs` ya existían y guardaban cada notificación y cada trabajo, pero ninguna superficie las leía. Un operador no podía distinguir «no llegó» de «llegó y murió», ni ver el motivo del último intento, de modo que el síntoma «no procesa» era indistinguible de la conducta del candidato. La Auditoría de ApiChat publica ahora el conducto del adjunto: el veredicto informa el **eslabón más temprano con evidencia** —recepción, registro, derivación o evaluación—, la tabla de notificaciones declara vía, estado, intentos y motivo, y la de trabajos declara archivo, formato, intento y código de error. La precedencia sigue la cadena causal porque atribuir el resultado a un eslabón posterior cuando otro anterior ya falló sería una conclusión inadmisible.

**Una sola fuente autoritativa para el hecho «qué recibió el candidato».** La bandeja leía `candidate_attachments`, una tabla que **ningún componente del artefacto escribía**; el motor conversacional leía la unión del expediente documental y del mensaje. La consecuencia era una contradicción interna: la ficha declaraba cero adjuntos justo cuando el agente veía el archivo. Ambas superficies consumen ahora el mismo manifiesto, y un rechazo explícito —extensión fuera de política, peso excedido, contenido no disponible— viaja con su motivo en lugar de degradarse a silencio.

**La extracción documental pertenece al proceso, no al interruptor del diálogo.** El trabajador que extrae texto, transcribe voz y aplica reconocimiento óptico arrancaba dentro de `onStart`, que solo se ejecuta si la capacidad de razonamiento está encendida. Apagar el agente en el panel detenía la interpretación de PDF, audio e imagen mientras el receptor seguía aceptándolos y persistiéndolos: los archivos quedaban recibidos y sin analizar sin que ninguna capa lo declarara. El arranque de proceso precede ahora al de la capacidad y no depende de él.

**El volumen se declara.** El catálogo de adjuntos vive en PostgreSQL y los bytes en el directorio de almacenamiento: son dos almacenes que no comparten transacción. Sin volumen declarado, cada contenedor escribe en su propia capa, y en modo dividido el servicio que lee responde `storage_missing` sobre un documento que sí existe. La imagen declara el volumen de conocimiento y su comentario fija la condición del despliegue dividido: los servicios de recepción y de razonamiento requieren el **mismo** volumen con nombre.

**La incógnita no se convierte en cero.** Cuando una de las fuentes falla, el veredicto declara la observación no disponible y advierte que los contadores son parciales; nunca resume la lectura fallida como ausencia de adjuntos. Sin migración: reutiliza las tablas `0036` y `0037` y no añade esquema.

**El incremento deja de desplazar un rótulo histórico.** El incremento avanzaba también la versión del encabezado de fuentes primarias vigente y atribuía a esta entrega dos recursos que entraron en la anterior. El script preserva ahora esas líneas junto con los encabezados y párrafos de alcance, y el rótulo vuelve a su entrega original.

### Alcance candidato 2.0.181
El release **adjunta contenido desde la bandeja sin pegar direcciones**. El diálogo «Enviar archivo» acepta un archivo arrastrado o elegido del equipo; el de «Enviar nota de voz» graba con el micrófono del dispositivo; y el de «Enviar ubicación» toma la posición del navegador. En los tres casos el contenido viaja al servidor en base64, se verifica por su contenido y se publica con una capacidad firmada antes de anunciarlo al proveedor.

**El archivo se elige, no se pega.** La zona de arrastre y el selector del equipo sustituyen a la URL manual: el operador adjunta el documento completo y el servidor lo escribe en el volumen, le reconstruye el nombre y lo sirve al proveedor por una ruta firmada de corta vigencia. Se rechaza lo que supera veinte megabytes con su límite declarado.

**La nota de voz se graba.** El navegador captura el audio con `MediaRecorder`, lo deja reproducir antes de enviarlo y el servidor lo decodifica con el mismo transporte canónico que los documentos, lo almacena y lo anuncia como nota de voz. Si el micrófono no está disponible, se informa sin enviar nada.

**La ubicación se comparte.** El botón «Usar mi ubicación actual» completa la latitud y la longitud con la posición del dispositivo y las deja editables: el dato capturado no se pierde y puede corregirse antes de enviarlo.

**La base pública se resuelve del proxy.** El servidor construye la dirección que el proveedor debe descargar a partir de `x-forwarded-host` y `x-forwarded-proto`, con anulación explícita por `APICHAT_PUBLIC_BASE_URL`. Si no puede resolverla, el envío se detiene con su causa registrada en lugar de anunciar una dirección inalcanzable.

**Sin migración.** Reutiliza el volumen de almacenamiento y las tablas vigentes; el artefacto único de despliegue permanece en las migraciones `0022` a `0037` con treinta y tres controles.

### Alcance candidato 2.0.180
El release **repara el transporte de adjuntos por ApiChat** —PDF, Word, audio e imágenes— entre el WhatsApp del candidato y la bandeja, y de la bandeja de vuelta al WhatsApp.

**Un solo adaptador del contrato.** El callback publicado por ApiChat entrega `messages[]`; el receptor anterior esperaba un mensaje individual y podía descartar el lote respondiendo HTTP 200. A partir de esta entrega, `normalizeApiChatBatch` desenvuelve el sobre configurado, valida cada elemento y conserva las posiciones inválidas: un elemento defectuoso no elimina los válidos del mismo lote. El sondeo del historial reutiliza el mismo normalizador y pagina con cursor durable, en lugar de una ventana fija de cincuenta.

**Recepción durable antes del acuse.** El webhook confirma HTTP 200 solo después de conservar el lote en PostgreSQL (`apichat_inbound_receipts`). Si la base no está disponible responde 503. Un trabajador con reclamo atómico y lease procesa después: el acuse significa conservación, no análisis. Un fallo transitorio conserva la carga y se recupera sin duplicar, porque la clave de recepción es única y la clave de almacenamiento es determinista.

**Una identidad común de adjunto.** Bandeja, expediente documental y motores leen el mismo estado: el mensaje guarda la referencia al documento (`candidate_file_id`) y la bandeja proyecta la clave de almacenamiento, el nombre y el estado de procesamiento. Un archivo pendiente ya no se presenta como «no enviado»: «recibido» no significa «interpretado ni identificado como CV».

**Interpretación gobernada por capacidad instalada.** PDF y DOCX producen texto; DOC usa `antiword`; los PDF e imágenes sin texto usan OCR (`pdftoppm`/`tesseract`) gobernado por interruptor; los audios se transcriben y su transcripción se vincula al original. Cada formato anuncia solo la capacidad efectiva instalada y probada. Las migraciones `0036` y `0037` añaden la recepción durable, el cursor del historial y la cola de procesamiento documental con su estado.

**Dirección y observabilidad veraces.** Se preserva la dirección `from_me` del contrato y los identificadores de grupo nunca se convierten en el teléfono de una persona. La observabilidad distingue «no disponible» y «sin trazas» de cero, y el veredicto de la traza separa lo que el proveedor envió de lo que el receptor descartó.

### Alcance candidato 2.0.179
El release **fija el orden de lectura de la ficha de Revisión Humana**: encabezado de identidad, **feed de WhatsApp** de la persona, detalle de la postulación con la matriz de evaluación, **agente del reclutador** y **RAG Personal** al cierre.

**Cada superficie ocupa su lugar y no un bloque común.** Hasta 2.0.178 la conversación y el RAG Personal compartían una misma sección de dos columnas al pie de la hoja. Ahora el feed de WhatsApp se lee inmediatamente después del encabezado, porque es el contexto de la persona antes de juzgar su matriz, y el RAG Personal cierra la hoja, porque es el conocimiento que la conversación y el agente alimentan.

**Una sola lectura, dos superficies.** El módulo de evidencia conserva una única consulta del estado conversacional y la ofrece a las dos superficies con la misma clave: React Query resuelve una sola petición y ambas se suscriben a ella, de modo que separarlas no duplica el sondeo ni el trabajo del servidor. Esta propiedad es observable —una sola petición para las dos superficies— y por eso se declara.

**El orden es un contrato verificable.** La puerta de release audita la secuencia de las cinco superficies en la hoja; reordenarlas sin actualizar la capacidad declarada detiene el release.

**Sin cambio de conducta en lo ya entregado.** La grilla de lectura de 2.0.178 conserva sus cinco barras plegadas y la auditoría del canal de ApiChat de 2.0.177 queda intacta.

**La traza del conducto cierra el punto ciego del diagnóstico.** El receptor declaraba ocho desenlaces y solo dos dejaban rastro —la pérdida de contenido y el expediente no registrado—, de modo que un adjunto enviado con una forma no prevista era **indistinguible** de un adjunto nunca enviado. El informe del canal podía decir «sin evidencia», pero no «el proveedor envió esto y lo descartamos aquí», y esa confusión entre ausencia de pérdida y ausencia de dato es la que dejó el transporte de archivos sin diagnosticar.

**La traza registra la carga, no el resultado de interpretarla.** Por cada petición que entra al conducto se asienta la **forma del cuerpo recibido** —claves, tipos JSON y tamaños— con su desenlace literal, incluidos los siete descartes que antes no dejaban rastro: forma no reconocida, sin conversación, saliente ya registrado, texto inválido, enlace inválido, tipo sin tubería y base no disponible. La distinción entre el hecho y su interpretación es exactamente la que convierte una conjetura en una prueba.

**Privacidad de la traza.** No se conserva contenido del candidato: todo valor que parezca contenido —sobre `data:`, base64 con firma real o URL de archivo— se sustituye por su peso, su huella y su tipo declarado, los identificadores telefónicos se enmascaran y el cuerpo se acota a 64 KiB. La traza sirve para saber **qué campos llegaron y de qué tamaño**, que es lo que faltaba, y no para archivar documentos.

**El sondeo del historial deja de descartar en silencio.** El puente de sondeo solo reconocía `file` como adjunto, mientras el webhook reconocía siete tipos. Un tipo que un camino admite y el otro descarta produce una pérdida invisible, porque el mensaje entra por el camino que no lo entiende y el otro camino nunca lo ve. A partir de esta entrega, todo registro no procesado queda asentado con su tipo declarado.

**Migración `0035` con retención declarada.** La tabla de trazas conserva catorce días y su recorte corre a lo sumo una vez por hora: la traza es un instrumento de diagnóstico y no un archivo histórico. El artefacto único de despliegue crece a las migraciones `0022` a `0035` con veintisiete controles autocertificados.

### Alcance candidato 2.0.178

El release **reordena la ficha de Revisión Humana bajo el diseño de la Vista 360° del Candidato**. La acción de re-evaluar sube al encabezado, junto a la identidad del expediente, porque es una acción sobre la postulación completa y no sobre un bloque de lectura; los cinco bloques de lectura quedan después de la matriz, en una **grilla de dos columnas**.

**Barras idénticas y contenido adentro.** Las cinco barras comparten la misma forma: rótulo en versal alineado a la izquierda y botón circular de plegado al extremo derecho. El contenido de cada bloque —resumen, bitácora, motivo, panel de CV y respuestas de formularios— viaja **dentro** de su barra, alineado con el rótulo, y no en tarjetas externas que rompían la columna de lectura.

**Los cinco bloques arrancan plegados.** Lo primero que se lee es la matriz de evaluación; el detalle se despliega cuando el operador lo necesita. El orden de la grilla es declarado y verificable: resumen de perfil y bitácora, motivo y análisis de CV, y las respuestas al final, contiguas al panel de CV que las alimenta.

**El orden de los bloques es un contrato.** La cercanía entre el panel de análisis de CV y las respuestas de formularios —que exige la capacidad declarada en 2.0.165— se garantiza por **posición en la grilla** y no por vecindad textual, de modo que reordenar los bloques sin actualizar la capacidad detiene la puerta de release.

**Sin cambio de esquema y sin cambio de contrato.** No hay migración: el reordenamiento es una superficie de lectura. El artefacto único de despliegue permanece en las migraciones `0022` a `0034` con sus veinticinco controles autocertificados, y la auditoría del canal de ApiChat entregada en 2.0.177 queda intacta: sigue siendo de solo lectura, con sus cuatro estados y su log de errores.

### Alcance candidato 2.0.177

El release **entrega la auditoría del canal de ApiChat**, situada en el menú inmediatamente después del Agente de IA LangGraph. Es un instrumento de diagnóstico, no una reparación: el conducto de archivos falla en silencio por diseño del proveedor —un adjunto sin contenido utilizable devuelve éxito y un envío aceptado no es un envío entregado—, de modo que sin un asiento no hay nada que explicar cuando el archivo no llega.

**Consolida lo que ya existía y cierra el hueco que no dejaba rastro.** El informe reúne las pérdidas asentadas por el receptor y los fallos de entrega de la cola, y agrega el único error que hoy no se asentaba en ninguna parte: el que ocurre **antes** de que exista una fila de mensaje —dirección pública ausente, contenido ilegible, salario automatizado—. A partir de esta entrega, ese fallo se asienta en la bitácora con su etapa y su motivo.

**La clasificación distingue cuatro estados y no tres.** Verificado, con pérdidas, con fallos de envío y **sin evidencia**. La cuarta no es un adorno: la falta de pérdidas sin recepciones no es salud, es una incógnita, y el panel la nombra como tal. La precedencia es deliberada: una pérdida de recepción pesa más que un fallo de envío, porque la primera es información que existió y no llegó y la segunda es información que todavía puede reintentarse.

**Solo lectura.** El informe no cambia estados, no reintenta envíos y no altera ninguna evaluación. Cada consulta degrada a una incógnita si la tabla no existe, en lugar de fallar. El registro del fallo de salida no conserva el nombre del archivo del candidato: basta su tipo y el hecho de que existía para diagnosticar sin exponer contenido.

**Sin cambio de esquema.** No hay migración: la auditoría reutiliza la bitácora y los mensajes de conversación. El artefacto único de despliegue permanece en las migraciones `0022` a `0034` con sus veinticinco controles autocertificados.

### Alcance candidato 2.0.176

El release **entrega los paneles plegables de la ficha de evaluación**, que quedaron declarados como límite en el release inmediatamente anterior. Los cinco bloques de lectura —Resumen de perfil, Motivo de evaluación, Bitácora, Análisis de CV de Agente IA y Formulario y anuncio · respuestas— se pliegan con un botón, de modo que **la matriz de evaluación queda a la vista** y el detalle se despliega solo cuando el operador lo necesita. La matriz no cambia: conserva su disposición y su contenido.

**El estado de plegado es una preferencia de lectura, no una decisión del sistema**, y por eso vive en el almacenamiento del navegador **por sección y por operador**: no viaja al servidor, no se audita y no altera ninguna evaluación. Si el almacenamiento no está disponible —modo privado, política restrictiva— el plegado funciona igual y la preferencia simplemente no se recuerda.

**Accesibilidad declarada.** El botón expone `aria-expanded` y `aria-controls` con el identificador del contenido, de modo que el estado del plegado no depende del color ni de la orientación de la flecha para ser comprendido.

**Sin cambio de esquema.** No hay migración: el plegado es una superficie de lectura. El artefacto único de despliegue permanece en las migraciones `0022` a `0034` con sus veinticinco controles autocertificados.

### Alcance candidato 2.0.175

El release **entrega el agente del reclutador**: el auxiliar interior que analiza **exclusivamente al candidato** de la postulación que se está revisando. Su alcance es deliberadamente estrecho y está declarado en tres reglas.

**No es un motor nuevo: es un tercer disparador del razonamiento institucional.** Responde con la instrucción institucional del agente, el conocimiento de la plaza y el expediente del candidato —nada más—. La instrucción se compone con una función pura y declara explícitamente que el agente **no concede puntajes, no cambia estados y no propone modificaciones a la interfaz**: consulta, explica, compara y advierte. La vía de escritura no existe en el módulo, de modo que no puede alterar una decisión ni por error ni por omisión.

**No es libre: está bajo el régimen de gobernanza.** El modelo se elige **en la conversación** dentro de un catálogo que declara el servidor, y un modelo fuera del catálogo **no se usa**: la conversación cae al modelo institucional. La configuración del evaluador —la que firma las decisiones— no se toca desde aquí.

**Resiliencia DORA: nunca deja de responder.** La pregunta se asienta **antes** de llamar al proveedor, de modo que un fallo no borra lo que el reclutador preguntó. La respuesta usa la credencial principal y, si falla, la de respaldo; el mensaje **declara cuál respondió** con una insignia visible. Un agente que responde con la credencial de respaldo y lo oculta no es resiliente: es opaco.

**El historial pertenece al candidato.** El hilo vive en su propia entidad —`recruiter_agent_threads` y `recruiter_agent_messages`, migración `0034`— y **no** en `conversations`: reutilizar la conversación de WhatsApp habría hecho que el análisis interno apareciera en la bandeja como si el candidato hubiera escrito. Al salir y volver, el reclutador ve exactamente la conversación de esa postulación, con autor, fecha y procedencia de la credencial.

**La luz del cuadro de preguntas no decora.** Verde recorriendo la caja cuando el agente está listo; rojo mientras espera la respuesta del modelo. Se deriva de la mutación en curso, de modo que no puede mentir, y respeta `prefers-reduced-motion`.

**Los documentos que se adjuntan alimentan el RAG personal** por el procedimiento que el expediente ya tenía: una sola tubería, la misma política de extensiones y peso, y el mismo análisis de IA.

**Límite declarado.** Los **paneles plegables** de la ficha —Resumen de perfil, Bitácora, Motivo de evaluación, Análisis de CV de Agente IA y Formulario y anuncio · respuestas— **no están entregados en esta versión**: la ficha conserva su disposición actual y la matriz de evaluación permanece visible tal como está. Es la única parte del pedido que queda pendiente, y se declara aquí en lugar de presentarse como hecha.

### Alcance candidato 2.0.174

El release **entrega el módulo Roles de Seguridad**: el control de acceso por usuario, con cinco columnas, dos alcances y confirmación por correo.

**El permiso es por usuario.** Cada cuenta recibe exactamente lo que la institución le concede, y **sin concesión no hay acceso**: la ausencia de fila es ausencia de permiso, no un valor por omisión. Las cinco columnas son **Vista**, **Lectura**, **Escritura**, **Edición** y **Eliminación**, y se gobiernan en **dos alcances** que no se mezclan: las **entradas del menú** —tomadas de la fuente única del proyecto, `ADMIN_PAGE_LABELS`, para no crear una segunda lista de qué módulos existen— y los **dominios de la base** —`candidatos`, `expediente`, `configuracion` y sus pares—, declarados como conceptos de negocio y no como tablas, porque una lista de tablas envejecería con cada migración.

**El administrador conserva todo por rol y sus casillas no se editan.** Un error en esa grilla dejaría a la institución sin administración; la vista lo declara en lugar de permitirlo.

**El ojito queda ejercido de punta a punta.** Apagar la vista retira la entrada del menú de esa cuenta: el filtro del menú ya existía y ahora consulta el permiso. Apagar la vista apaga también la lectura —un módulo que no se ve no puede leerse— y conceder la lectura concede la vista, de modo que el estado guardado no puede describir un permiso que la interfaz no sepa ejercer.

**Toda asignación exige un código que viaja solo por correo.** La migración `0033_security_roles.sql` crea `user_permissions` y `security_challenges`: código guardado como hash, vigencia, **cinco intentos** —el número que la institución ya se dio en los dos desafíos precedentes—, espera entre reenvíos y desafío anterior invalidado al emitir uno nuevo, de modo que solo el último código vale. La asignación de permisos es, por su naturaleza, una **edición del control de acceso**, y por eso queda sujeta al mismo requisito que toda edición y toda eliminación del artefacto.

**Bitácora en la vista.** El panel «Log Usuarios · últimas 20 acciones» lee la traza institucional del usuario seleccionado, de modo que el administrador ve el efecto de lo que concede sin salir del módulo.

**Alineación con los estándares que el artefacto declara.** ISO/IEC 27001:2022 en control de acceso —concesión explícita y ausencia cerrada— y en registro de eventos —actor, entidad y momento en `audit_log`—; ISO/IEC/IEEE 29119-1:2022 en la decisión de acceso, que es función pura y se prueba sin base de datos; ISO 22301:2019 en la continuidad del cambio, que es inmediato y no corta procesos; ISO/IEC 20000-1:2018 en la declaración del módulo; e ISO/IEC 42001:2023 en que **el agente no puede concederse acceso a sí mismo**: todo el módulo es `adminProcedure`.

**Límite declarado.** El ojito está **ejercido**; la exigencia de lectura, escritura, edición y eliminación **dentro de cada procedimiento de cada módulo** es un paso pendiente y se declara como tal. Guardar las cuatro columnas sin exigirlas todavía sería, exactamente, el defecto que este proyecto corrigió tres veces: una entidad declarada y nunca ejercida. Se declara, no se presenta como entregado.

**El artefacto único de despliegue reúne las migraciones `0022` a `0033`** y su verificación autocertificada crece a **veintitrés controles**.

### Alcance candidato 2.0.173

El release **corrige los tres hallazgos de la auditoría del transporte de adjuntos**: el envío fallaba siempre, la recepción dependía de una suposición y una pérdida parcial era silenciosa.

**Hallazgo A · la entrega al proveedor exigía sesión.** `sendInboxFile` entregaba a ApiChat la dirección `${base}/api/inbox/files/${key}`, servida por una ruta que **exige sesión de administrador**. Los servidores del proveedor no tienen sesión: recibían **403** y nunca descargaban el archivo, de modo que **ningún envío de PDF, Word, audio o imagen llegaba al candidato** —mientras el artefacto lo registraba como enviado, porque lo confirmado era la aceptación de la petición, no la entrega—. La dirección lleva ahora una **capacidad firmada** (`createViewerToken("inbox", key)`) y la ruta acepta el vale como vía alternativa a la sesión. El acceso no se relaja: el vale está acotado a **ese** archivo, caduca, y se verifica en tiempo constante; la sesión administrativa sigue siendo válida.

**Hallazgo B · la recepción leía un solo campo y rechazaba el base64 sin sobre.** El normalizador leía únicamente `message.url`, y `decodeRemoteAttachment` descartaba todo lo que no fuera un sobre `data:` o una URL `https://`. La opción del proveedor se llama literalmente «Notify attachments in **base64** format»: si el contenido llega como base64 —con o sin sobre, en `url` o en un campo propio— el receptor **lo perdía**. Ahora el contenido se resuelve en trece campos declarados y el transporte **decodifica base64 sin sobre**, con un umbral que impide confundir un pie de foto con un archivo. Ninguna de las dos formas queda sin cubrir.

**Hallazgo C · el fallo del expediente era silencioso.** El registro del documento en el RAG estaba envuelto en un `catch` vacío: si fallaba, el mensaje quedaba en la bandeja **sin documento y sin que nada lo dijera**. La intención era correcta —el acuse no debe romperse— y la forma era defectuosa. Ahora el fallo se asienta con su causa (`expediente-no-registrado`) y el archivo permanece en el volumen para reintentarlo.

**Diagnóstico observable.** Cuando una carga no trae contenido utilizable, el asiento nombra **los campos que sí traía** (`fieldsPresent`), sin su contenido: el contrato del proveedor deja de suponerse y pasa a observarse. Es lo que permite responder, con un solo archivo enviado desde un teléfono, cuál de las dos formas usa la cuenta.

**La prueba que faltaba.** Las pruebas de la frontera usaban cargas escritas por nosotros, de modo que certificaban **nuestra suposición** sobre el proveedor y no al proveedor. Se añaden las formas que faltaban: base64 sin sobre, base64 partido en líneas, texto breve que no debe confundirse con un archivo, adjunto en un campo distinto de `url` y asiento del diagnóstico.

### Alcance candidato 2.0.172

El release **entrega el registro de códecs y decodificadores del transporte**, administrable desde Configuración. El artefacto no es un transporte propio: recibe lo que WhatsApp admite. Por eso el catálogo **separa contenedor de códec** —lo que el webhook declara de lo que hay que decodificar de verdad— y declara, por entrada, **qué hace el artefacto con ella hoy**: `rag`, `transcripcion`, `visor` o `sin-conducto`. Esa última columna es la que impide prometer una capacidad inexistente: el video y los formatos sin tubería se declaran como tales.

**Veinticinco entradas, cuatro familias, entregadas activadas.** Audio —Opus, Vorbis, AAC, AMR-NB/WB, MP3 y Opus en WebM—; video —H.264, H.265/HEVC, MPEG-4 Part 2, H.263 y `.mov`—; imagen —JPEG, PNG y WebP—; y documentos —PDF con sus filtros internos, DOCX, DOC, XLSX, XLS, PPTX, TXT, CSV, ODT y ODS—. La migración `0032_codec_registry.sql` siembra las veinticinco con su interruptor encendido, de modo que la instalación nazca completa.

**El mantenimiento distingue el daño.** Apagar una entrada **con conducto en uso** produce una advertencia que nombra el formato y su consecuencia: mientras permanezca apagada, ese contenido no podrá procesarse y **la pérdida no producirá error**. Apagar una entrada **sin conducto** —el video, una presentación, un OpenDocument— es mantenimiento legítimo y **no advierte**. Esa distinción es la razón de ser del registro: sin ella, el interruptor sería un modo silencioso de romper el expediente.

**Sin desincronización posible.** El estado vive en `integration_settings` con una clave por entrada, y la escritura guarda **todas** las entradas: el catálogo y la configuración no pueden discrepar. La siembra usa `DO NOTHING`, así que reaplicar la migración **nunca revierte un apagado deliberado**. El asiento de auditoría usa el identificador convencional de los ajustes con el detalle en el cuerpo —la misma forma que las cuatro superficies de configuración que ya existían—, de modo que el defecto de tipo corregido en 2.0.169 no puede repetirse aquí.

**Sin afectar el transporte.** El registro **no altera** el webhook, la reconciliación, el despacho, el ciclo de pruebas ni el RAG: declara y audita el mantenimiento. Su única consecuencia operativa es la advertencia, que es información para el operador y no un cambio de conducta del sistema.

**El artefacto único de despliegue reúne las migraciones `0022` a `0032`** y su verificación autocertificada crece a **veintiún controles**: el registro nace activado en la instalación, sin paso manual.

### Alcance candidato 2.0.171

El release **cierra el conducto de adjuntos con evidencia positiva**. La entrega anterior hizo visible la pérdida; faltaba lo contrario: **la prueba de que el conducto opera**. Y faltaba un matiz que importa más de lo que parece —**la falta de pérdidas con falta de recepciones no es salud, es una incógnita**—. Declararla como buena habría repetido exactamente el error que este módulo corrige: concluir que el conducto funciona porque nada falló, cuando nunca se intentó.

El estado del conducto tiene ahora **tres valores**: `verificado` —se recibieron adjuntos y no hubo pérdidas—, `con_perdidas` —alguna pérdida prevalece sobre cualquier recepción— y `sin_evidencia` —ni pérdidas ni recepciones—. La evidencia positiva se mide sobre los documentos entrantes del expediente con origen en el webhook, en la misma ventana de veinticuatro horas que la medición de pérdidas.

La superficie **muestra lo que el artefacto sabe**: el panel de ApiChat presenta el estado del conducto con sus conteos, el instante de la última recepción efectiva y el **requisito permanente del proveedor** —la opción literal «Notify attachments in base64 format»—, que antes viajaba en la respuesta de la interfaz pero no se dibujaba en ninguna parte. El silencio también habla: sin evidencia, el artefacto lo declara y pide una prueba con un archivo real.

**Sin cambio de esquema.** No hay migración: el estado se deriva del expediente y de la traza.

### Alcance candidato 2.0.170

El release **entrega el ciclo de evaluación automática** y **corrige la pérdida silenciosa de adjuntos** que lo hacía inviable. Ambas cosas son una sola: el ciclo automático solicita el CV del candidato, y sin conducto de adjuntos esa petición no puede completarse.

**La cola no es una entidad: es un estado del conjunto de postulaciones.** El criterio declarado es `applications.evaluation_at IS NULL` —quien nunca fue evaluado—, de modo que una evaluación hecha por una persona o por un evento **saca el elemento de la cola por sí sola**, sin coordinación ni reconciliación. Los contadores del panel se derivan de esa misma realidad: los mueve cualquier camino de evaluación, y por eso el número visible no puede discrepar del estado. El ciclo toma **la postulación más antigua admisible** sin importar plaza ni formulario.

**La cadena es la de la postulación pública.** Para una postulación importada —que nunca disparó el evento— el ciclo **solicita el CV por el webhook** (lo que registra además el ciclo de pruebas de la plaza) y después **evalúa el perfil laboral**, y las pruebas psicométricas activadas siguen su curso. Cada paso es idempotente, de modo que reproducir la cadena no duplica nada de lo ya hecho.

**Éxito significa que la nota quedó persistida.** El ciclo no avanza porque el proveedor haya respondido, sino porque el hecho quedó escrito: si la evaluación no dejó marca, la unidad falla, se asienta la causa y la postulación permanece en la cola. Tres intentos y sale de la cola como **no evaluable**, visible y con causa: el contador de pendientes nunca esconde trabajo irrecuperable.

**La pausa de treinta segundos se mide desde el cierre de la unidad anterior y vive en el registro durable**, de modo que un reinicio del servicio no la reinicia ni la duplica. La parada es **cooperativa**: apagar declara `deteniendose`, el cese ocurre **entre unidades** y nunca a mitad de una evaluación, y el aviso por correo se envía al consumarse la parada.

**Encender y apagar exigen un código por correo.** El interruptor es un acto de consecuencia institucional: el desafío se guarda solo como hash, con vigencia, intentos y espera entre reenvíos, igual que el retiro de una versión de instrumento. La migración `0031_evaluation_automation.sql` crea el desafío y el índice que hace barata la cuenta de intentos.

**Corrección epistémica del conducto de adjuntos.** Se hallaron dos defectos que convertían una pérdida de información en una creencia falsa —«el candidato no adjuntó nada»—. Primero, el receptor descartaba con éxito (`200 {ok:true, skipped:"archivo-sin-contenido"}`) todo mensaje de archivo sin contenido utilizable, de modo que la pérdida era **indistinguible de que nada hubiera ocurrido**. Segundo, el receptor reconocía una sola etiqueta de tipo (`file`), de manera que **audio, imagen y nota de voz** caían en `tipo-sin-pipeline`: descartados en silencio. Ahora toda pérdida de archivo **queda asentada con su causa** (`apichat_webhook_loss`), el receptor reconoce cualquier tipo portador de adjunto, la configuración **declara el requisito literal del proveedor** —«Notify attachments in base64 format»— y la medición de pérdidas de las últimas veinticuatro horas produce una **advertencia observable**. No se asientan los descartes legítimos —acuses, estados, actualizaciones de chat—: asentarlos produciría un torrente de alarmas falsas.

**Límite declarado.** El artefacto no puede encender por sí mismo una opción del panel del proveedor: **detecta y declara** su ausencia, y la corrección operativa sigue siendo humana. El ciclo administra y puntúa criterios declarados; no confiere validez psicométrica. Y el 99,9 % se promete sobre el planificador y la conservación del trabajo —nunca se pierde una pendiente y ninguna se evalúa dos veces—, no sobre el resultado del proveedor, que es un tercero.

### Alcance candidato 2.0.169

El release **corrige el defecto que impedía encender el ciclo automático de pruebas psicométricas**. El asiento de auditoría del interruptor entregaba la clave de configuración (`psychometric_autostart`) a `audit_log.entity_id`, que es entero **no nulo**: PostgreSQL rechazaba la operación con `invalid input syntax for type integer` y el interruptor **no podía encenderse desde el panel**. El módulo quedaba declarado y era inalcanzable —la ventana de treinta segundos, el saludo del protocolo, el ciclo por ítem y la re-evaluación automática no llegaban a ejecutarse—.

**La causa y su alcance.** La convención del proyecto es asentar los cambios de configuración con el identificador `0` y la clave dentro del detalle (`after_json`); así lo hacen las cuatro superficies de ajustes —conversación, ApiChat, RAG de proyectos y endpoints de capacidad—. La auditoría del interruptor de pruebas fue **la única** que colocó la clave en el lugar del identificador. Se revisaron las sesenta y una inserciones de auditoría del artefacto: ninguna otra presenta el defecto.

**La corrección y su guardia.** El asiento pasa a usar el identificador convencional y conserva la clave dentro del detalle, de modo que la trazabilidad no se pierde. Se agrega la prueba que lo habría detectado: comprueba que el identificador es un literal numérico y que la clave viaja en el detalle. El fallo no era de lógica sino de forma del asiento, y por eso las veintidós pruebas de las decisiones puras nunca lo habrían visto.

**Sin cambio de esquema.** No hay migración: el defecto estaba en el asiento, no en la estructura.

### Alcance candidato 2.0.168

El release **ejecuta el protocolo de la prueba**. Lo que 2.0.166 declaró como límite —el motor no administraba los instrumentos de la plaza— queda entregado: el ciclo emite el ítem que señala su puntero, recibe la respuesta del candidato, la determina y avanza, y al agotar el instrumento cierra el ciclo, de modo que la re-evaluación automática de 2.0.167 se dispara como consecuencia del último ítem y no de una invocación manual.

**La ontología queda ordenada: un solo acto.** `assessment_cycles` es el acto único de la evaluación psicométrica y la ficha lee de ahí —el nombre de la prueba, su puntero y su punteo de ejecución—; `assessment_sessions` queda **declarada como legada**, sin productor ni consumidor, y se conserva porque las migraciones de este proyecto son expansivas y nunca destructivas. La ubicación declarada no se copia al ciclo: su fuente única es la postulación, y duplicarla solo añadiría la posibilidad de que ambas discrepen. La consulta que gobierna la toma humana lee el estado del ciclo, no el de la entidad legada.

**La determinación es del servidor.** `judgeAssessmentAnswer` aplica la regla declarada —umbral de palabras— y `assessmentExecutionScore` compone el punteo de ejecución como la proporción del instrumento efectivamente respondida, de modo que el punteo es **reconstruible** a partir de los intentos registrados. El texto del criterio (`evaluation_criterion`) no sale del servidor: la ficha recibe solo lo que puede mostrarse. Ninguna ponderación viaja al cliente.

**La traza del acto es nueva.** La migración `0030_assessment_item_attempts.sql` registra, por ciclo e ítem, la pregunta emitida, la respuesta recibida, su determinación, su puntaje y la razón de esa determinación. La identidad es única por ciclo e ítem —de modo que una reentrega del webhook no vuelve a puntuar la misma respuesta— y la determinación está acotada a un vocabulario declarado, lo que hace distinguible una respuesta insuficiente de una respuesta ausente.

**La continuidad está declarada y probada.** Apagar el interruptor **suspende la ejecución sin suprimir la obligación**: el ciclo conserva su instante de vencimiento y su puntero, y al encenderlo de nuevo la tarea programada **continúa donde quedó**, sin reiniciar el instrumento ni repetir preguntas ya formuladas. El control humano detiene la administración del instrumento mientras conserva la conversación, y la reactivación del agente reanuda el ciclo por el mismo punto. Durante la ejecución del protocolo, el motor general no consume el turno.

**La entrega tiene camino operativo.** El artefacto único `database/005_servicio_conversacional_listo.sql` pasa a reunir las migraciones `0022` a `0030`, y su verificación autocertificada crece de once a dieciocho controles para cubrir las migraciones 0025 a 0030: el despliegue en un solo archivo ya no deja fuera las tablas del expediente, del ciclo y de su traza.

**Límite declarado.** El motor **administra y puntúa criterios declarados**: no confiere validez psicométrica ni sustituye la validación externa de los instrumentos que la requieren. La secuencia es una caminata ordenada y acotada sobre los ítems activos, no un árbol de decisión sin cota: la recursión pertenece a la justificación del puntaje —el seguimiento de un ítem no concluyente— y no al control de flujo.

### Alcance candidato 2.0.167

El release **hace automática la re-evaluación que acompaña al cierre del ciclo de pruebas**. La decisión estaba abierta —¿la re-evaluación se pide o se ejecuta?— y se resuelve por la segunda: concluir el ciclo es el hecho que la dispara. La evaluación se compone con el **perfil laboral de la plaza** y el **conocimiento del proyecto (RAG)** que el evaluador ya reúne, más el expediente del candidato incorporado en 2.0.165, de modo que no hace falta ninguna capa de contexto nueva para que el resultado sea el correcto.

**Diseño del cierre.** `completeAssessmentCycle` decide el cierre dentro de una transacción con `SELECT … FOR UPDATE`: dos cierres concurrentes no duplican la obligación y un ciclo ya concluido **no vuelve a evaluarse**. La evaluación —una llamada externa lenta— se ejecuta **después del commit**, de modo que la transacción no se retiene durante la llamada al proveedor. El cierre asienta `assessment_cycle_completed` con el punteo de la prueba y, al terminar la evaluación, `assessment_cycle_evaluated` con el punteo resultante; si la evaluación falla, el ciclo **queda concluido** y el fallo se asienta aparte: el cierre nunca queda a medias ni se repite.

**Reanudación y concurrencia.** La marca del cierre es la evidencia de que la evaluación automática ya ocurrió, así que el barrido no la repite ni un reintento del proveedor la duplica. La guardia de evaluación concurrente que el evaluador ya tenía sigue vigente.

La migración `0029_assessment_cycle_evaluation.sql` agrega las dos columnas del cierre evaluado, se ejecuta solo si la tabla del ciclo existe y es idempotente. **Sin migración de datos**: las columnas son anulables.

### Alcance candidato 2.0.166

El release **declara el ciclo automático de pruebas psicométricas** y lo gobierna con un interruptor administrable en `Pruebas psicométricas`. Encendido, el agente busca las pruebas habilitadas de la plaza y el ciclo queda registrado para iniciar **treinta segundos después** de recibir el formulario, tras solicitar el CV; apagado, **no se registra obligación alguna y el agente no contacta por el webhook**. La decisión es de la institución, queda auditada (`assessment_automation_updated`) y no se decide por postulación.

**La ventana es una función pura.** `planAssessmentCycle` recibe el estado y devuelve la decisión —`apagado`, `sin_pruebas`, `en_espera`, `listo`, `en_curso`, `concluido`— con el instante en que el ciclo queda listo y los segundos restantes. La semántica del interruptor apagado y la ventana se verifican sin base de datos.

**El encadenado está declarado.** El CV se solicita de forma inmediata y `requestCvForApplication` encadena el registro del ciclo: la obligación guarda la prueba habilitada que lo inicia y el instante en que queda listo. El barrido periódico de la conversación promueve las obligaciones vencidas, abre la conversación, **encola el saludo** —con marca propia, de modo que un reintento del barrido no lo duplique— y deja el ciclo en curso con su asiento `assessment_cycle_started`. El saludo lo entrega el despachador de siempre.

**Límite declarado.** El protocolo conversacional —aplicar la metodología, formular las preguntas de forma recursiva y capturar el punteo de la prueba— **no está entregado**: el motor conversacional no ejecuta los protocolos de evaluación, y hacerlo requiere una pieza nueva que gobierne la secuencia, el punteo por respuesta y el cierre. El cierre evaluado se entregó en 2.0.167.

La migración `0028_assessment_cycles.sql` es expansiva e idempotente: crea la tabla del ciclo con una fila por postulación y termina con una verificación autocertificada.

### Alcance candidato 2.0.165

El release **entrega la esencia del CV y la re-evaluación que la usa**. `server/cvAnalysis.ts` incorpora `chunkCvText` —que fragmenta el texto conservando párrafos completos y rotula cada fragmento— y `analyzeCandidateCvEssence`, que genera la esencia con el límite vigente de la configuración, la persiste con su modelo y su límite aplicado, marca el estado y deja asiento propio (`candidate_cv_essence_generated`) en la auditoría. La operación es idempotente por documento: regenerar reemplaza la esencia anterior.

**El expediente entra al evaluador como capa declarada.** `server/agentEvaluator.ts` carga el expediente documental del candidato —la esencia del CV y, en su ausencia, el análisis de 66 y 325 palabras— y lo entrega al modelo como sección propia, después del conocimiento del proyecto, con la regla de que es lo que la persona declaró y no se convierte en hecho más allá de lo que el texto afirma. La re-evaluación que ya existía pasa así a contar con el CV y **actualiza el puntaje** sin cambiar el contrato del evaluador ni la ponderación calculada por el servidor.

**Degradación declarada.** La lectura del expediente usa la esencia cuando la migración `0027` está aplicada y **degrada al análisis previo cuando no lo está**, de modo que una base sin la migración sigue evaluando en lugar de fallar.

**El panel en la ficha.** `client/src/components/review/CandidateCvAnalysisPanel.tsx` se monta junto a `Formularios y anuncios · respuestas`: declara primero el estado del ciclo —sin solicitud, pendiente, recibido—, lista los documentos recibidos con su origen, muestra la esencia con su conteo de palabras frente al límite vigente y ofrece generarla y re-evaluar con ella. El panel **propone**; la decisión sigue en el encabezado y su asiento en la bitácora.

La migración `0027_candidate_cv_essence.sql` es expansiva e idempotente: agrega cinco columnas y un índice, se ejecuta solo si la tabla del expediente existe y termina con una verificación autocertificada. Se aplicó sobre PostgreSQL 17 con y sin la tabla previa, se reaplicó sin error y conservó el registro existente.

### Alcance candidato 2.0.164

El release **abre el módulo de evaluación de CV con IA** y renombra la hoja que lo gobierna. `Configuración › Preferencias de comunicación` pasa a llamarse **Evaluación de CV con IA** y reúne la configuración del ciclo: el mensaje base de solicitud, el **mensaje de agradecimiento** con sus parámetros `{{nombre}}` y `{{plaza}}`, el **aviso de contacto** por el mismo medio y la **extensión de la esencia** del CV —550 palabras por omisión, entre 200 y 900—. La hoja carga los valores vigentes desde el servidor con la misma consulta que los gobierna, de modo que la institución ajusta el trato sin desplegar código.

**El cierre es parte del mensaje.** El agente solicita el CV al confirmar el formulario y el mensaje incorpora el cierre institucional: el agradecimiento por participar y el aviso de que, si el perfil avanza después del análisis, el contacto ocurrirá por ese mismo medio. El cierre se compone con la **misma lectura** que ya alimenta el mensaje, así que no agrega consultas al despacho y usa el texto por omisión cuando no se configuró.

**La guardia salarial precede a la base.** La revisión dejó una propiedad institucional explícita: una plantilla que ofrezca remuneración se rechaza **antes** de cualquier lectura o escritura, de modo que el rechazo no deja efectos laterales. La puerta de release compara la posición de la guardia con la del bloqueo por teléfono y falla si el orden se invierte.

**El estado del expediente se deriva.** `server/cvAnalysis.ts` reúne la configuración del módulo, el renderizado de parámetros, la composición del cierre y la derivación del estado —`sin_solicitud`, `pendiente`, `recibido`— a partir de la evidencia: la marca `cv_request:<id>` prueba que se solicitó y la llegada de un documento con origen distinto de `manual` prueba que la persona respondió.

**Alcance declarado.** El análisis ontológico, epistemológico, fenomenológico, de ingeniería y de propiedad intelectual del módulo, con su ubicación estratégica en la interfaz, está en [ANALISIS_CV_AGENTE_2.0.164.md](ANALISIS_CV_AGENTE_2.0.164.md). La generación de la esencia, su persistencia y la re-evaluación que actualiza el puntaje quedan declaradas como incremento siguiente.

Sin migración: el alcance entregado usa estructuras existentes.

### Alcance candidato 2.0.163

El release **retira de la ficha las dos cajas que la reingeniería de hojas dejó sin contenido y la ordena en torno a la evidencia**. La caja «Solicitud de CV por WhatsApp» existía desde 2.0.160 como resto del bloque de decisión anterior: con la decisión en el encabezado y el pedido de CV automático al postular, su cuerpo se reducía a una leyenda de estado. En su lugar la ficha monta la **bitácora**, que estaba al pie compartiendo columna con un resumen de conversación vacío; ese resumen se retira porque la conversación ya tiene su módulo propio, con su icono y su capacidad completa, bajo la ficha.

**La bitácora sube al lugar de la decisión.** El bloque conserva su contenido —los últimos cinco asientos con su acción, el cambio de estado, el comentario, el actor y la marca temporal— y pasa a la columna derecha del cuerpo, frente al resumen de perfil y al motivo. La ficha queda así: encabezado de identidad, Vista 360° del Candidato, resumen de perfil y motivo a la izquierda, bitácora a la derecha, respuestas de formularios a ancho completo y, debajo, el expediente documental y la conversación.

**Sin pérdida operativa.** El reenvío manual de la solicitud de CV —la única acción que quedaba en la caja retirada— no desaparece: viaja con la bitácora y se dibuja **únicamente cuando es accionable**, esto es, cuando la postulación está calificada y el envío no consta como enviado, con su causa y su estado. Un caso sin incidencia no vuelve a mostrar un panel vacío; un caso con envío fallido conserva el reintento y la advertencia de verificar la conversación antes de un segundo intento.

**Gobierno.** La puerta de release blinda el orden y la ausencia: la ficha monta el panel de Vista 360° antes del resumen de perfil y de la bitácora, y ya no contiene la caja de solicitud ni el resumen de conversación.

Sin migración: el alcance es de interfaz.

### Alcance candidato 2.0.162

El release **cierra la frontera de propiedad intelectual en el paquete del cliente**. La estrategia declarada en [ANALISIS_FORMULARIOS_MULTIPLES_2.0.138.md](ANALISIS_FORMULARIOS_MULTIPLES_2.0.138.md) exige que pesos, reglas deterministas, criterios e instrucciones del agente permanezcan fuera del paquete público. La revisión del artefacto mostró que la hoja de configuración del agente importaba `EVALUATION_BLOCKS` —pesos, etiquetas y propósito de cada bloque—, `SCORE_BANDS` —bandas de clasificación—, `SALARY_GOVERNANCE_POLICY` y `DEFAULT_AGENT_SETTINGS`, que arrastra la directriz por omisión, desde `shared/agentConfig.ts`. Como Vite empaqueta las hojas administrativas en el mismo paquete que sirve al navegador, ese know-how era descargable sin credenciales.

**El método se sirve, no se distribuye.** `server/agentSettings.ts` publica un catálogo del método —bloques con su identificador, etiqueta, peso y propósito; bandas de clasificación; directriz inalterable de remuneración y directriz por omisión— dentro de la respuesta autenticada de `agent.configuration`. La hoja administrativa lo consume desde la consulta y ya no conserva copia: el formulario no se dibuja hasta recibir la configuración y «Restaurar directriz» toma la directriz del servidor.

**La ficha recibe la etiqueta resuelta.** `server/agentEvaluator.ts` expone `withBlockLabels`, que agrega a cada bloque su etiqueta institucional antes de entregar el payload en `candidates.detail`; el panel de Vista 360° del candidato renderiza `block.label` y dejó de mantener el catálogo de bloques en el cliente. Las evaluaciones ya persistidas conservan su etiqueta porque se resuelve al leer y no depende de un campo almacenado.

**La frontera se audita.** La puerta de release recorre el código del cliente y falla si reaparecen los símbolos del método o los identificadores de bloque; exige además que el servidor conserve el catálogo y que la superficie administrativa lo consuma de la consulta. El paquete compilado se verificó sin la directriz de remuneración, sin los identificadores de bloque y sin las etiquetas ni los propósitos de la matriz.

Sin migración: el alcance es de servidor y de interfaz.

### Alcance candidato 2.0.161

El release **integra en la ficha la caja de la matriz que la búsqueda dejó de alojar**, para que la revisión humana lea la evidencia sin cambiar de hoja. La caja —rótulo «Vista 360° del Candidato», matriz de evaluación por bloques, nota inicial y motivo, con su recorrido de bloques y sus tres accesos (`Nota IA`, `Evaluación`, `Motivo`)— se monta en `client/src/components/review/CandidateViewerPanel.tsx` y encabeza el cuerpo de la ficha: **arriba del resumen de perfil y de la decisión, y debajo del encabezado de identidad**.

**Presentación condensada.** La matriz muestra **tres bloques a la vez** y ofrece el recorrido del resto con el contador y sus flechas —«1–3 de 6»—, en lugar de desplegar los seis en una cuadrícula larga; en pantallas estrechas muestra uno. El bloque conserva la clasificación y el modelo que sostienen la evaluación, y la sección de matriz duplicada que la ficha tenía más abajo se retira: su contenido es ahora el de la caja.

**Sin duplicación de controles.** El panel administra su propia vista y no repite decisiones: la decisión humana sigue en el encabezado de identidad y la solicitud de CV en su bloque. La ficha queda condensada en un solo recorrido: encabezado, Vista 360°, resumen de perfil, motivo, reevaluación, solicitud de CV, respuestas de formularios y auditoría.

**Gobierno.** La puerta de release blinda la titularidad y el orden: la ficha monta el panel, y el panel aparece antes del resumen de perfil y de la solicitud de CV. El conteo de archivos auditados pasa a 118.

Sin migración: el alcance es de interfaz.

### Alcance candidato 2.0.160

El release **lleva el encabezado de identidad a la hoja donde se decide y retira de la búsqueda toda superficie de revisión**. Hasta 2.0.159, la búsqueda de Candidatos abría con una tarjeta de identidad —persona, plaza, contacto, ubicación declarada, expectativa salarial, punteo de IA y control de estado con comentario— y con un visor lateral que representaba la matriz de evaluación, la nota inicial de IA, el motivo y la participación en formularios. Esa tarjeta es una superficie de decisión y su lugar natural es la ficha: la entrega la monta como **encabezado de Revisión Humana**, encima de la matriz de evaluación, el motivo, el resumen de perfil y las respuestas.

**La búsqueda queda como búsqueda.** Conserva los filtros por estado, plaza, rango de fechas, punteo mínimo, sólo evaluados, orden por columna y búsqueda libre, la matriz de resultados con las columnas propias de la plaza, la navegación vertical y el criterio por fila para triaje. Pierde el encabezado de identidad y el visor lateral, y a cambio **toda evidencia del resultado abre la ficha**: la respuesta, el punteo de IA y el acceso al motivo son enlaces a `/admin/human-review?application=<id>`. La búsqueda deja de alojar una segunda representación del expediente porque su contenido ya vive en la ficha, con mayor detalle.

**Una sola superficie de decisión.** El encabezado de la ficha reúne identidad, punteo y decisión humana con su comentario y su auditoría; el bloque de la ficha que antes repetía estado, comentario y guardado conserva ahora su acción exclusiva —**solicitud y reintento del CV por WhatsApp** con el estado del envío—, de modo que la hoja no ofrece dos controles idénticos. El encabezado vive en `client/src/components/review/CandidateReviewSummary.tsx` y ese módulo expone además los ayudantes de resumen que la matriz necesita (`scoreFor`, `answersFor`, `formatAnswer`, `formatDate`, `declaredLocationLabel`, `salaryLabel`); la búsqueda deja de montarlo.

**Trazabilidad intacta.** La decisión sigue registrándose con el mismo procedimiento (`candidates.setStatus`), el mismo bloqueo de fila y la misma auditoría. La consulta `candidates.reviewWorkspace` admite el filtro por `applicationId`, con el que la ficha pide **una sola postulación** en lugar de la ventana completa de revisión. La puerta de release blinda la nueva titularidad: la búsqueda no monta el encabezado ni los paneles de evidencia, y toda evidencia apunta a la ficha.

**Gobierno del incremento.** La prosa de gobierno dejó de escribir la versión vigente, que envejecía con cada entrega; se consulta con `pnpm release:bump -- --dry-run`.

Sin migración: el alcance es de interfaz.

### Alcance candidato 2.0.159

El release **intercambia el contenido de las dos hojas del proceso**: la búsqueda de Candidatos pasa a ser el explorador y la ficha completa se traslada a Revisión Humana. Hasta 2.0.158, `/admin/candidates` mostraba una bandeja lineal de postulaciones y abría la ficha en un panel superpuesto, mientras `/admin/human-review` concentraba el explorador de filtros y la matriz de resultados. La entrega separa las dos responsabilidades en su lugar natural: **buscar** en Candidatos y **decidir** en Revisión Humana.

**Candidatos es ahora el explorador.** La hoja conserva íntegra la capacidad ya verificada —filtros por estado, plaza, rango de fechas, punteo mínimo, sólo evaluados, orden por columna y búsqueda por nombre, teléfono, correo o plaza; matriz de resultados con las columnas propias de la plaza; visor lateral de respuestas, nota inicial de IA, motivo de evaluación y participación en formularios; y navegación vertical entre resultados— y añade el **botón «Detalle» en cada fila**, que abre la ficha de esa postulación en Revisión Humana. La bandeja lineal se retira porque su contenido —identidad, plaza, teléfono, estado y participación— ya está comprendido, con mayor detalle, en la matriz y en el visor.

**Revisión Humana es ahora la ficha.** La hoja recibe la matriz de evaluación de IA con sus seis bloques, el resumen de perfil, el motivo de evaluación, la caja de decisión humana con su guardarraíl y las respuestas de formularios y anuncios con su versión. Bajo esa ficha permanecen el **RAG Personal del candidato** y su **bandeja de WhatsApp**, de modo que el expediente, la conversación y el dictamen se leen en una sola hoja. La ficha se abre con `?application=<id>` desde el botón «Detalle» del explorador, desde la bandeja general y desde el visor; sin ese parámetro la hoja explica el recorrido en lugar de mostrar una vista vacía.

**Sin pérdida de capacidad.** Ninguna función se retira: cada componente conserva su consulta y su contrato (`candidates.reviewWorkspace`, `candidates.detail`, `candidates.setStatus`) y las dos hojas siguen consumiendo los mismos procedimientos. La separación es de ubicación y de recorrido, no de capacidades.

**Gobierno del incremento.** `scripts/bump-release.mjs` reescribía encabezados y párrafos de alcance ya entregados, con lo que una entrega anterior podía aparecer rotulada como la vigente; el script preserva ahora esas líneas históricas y solo avanza la versión futura del incremento atómico.

Sin migración: el alcance es de interfaz.

### Alcance candidato 2.0.158

El release traslada el **resumen de actividad y control ISO** del encabezado al **pie de cada hoja administrativa**. El aviso se monta una sola vez en `DashboardLayout.tsx`, de modo que el cambio rige todas las hojas por construcción y no por repetición; el bloque pasa a cerrar el contenido —después de `{children}`— y su separación cambia de margen inferior a superior. La vista deja de abrir con un panel de auditoría que desplazaba el trabajo operativo y termina, en cambio, con el registro de la ruta.

**Sin pérdida de capacidad.** La posición no afecta al comportamiento: el componente sigue registrando la apertura de la vista (`page_opened` con su correlación por sesión), consultando la última actividad de la ruta y ofreciendo el acceso a `Ver control ISO`. La puerta de gobernanza blinda el orden respecto del contenido, el margen superior y la ausencia del inferior.

**Medida del README corregida.** La auditoría de proporciones del README medía el cuerpo completo, incluido el registro de versiones, que crece una entrada por release. Eso obligaba a recortar texto académico en cada entrega, con lo que la medida dejaba de describir el cuerpo del documento. La puerta mide ahora la **prosa académica** —con su propio techo— y conserva un límite independiente para el registro histórico, que mantiene su función de apéndice auditable.

Sin migración: el alcance es de interfaz.

### Alcance candidato 2.0.157

El release sustituye el panel compacto «Conversación de …» de Revisión Humana por la **bandeja de WhatsApp del candidato**, con el mismo recorrido operativo de la bandeja general pero acotado a la persona en estudio. El módulo `client/src/components/review/CandidateConversationPanel.tsx` incorpora el historial completo del candidato —sin el recorte a la última hora de la vista anterior—, la lectura y escritura de mensajes, el envío de **enlace, ubicación, archivo y nota de voz**, el control del agente con su excepción administrativa auditada, el borrado trazable de mensajes, el marcado de lectura y la sincronización manual.

**Conducta idéntica por construcción.** El panel consume los mismos procedimientos del backend que la bandeja general —`inbox.list`, `detail`, `setAutomation`, `markRead`, `syncNow`, `sendText`, `sendLink`, `sendLocation`, `sendFile`, `sendPtt` y `deleteMessage`—, de modo que los permisos, el guardarraíl de remuneración, el registro en `audit_log` y el encolado del envío no pueden divergir entre ambas vistas. No se modificó la bandeja general ni su contrato.

**Alcance exclusivo.** La consulta se acota por `applicationId` con `timeRange: "all"`, así que el panel no ofrece el listado global ni permite abandonar el expediente de la persona en estudio. El encabezado informa el número de mensajes y de conversaciones, la marca de no leídos y el estado del control.

**De la bandeja al expediente.** Un documento que el candidato envía por WhatsApp ya se incorpora a su RAG Personal desde la recepción (`registerCandidateInboundDocument`, alcance de 2.0.156), con el mismo transporte verificado por contenido, la misma política de extensiones y el mismo análisis de IA. Este release hace visible esa continuidad en la propia ficha: el módulo lo declara y el expediente aparece junto a la conversación, en la misma hoja.

Sin migración: el alcance es de interfaz y reutiliza el contrato existente.

### Alcance de 2.0.155

El release corrige dos fenómenos reportados sobre el Administrador de Proyectos y los declara como capacidades verificables. **Transporte canónico en base64**: el archivo se transporta codificado y se almacena «normal» —bytes binarios con su extensión final—, tanto al cargarlo con el selector o el arrastre y suelte como al recibirlo de forma remota por ApiChat, que lo entrega como dato URI o URL. El módulo `server/base64Transport.ts` concentra por primera vez la codificación, la decodificación, el límite de peso, la huella `sha256` y la **detección del tipo por contenido**: la extensión final se resuelve por firma de bytes (PDF, PNG, JPEG, GIF, WebP, MP4, MP3, WAV, OGG, DOCX, XLSX) y solo recurre a la extensión o al MIME declarados cuando el formato carece de firma verificable. Una discordancia entre lo declarado y lo detectado **no rechaza la carga** —eso retiraría una capacidad ya declarada—: corrige la extensión y el nombre visibles, y deja constancia en `audit_log` con extensión declarada, MIME verificado, MIME detectado, indicador de discordancia, versión del transporte y `sha256`. Las cuatro fronteras que antes decodificaban por su cuenta —carga del RAG, recepción del puente, receptor webhook y envío saliente de la bandeja— comparten ahora una sola semántica, lo que elimina la divergencia entre canales.

**Visor universal**: el visor no mostraba correctamente los documentos del RAG por siete causas concurrentes. Las peticiones que el navegador emite por su cuenta para `iframe`, `img`, `video` y `audio` no llevan cabeceras de sesión y dependían de una cookie con `SameSite=None`, que el navegador puede omitir en contexto incrustado o tras caducar la sesión; además solo existían vistas previas para PDF, Word y CSV, el HTML de Word se entregaba sin documento ni estilo, el CSV se servía como texto plano y faltaban las cabeceras que impiden la descarga forzada. El módulo `server/viewerAccess.ts` acuña un **vale firmado** (HMAC-SHA256 sobre alcance, recurso y caducidad de quince minutos, con verificación en tiempo constante y separación de alcances entre conocimiento y bandeja) que el visor anexa a la dirección; la sesión de administración sigue siendo la vía primaria y el vale es una capacidad acotada, no una elevación. La vista previa incorpora ahora documento HTML con tema para Word —incluidas tablas e imágenes—, tabla delimitada para CSV con detección de separador y comillas escapadas, cuadrícula para Excel y texto escapado, y todas las entregas declaran `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `Cross-Origin-Resource-Policy: same-origin`. Sin cambio de esquema: **no requiere migración**.

**Sin migración**: esta entrega no modifica el esquema. Para confirmarlo en el ambiente, ejecute `database/verificacion_transporte_visor.sql` desde el ejecutor SQL de EasyPanel: seis bloques de solo lectura que comprueban integridad del catálogo de archivos, coherencia entre extensión y MIME, cobertura del visor por formato, adjuntos de la bandeja con referencia de almacenamiento, trazabilidad de las cargas nuevas y ausencia de migración posterior a `0025`.

**Diagnóstico de entrega**: la comprobación en producción reveló que el visor muestra el objeto `{"error":"No fue posible entregar el archivo."}` porque **la ruta de entrega falla antes de enviar el binario**, no porque el visor no sepa representarlo. La prueba de extremo a extremo `server/knowledgeRoutes.test.ts` monta la ruta real sobre un servidor HTTP y demuestra que la entrega funciona cuando el archivo existe en el volumen: el fallo observado corresponde a un **volumen sin los binarios**, esto es, un volumen no montado o recreado en el despliegue mientras el catálogo de PostgreSQL permanece intacto. La corrección instrumenta la causa en lugar de adivinarla: `classifyDeliveryFailure` distingue archivo ausente (`410`), permiso denegado, ruta inválida y referencia corrupta, con su propio mensaje; el visor recibe una página HTML en tratamiento formal en lugar de JSON crudo, mientras las integraciones conservan el contrato JSON; y la bitácora registra `[Knowledge] entrega fallida motivo=… fileId=… clave=…`. El módulo `knowledgeStorageHealth` y la consulta `knowledge.storageHealth` comparan el catálogo con el volumen —documentos registrados, presentes, ausentes, muestra de afectados, directorio resuelto y permiso de escritura— y el Administrador de Proyectos advierte «N de M documentos no están en el volumen de almacenamiento» con el directorio exacto a revisar. El procedimiento de diagnóstico para el ejecutor SQL está en `database/diagnostico_visor_rag.sql`. **La remediación es operativa**: definir `KNOWLEDGE_STORAGE_DIR` apuntando a un volumen persistente en EasyPanel y volver a cargar los documentos afectados; ningún reinicio del servicio recupera un binario perdido. Sin migración.

### Alcance de 2.0.156

El release sustituye el panel de solo lectura «Conocimiento vigente y ciclos de información» de Revisión Humana por el **RAG Personal del candidato**, un módulo operativo equivalente al RAG de proyectos pero acotado al expediente de una postulación. El candidato recibe así lo que antes solo tenía el proyecto: **arrastre y selector de archivos**, **árbol de carpetas**, **visor** con vale firmado y **análisis de IA** con el mismo contrato de 66 palabras de resumen y 325 de análisis profundo. Al pulsar un documento, su resumen se carga en la caja azul y su análisis profundo en el editor, que puede regenerarse o corregirse antes de alimentar al agente.

**Configuración compartida.** El módulo consume la misma política que el RAG de proyectos —extensiones permitidas y peso máximo por archivo desde `Configuración › Conocimiento de proyectos`— y el mismo volumen persistente `KNOWLEDGE_STORAGE_DIR`, con las referencias del candidato aisladas bajo el prefijo `applications/<postulación>/`. El RAG de proyectos conserva sus referencias `<proyecto>/<uuid>.<extensión>` y el patrón de validación admite ambas formas sin aceptar recorrido de directorios, de modo que un proyecto y una postulación con el mismo número nunca comparten carpeta.

**Alimentación por webhook.** Un documento que llega por ApiChat se incorpora también al expediente del candidato con el mismo transporte canónico —decodificación, verificación de tipo por contenido y huella `sha256`—, la misma política de extensiones y el mismo análisis de IA, que se agenda sin bloquear la ronda de recepción. Un documento ya incorporado no se duplica: la huella dentro de la postulación lo identifica. Si la extensión no está habilitada en la configuración, el archivo permanece en la bandeja de la conversación pero no entra al expediente.

**Bloques propios.** A diferencia del RAG de proyectos, el del candidato reúne además la **base de conocimiento de la plaza** que sustenta la evaluación, los **ciclos de información abiertos** y las **aclaraciones confirmadas por la persona**. El conocimiento del proyecto sigue siendo el marco institucional; el del candidato es exclusivo de su proceso de evaluación y no lo altera.

**Gobierno.** Lectura y operación están disponibles para Administración y Reclutamiento, porque son quienes conducen el proceso, y toda escritura queda auditada con asunto propio (`candidate_file_uploaded`, `candidate_file_analyzed`, `candidate_file_moved`, `candidate_file_deleted`, `candidate_folder_created`). Retirar una carpeta no destruye evidencia: los documentos vuelven al inicio. El contexto del agente incorpora el expediente analizado en la capa «lo que la persona declaró», con la etiqueta `Expediente documental del candidato (análisis vigente)`, y la consulta degrada a lista vacía si la migración `0026` no está aplicada.

La migración `0026_candidate_knowledge.sql` es expansiva e idempotente: crea `candidate_knowledge_folders` y `candidate_knowledge_files`, agrega una columna anulable a `candidate_knowledge_notes` y no altera ni elimina ninguna estructura existente. Termina con una verificación autocertificada de seis bloques.
### Alcance de 2.0.154

El release incorpora la **cadena de adjuntos de la bandeja**. El proveedor entrega los documentos del candidato como `type: file` con una URL de contenido (habitualmente un dato URI base64); el puente y el receptor webhook la decodifican, la escriben en `inboxFiles` —el mismo volumen persistente `KNOWLEDGE_STORAGE_DIR` del RAG del proyecto— y registran el mensaje con metadata `media` (nombre, tipo, tamaño y clave de almacenamiento). La ruta `GET /api/inbox/files/:key`, restringida a administración, sirve el archivo con rango de bytes y nombre original; la burbuja de la bandeja muestra el adjunto con enlace al visor. Un adjunto sin contenido, mayor de 50 MB o no descargable se descarta con acuse. El envío saliente conserva el modal de archivo por URL HTTPS; el drag and drop de salida exige una URL pública del volumen y se documenta como límite operativo. Sin migración nueva.

### Alcance de 2.0.144

El release saca la **activación del servicio conversacional de las variables de entorno** y la lleva al panel de configuración, preactivada. La migración `0024_conversation_activation.sql` siembra con `ON CONFLICT DO NOTHING` los ocho interruptores del proveedor `conversation` —agente habilitado, modo de despliegue, las tres capacidades, despacho de la cola, historial recordado y límite de palabras— de modo que al aplicar las consultas el servicio queda operativo sin agregar ninguna variable. `config.conversationActivation` publica el estado vigente con sus avisos y `config.saveConversationActivation` lo guarda con validación de rangos y asiento en `audit_log` bajo el asunto `activation_updated`. La pantalla `Configuración › WhatsApp` incorpora la tarjeta «Activación del servicio conversacional» con cada interruptor, el modo integrado o separado, la memoria recordada, el límite de palabras y el botón de restaurar valores de fábrica.

La capacidad de cada proceso pasa a ser **intrínseca al punto de entrada**: `server/services/sender.ts` atiende el envío, `engine.ts` el razonamiento y `receiver.ts` la recepción, sin `CONVERSATION_SERVICE_CAPABILITY`. El barrido integrado consulta el modo del panel: en modo separado se detiene y deja el trabajo a los servicios dedicados; en modo integrado los servicios dedicados permanecen vivos pero inactivos. Si el panel apaga el agente, el razonamiento devuelve un turno omitido con motivo, el despacho no entrega y el motor no encola. Las variables `CONVERSATION_SERVICE_MODE`, `CONVERSATION_SERVICE_CAPABILITY` y las conexiones dedicadas se conservan únicamente como anulación manual para despliegues avanzados, y el panel lo advierte cuando detecta esa anulación.

### Alcance de 2.0.143

El release pone el **administrador de endpoints al día con la nueva funcionalidad conversacional**. Hasta 2.0.142 el catálogo oficial publicaba los siete endpoints con su ruta y su descripción, pero no declaraba quién los consume ni qué se rompe al apagarlos; un interruptor podía quedar apagado sin que la interfaz explicara la consecuencia. El catálogo declara ahora, por endpoint, la capacidad que atiende (`receive`, `send`, `moderation`), los consumidores (`recepcion`, `bandeja`, `agente`, `moderacion`), si es **indispensable para el agente** y el efecto operativo literal de apagarlo. `computeApiChatCapabilityReadiness` publica la preparación por capacidad —**Recepción**, **Razonamiento** y **Envío**— con el endpoint exigido y el modo declarado (`single` o `split`), y `apiChatCapabilityAdvisories` emite avisos en tratamiento formal: apagar `/messagesHistory` detiene la recepción y la rehidratación del hilo; apagar `/sendMessage` impide que el agente responda y solicite el CV; apagar `/sendPTT` deja fuera las notas de voz del equipo humano; apagar `/deleteMessage` deshabilita el retiro de mensajes con trazabilidad.

El razonamiento declara expresamente que **no consume ningún endpoint del proveedor**: solo exige credenciales del agente, de modo que apagar un endpoint de envío no lo detiene, pero sí impide entregar lo que encole. La pantalla `Configuración › WhatsApp` muestra en cada interruptor la capacidad, los consumidores, la marca de indispensable para el agente y el efecto de apagarlo, y agrega el bloque de preparación por capacidad con sus avisos. No hay cambio de esquema: los interruptores guardados conservan su valor y la migración `0021` sigue siendo la única fuente de siembra. La guía de despliegue incorpora además la **consulta única de verificación** de la base conversacional y las instrucciones de variables por servicio en EasyPanel, en [GUIA_EASYPANEL_CONVERSACION_2.0.142.md](GUIA_EASYPANEL_CONVERSACION_2.0.142.md).

### Alcance de 2.0.142

El release materializa el **despliegue separado por capacidad** del servicio conversacional sin romper el modo integrado. La cola dedicada `conversation_outbox` recibe cada respuesta autorizada con su turno y se reclama con `FOR UPDATE SKIP LOCKED`, de modo que dos emisores concurrentes nunca entregan el mismo mensaje; el reintento reprograma la fila con espera declarada y conserva el conteo, mientras un envío sin confirmación se marca como desconocido y nunca se reintenta de forma automática. La migración `0023_conversation_service_split.sql` crea la cola, tres esquemas de capacidad —`wa_receiver`, `wa_sender`, `wa_engine`— con vistas de solo lectura acotadas, tres roles de inicio de sesión **sin contraseña** que el operador habilita en EasyPanel, y la vista `conversation_reconciliation` para operación y auditoría. Los privilegios son de mínimo necesario: la recepción escribe mensajes entrantes, el emisor administra la cola y la confirmación, y el motor lee contexto y memoria y registra turnos y ciclos.

La frontera deja de ser solo una prueba sobre el código: cada proceso declara su capacidad con `CONVERSATION_SERVICE_MODE=split` y `CONVERSATION_SERVICE_CAPABILITY`, y `assertCapability` falla cerrada si intenta ejecutar otra. Los servicios `server/services/receiver.ts`, `engine.ts` y `sender.ts` arrancan con su propia cadena de conexión (`DATABASE_URL_RECEIVER`, `DATABASE_URL_ENGINE`, `DATABASE_URL_SENDER`) y caen a `DATABASE_URL` cuando la dedicada no existe. En modo separado el barrido integrado se desactiva para no duplicar trabajo. Cuando la migración `0023` no está aplicada, el sistema conserva el recorrido integrado de 2.0.141 y el despliegue continúa sin interrupción. El procedimiento completo, con el SQL listo para el ejecutor de EasyPanel, las verificaciones posteriores y la reversión, está en [GUIA_EASYPANEL_CONVERSACION_2.0.142.md](GUIA_EASYPANEL_CONVERSACION_2.0.142.md).
### Alcance de 2.0.141

El release da de alta el **servicio conversacional gobernado**. Hasta 2.0.140 la bandeja administraba el estado de automatización —`agent_enabled`, `human_takeover` y `automation_state`— sin que existiera un motor que generara respuestas: los únicos mensajes salientes automáticos eran plantillas de `cvRequest.ts`. La versión 2.0.141 incorpora el razonamiento conversacional con tres decisiones arquitectónicas verificables.

**El hilo pertenece a JARVI RH.** El agente se consume con OpenAI Responses API sin estado (`store: false`) y sin reutilizar identificadores de respuesta previa: la memoria vive en `conversation_messages`, `conversation_summaries` y `conversation_cycles`, de modo que la retención, el borrado con código temporal y la auditoría siguen siendo verificables en nuestra base de datos. La migración `0022_conversational_agent.sql` crea `conversation_turns` con la huella de contexto de cada respuesta, `conversation_events` con unicidad por conversación y evento —la idempotencia de la recepción deja de depender del código—, `conversation_summaries` versionado para sobrevivir pausas de semanas o meses y `candidate_knowledge_notes` como RAG personal alimentado únicamente con evidencia literal del mensaje de la persona.

**Cuatro capas de contexto y un marco comparativo determinista.** El razonamiento recibe el marco epistemológico institucional —proyección única del RAG de proyectos, compartida con el evaluador automático mediante `knowledgeContext.ts`, más SIERA y MST-EIR—, el RAG personal del candidato —respuestas, perfil, documentos y aclaraciones confirmadas—, la comparación determinista entre el perfil de la plaza y el instrumento que la persona completó, y la memoria conversacional acumulada. La precedencia es explícita: un hecho declarado por la persona prevalece sobre una expectativa del puesto y ninguna capa se convierte en hecho sin evidencia literal. Las diferencias detectadas se convierten en ciclos de información abiertos, que son la razón de cada pregunta y el indicador medible de los ciclos cerrados.

**Conducta verificable antes de cualquier envío.** Cada respuesta se somete a `verifyConversationConduct` —una sola pregunta abierta, límite de palabras, sin repetir ciclos abiertos, sin instrucción informal— y al guardarraíl `assertNoAutomatedSalaryOffer`. Si la verificación falla, el motor regenera una vez con el motivo; si vuelve a fallar, escala la conversación a revisión humana con trazabilidad y sin improvisar en producción. El motor no habla con el proveedor y el emisor no recibe: `conversationOutbox.ts` es el único que entrega al proveedor, reintenta solo los rechazos explícitos y marca como desconocido cualquier envío sin confirmación, que nunca se reintenta automáticamente. `server/boundaries.test.ts` demuestra estas fronteras sobre el código fuente.

**Revisión Humana** muestra bajo el nombre la ubicación declarada —zona, municipio, departamento y país— y la expectativa de remuneración con su monto y su fuente, que permanece en cero mientras no exista evidencia literal. Bajo la matriz de evaluación IA se inserta el panel de evidencia: el hilo del candidato y el conocimiento vigente de la plaza con la huella del RAG que usó la última evaluación automática.

El alcance de 2.0.158 integra tres frentes verificables. **Solicitud automática de CV**: la postulación pública deja de depender de una decisión humana para pedir el currículum. Al confirmar «Enviar formulario», `publicJobs.submit` registra candidato, postulación, respuestas, participación y consentimientos, confirma la transacción y dispara `requestCvForApplication` para **toda** postulación, sin excepción y sin exigir el estado `calificado`. El despacho se ejecuta en su propia transacción, después del `COMMIT`, de modo que un fallo del proveedor o del texto nunca revierte el registro del candidato; la marca `cv_request:<applicationId>` conserva un único envío por postulación aun cuando la misma persona complete variantes distintas de la misma plaza. La acción manual «Solicitar CV por WhatsApp» permanece disponible para reenvío y el guardarraíl de política salarial sigue vigente: ninguna plantilla puede incluir una propuesta económica.

El alcance de 2.0.140 integra dos frentes verificables adicionales. **Gobierno, Observabilidad y Monitoreo** deja Pruebas psicométricas y obtiene entrada propia en el menú administrativo con icono de ojo: las políticas del catálogo se agrupan por categoría con marco de color, resumen propio y la superficie observable de LangGraph que las verifica. La migración `0020_governance_rule_verifications.sql` crea el registro auditable de verificaciones —identificador de política, dominio, origen, identificador de traza, ambiente, versión, actor y fecha— sin almacenar credenciales. Cada política declara «Trazas auditadas No. X» recalculado desde la base y la verificación ejecuta una comprobación real contra Langfuse; la interfaz no publica el número total de criterios y el conteo no depende del estado del navegador. Si la migración no está aplicada, el módulo explica la acción requerida en lugar de mostrar un contador sin fuente.

**ApiChat** recibe una línea base verificable. El endpoint nativo se normaliza a la base oficial desde cualquier operación escrita —`/v1/`, `/v1/sendText` o `/v1/messages`—, de modo que existe una sola fuente de verdad para las rutas derivadas; el host debe pertenecer a `api.apichat.io` y las bases de Chat API (`/instance{client_id}/`) y APIGraph (`/graph/v17/`) se rechazan de forma explícita porque exigen un adaptador dedicado todavía no habilitado. El catálogo publica bajo cada interruptor la ruta real invocada. La migración `0021_apichat_official_endpoints.sql` siembra la base y los siete endpoints oficiales con `ON CONFLICT DO NOTHING`, de modo que no sobrescribe decisiones previas del operador.

La recepción deja de anunciarse sin evidencia. La insignia distingue credenciales disponibles de capacidad comprobada: «Recepción sin verificar» permanece mientras no exista una consulta real satisfactoria al historial. «Verificar recepción» consulta el historial oficial con las credenciales cifradas, sella la marca temporal únicamente cuando el proveedor responde y exige el endpoint de historial encendido como requisito de recepción; sin él la verificación se rechaza y la interfaz advierte que la bandeja no puede sincronizar. Los acoplamientos anteriores quedan corregidos: el interruptor de texto gobierna la ruta que realmente se invoca y el de historial gobierna la consulta de sincronización.

### Alcance de 2.0.138

El release convierte cada formulario en un instrumento con identidad propia: `application_forms.public_token` (migración `0019`) genera una capacidad no predecible de 128 bits con índice único, y el enlace `/apply/f/:token` abre una variante concreta —A, B, C o D— sin enumerar variantes ni revelar su relación con la plaza. Cada formulario conserva su interruptor `published` independiente, su botón de edición, su acceso a preguntas, la copia de su enlace y una vista previa administrativa de solo lectura que reproduce el formulario público sin publicar ni crear registros. La importación desde Excel/CSV (`forms.importSpreadsheet`) genera el mismo token, de modo que el formulario importado queda en borrador con enlace, interruptor y previsualización equivalentes.

La identidad del candidato continúa siendo el WhatsApp normalizado: quien completa dos variantes de la misma plaza conserva un solo candidato y una sola postulación, y agrega una participación por formulario en `application_form_submissions`. La ficha del candidato identifica cada bloque de respuestas con su formulario y su versión, y la evaluación dejó de agrupar respuestas por `field_key` sin procedencia: cada pregunta viaja con `form_id`, versión y `questionId`, y las claves repetidas entre variantes se cualifican (`field_key#formularioN`) para impedir sobrescrituras y errores de correlación en las reglas deterministas. La importación no ejecuta la evaluación automática con IA, que permanece bajo demanda.

Una plaza no acumula dos instrumentos para la misma evidencia. `instrumentSignature` resume el conjunto ordenado de preguntas y, si la plaza ya tiene un formulario con esa firma, la importación agrega las respuestas a ese formulario (`reusedForm`) en lugar de crear otro; el asiento de auditoría usa `form_import_reused`. Una variante distinta exige preguntas distintas. El instrumento redundante de una plaza se retira con el procedimiento controlado de `database/004_saneamiento_formularios_duplicados.sql`: guardas que abortan si el instrumento conserva alguna respuesta sin copia idéntica en el superviviente, retiro exclusivo de las respuestas duplicadas —misma postulación, mismo enunciado y mismo valor normalizado—, reasignación del origen de la postulación, asiento `duplicate_form_removed` con instantánea anterior y posterior —incluida la lista de postulaciones participantes— y verificación de integridad. La plaza queda con un solo instrumento y sin destruir evidencia del candidato.

La higiene de propiedad intelectual es parte del alcance: el payload público entrega únicamente identificador, clave, enunciado, ayuda, tipo, obligatoriedad, orden y configuración depurada (`options`, `min`, `max`); las respuestas aceptadas, la marca de requisito indispensable, los criterios de evaluación y las instrucciones del agente permanecen en el servidor y solo son visibles en el constructor administrativo. El análisis ontológico, epistemológico, fenomenológico, de ingeniería y de estrategia de propiedad intelectual está en [ANALISIS_FORMULARIOS_MULTIPLES_2.0.138.md](ANALISIS_FORMULARIOS_MULTIPLES_2.0.138.md). Las capacidades de 2.0.137, 2.0.136, 2.0.135 y 2.0.134 permanecen bajo regresión.

El alcance no incluye todavía descarga productiva de medios ApiChat, bucket, antivirus, previsualización de PDF/Word/audio, ejecución adaptativa completa de pruebas, validación psicométrica ni ingestión de despliegues e incidentes para calcular DORA. La asignación de variantes no es aleatoria: la plataforma habilita la comparación A/B/C/D, pero no constituye un ensayo aleatorizado ni calcula significancia estadística, poder o tamaño de muestra. La actividad administrativa usa sondeo de cinco segundos según la vista, no streaming; la bandeja usa sincronización por sondeo de un segundo sin garantía de entrega exactamente una vez. Los resúmenes de actividad son deterministas aunque exista un selector reservado para un modelo futuro. La recepción ya no depende de un webhook ni de un workflow externo: el historial oficial del proveedor es la fuente que rellena la bandeja.

El protocolo de privacidad, despliegue, verificación y rollback se documenta en [OBSERVABILIDAD_LANGFUSE_2.0.131.md](OBSERVABILIDAD_LANGFUSE_2.0.131.md). El análisis cognitivo general permanece en [ANALISIS_COGNITIVO_DORA_2.0.130.md](ANALISIS_COGNITIVO_DORA_2.0.130.md). El incremento atómico ya fue ejecutado; `pnpm release:bump -- --dry-run` confirma la versión siguiente antes de publicarla.

La versión 2.0.137 convirtió «Plazas y formularios» en «Plazas y anuncios» con icono de mundo: una plaza administra múltiples formularios, unos construidos con la herramienta y otros importados desde Excel/CSV (migración `0018`). La importación toma la primera fila como preguntas, exige una columna de teléfono o WhatsApp, reconcilia o crea candidatos con el número como única fuente de relación, registra participaciones en `application_form_submissions` y agrega respuestas sin sobrescribir las existentes. El análisis ontológico, epistemológico y fenomenológico de ese alcance permanece en [ANALISIS_ONTOLOGICO_FORMULARIOS_2.0.137.md](ANALISIS_ONTOLOGICO_FORMULARIOS_2.0.137.md).

La versión 2.0.129 convirtió Configuración > WhatsApp en el almacén operativo de ApiChat. `integration_settings` conserva preferencias y secretos cifrados; el cliente recibe únicamente estado y máscara. `cvRequest.ts` obtiene la configuración mediante `getApiChatRuntimeSettings` después de confirmar la transacción y `apichat.ts` ya no consulta el entorno. La ruta genérica de configuración queda limitada al proveedor no secreto `recruitment`.

Client ID, token e ID de cuenta se cifran con AES-256-GCM y autenticación antes de persistirse. Cada rotación o eliminación registra clave y estado en `audit_log`, nunca el valor. Una fila histórica en texto plano se rechaza y exige rotación desde el módulo seguro. La verificación nativa ejecuta `GET /v1/status`, no envía mensajes y descarta cualquier contenido QR antes de responder al navegador.

La migración `0013_apichat_credential_vault.sql` es idempotente, inicializa los valores públicos aprobados y reserva filas secretas con `NULL`. Los secretos deben ingresarse desde la UI para garantizar su cifrado; no se entregan como SQL ni se almacenan en el repositorio. El endpoint nativo exige HTTPS y el dominio `api.apichat.io`; toda operación escrita se normaliza a la base oficial `/v1/` y las bases de Chat API y APIGraph se rechazan con mensaje explícito hasta habilitar su adaptador.

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

Desde 2.0.119, el tratamiento escrito institucional utiliza **usted** en portal público, formularios, administración, validaciones, correo de acceso, WhatsApp y plantillas operativas. `scripts/verify-formal-spanish.mjs` inspecciona los 95 archivos de ejecución vigentes y forma parte de `release:verify`, `test:black-box` y `build`. La migración `0012_dear_lifeguard.sql` homologa únicamente textos históricos predeterminados y conserva contenido libre de administración.

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
- [ISO/IEC 20000-1:2018](https://www.iso.org/standard/70636.html): gestión de servicios; orienta el mapa de controles de servicio visible en Actividad y control ISO.
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

La especificación del release está en [PRUEBAS_CAJA_NEGRA_2.0.203.md](PRUEBAS_CAJA_NEGRA_2.0.203.md).
