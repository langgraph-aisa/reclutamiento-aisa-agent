# Análisis fenomenológico, ontológico y epistémico · recuperación del adjunto conservado 2.0.188

Fecha: 2026-09-19. Rama objetivo: `main`. Este documento fundamenta la recuperación del adjunto conservado, declara la lectura institucional del desenlace del conducto y fija la re-evaluación del agente evaluador con la evidencia nueva y el acuse del expediente al candidato.

## 1. Análisis fenomenológico del fallo

**Lo que aparecía.** La bandeja de la ficha mostraba el archivo —`SIERA-GT-SOLAR-GT.pdf`, once páginas, cincuenta y cinco kilobytes— con la frase «Archivo conservado; no incorporado al expediente por su formato o tamaño». El expediente del candidato no contenía documento alguno, el puntaje de la evaluación no se movía y el evaluador humano abría la ficha sin base documental sobre la cual contrastar el resultado de la inteligencia artificial.

**Lo que cada actor percibía.** El operador percibía un defecto atribuible al archivo o al candidato: la frase está redactada como una propiedad del objeto. El candidato no percibía nada, porque el sistema no le comunicó ninguna consecuencia. El evaluador percibía ausencia de evidencia y no tenía forma de distinguirla de una ausencia de envío. El agente evaluador percibía un expediente sin documentos y razonó correctamente sobre una base incompleta.

**Por qué el fallo no se advertía.** La percepción era coherente y estable. El sistema declaraba una causa —formato o tamaño—, y una causa declarada produce la impresión de una decisión tomada. Un solo enunciado cubría cuatro causas distintas con cuatro remedios distintos, de modo que la superficie afirmaba conocer el motivo cuando en realidad renunciaba a nombrarlo. La consecuencia operativa era la única acción disponible: suponer.

**El punto de quiebre.** El rechazo se ofrecía como terminal. Ninguna superficie ofrecía una acción sobre el hecho —la extensión puede habilitarse, el límite puede admitir ese peso— y el binario permanecía escrito en el volumen. La fenomenología del sistema afirmaba una clausura que la ontología del sistema desmentía: el archivo existía.

## 2. Análisis ontológico

**Recepción e ingreso son dos hechos.** El conducto confundía en un solo asiento lo que son dos: que el proveedor haya entregado el contenido y que el expediente lo haya admitido. El primero es un hecho del mundo y se verifica por la presencia del binario; el segundo es una decisión administrativa y se verifica por la política vigente. Al separarlos, el rechazo deja de ser un atributo del archivo y pasa a ser lo que es: el veredicto de una configuración.

**El binario es un existente que persiste.** La recepción escribe los bytes en el volumen de la bandeja con su huella `sha256`, su extensión reconstruida por contenido y su tipo detectado por firma. Mientras ese binario exista, la incorporación es una operación posible sin intervención del candidato. La recuperación no crea contenido: lee lo conservado.

**Mereología de la evidencia.** El expediente del candidato contiene documentos; un documento comprende el binario, su análisis y su esencia; la esencia alimenta al agente evaluador. La bandeja contiene mensajes; un mensaje con adjunto comprende el descriptor, el binario conservado y el desenlace de su ingreso. El vínculo entre las dos mereologías es explícito: el mensaje declara el identificador del documento del expediente cuando la incorporación prospera, y esa declaración es la que corrige el asiento.

**La identidad del documento es su contenido.** El nombre visible y el tipo declarado por el emisor no identifican nada: la identidad se resuelve por huella y la extensión final se reconstruye por firma de bytes. Un mismo contenido reenviado no produce un segundo documento. Un nombre mentiroso no produce un tipo falso.

**La creencia falsa era un asiento.** El mensaje conservaba `processingOutcome='rejected'` después de que el expediente ya contuviera el documento. Un asiento no es un hecho: es una afirmación sobre un hecho, y una afirmación superada debe corregirse en el instante en que el hecho se corrige, o la bandeja seguiría declarando una exclusión que el expediente desmiente.

**El acuse pertenece al expediente, no al ciclo de solicitud.** El agradecimiento y el aviso de contacto estaban redactados y configurados, pero su emisión dependía de un camino —el cierre de la solicitud— que no cubre la vía en que el expediente se completa por recepción del adjunto. El acuse es un acto del expediente.

## 3. Carga epistémica

**El déficit era de conocimiento, no de razonamiento.** El agente evaluador conocía las respuestas del formulario, el perfil laboral de la plaza y el conocimiento del proyecto; desconocía el binario conservado en la bandeja. Su razonamiento fue correcto sobre una base incompleta, y esa incompletitud no estaba declarada en ninguna parte: el evaluador humano leía la misma ficha y tampoco podía saber que existía un documento fuera del expediente.

**La evidencia nueva entra como capa declarada.** La re-evaluación incorpora el expediente documental del candidato —la esencia del currículum o, en su ausencia, el análisis previo— y actualiza el puntaje. La procedencia de la capa queda declarada, de modo que el dictamen se apoya en una base cuyo origen consta.

**La refutabilidad se restituye.** El visor entrega el documento con vale firmado y acotado, y el evaluador humano lee la misma base que leyó el agente. La comparación entre el resultado de la inteligencia artificial y el documento original es el acto decisivo: el dictamen humano prevalece y su fundamento es verificable.

**La ignorancia se declara cuando no puede resolverse.** Una ausencia de contenido en el proveedor no admite incorporación, y el sistema lo dice con su código y su sentencia: la recuperación exige un envío nuevo. La distinción se conserva en el vocabulario institucional: **recibido no es incorporado**, e **incorporable no es interpretado**. Un formato sin extractor disponible se declara con su causa y no se presenta como un defecto del candidato.

**El estado del expediente es una lectura, no una suposición.** La condición de cada documento —sin análisis, en proceso, analizado o fallido— se deriva de su propio asiento, y el panel la presenta con su sentencia. La evaluación no se ejecuta sobre una promesa de análisis.

## 4. Lógica de ingeniería de software incorporada

1. **El binario manda.** La extensión, el tipo y la huella se reconstruyen por contenido con el transporte canónico; nunca se confía en lo declarado por el emisor. `describeTransportBuffer` reutiliza exactamente la semántica de la decodificación de recepción.
2. **La política se declara, no se supone.** El veredicto viaja con su código, con las extensiones habilitadas y con el peso máximo vigentes en el instante de la decisión, de modo que el operador sabe qué habilitar. La función `candidatePolicyRefusal` aísla el criterio porque la decisión se toma en dos momentos distintos y los dos deben juzgar igual.
3. **Una sola escritura para dos caminos.** La incorporación posterior comparte con la recepción la misma persistencia, la misma deduplicación por huella y el mismo trabajo de análisis diferido. No existe una segunda vía de escritura que pueda divergir.
4. **El asiento se corrige al corregirse el hecho.** Al incorporar, el mensaje deja de declarar un rechazo superado y queda vinculado al documento del expediente.
5. **Idempotencia por huella y por auditoría.** Un contenido ya incorporado se reconoce y no se duplica; la re-evaluación se ejecuta una sola vez; el acuse se asienta en la auditoría y no en la clave del mensaje, porque el envío humano la sobrescribe con el identificador del proveedor.
6. **El mismo conjunto en las dos superficies.** Lo que la ficha ofrece como recuperable y lo que el diagnóstico del conducto cuenta como rechazo de ingreso es la misma condición de consulta; dos superficies no pueden afirmar cosas distintas sobre el mismo hecho.
7. **El control humano se ejerce.** El acuse se envía por el camino humano de la bandeja: la conversación debe estar tomada por una persona y el sistema no escribe al candidato sin que alguien sostenga el teclado.

## 5. Re-evaluación del agente con la nueva data y acuse al candidato

La secuencia operativa queda fijada en seis actos: leer el binario conservado; incorporarlo al expediente con su análisis y su esencia; ejecutar la re-evaluación con la evidencia nueva; dejar el documento disponible en el visor para el dictamen humano; corregir el asiento del mensaje; y emitir el acuse del expediente con el agradecimiento y el aviso de contacto declarados en «Evaluación de CV con IA».

El agente recibe la esencia del currículum como capa declarada y actualiza el puntaje. Si el análisis no está disponible en el instante de la re-evaluación, la operación lo declara en lugar de evaluar sobre una promesa. El acuse se compone con la misma función que el cierre de la solicitud —para que no existan dos redacciones del agradecimiento— y se emite una sola vez por el mismo medio.

## 6. Alcance verificado y límites declarados

**Verificado.** Doce pruebas fijan la incorporación del adjunto conservado, el análisis, la re-evaluación del agente, la detección por huella, la ausencia de binario y la idempotencia del acuse; la caja negra 2.0.188 conserva las treinta y ocho pruebas de la puerta. Sin migración: el alcance reutiliza las tablas `0035` a `0037` y el volumen de la bandeja.

**Límites.** La recuperación no crea contenido: un adjunto anunciado sin carga exige un envío nuevo. Un formato sin extractor disponible se declara como tal y su interpretación requiere reconocimiento óptico. La re-evaluación actualiza el puntaje y no certifica validez psicométrica; el dictamen humano conserva la autoridad de la decisión.
